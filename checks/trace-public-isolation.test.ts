import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatform } from "../services/runtime/src/app.ts";
import { createGuard } from "../services/runtime/src/public-guard.ts";

/**
 * 公网会话隔离：两个互不相干的浏览器会话，B 即使拿到 A 的项目 ID、运行 ID、
 * 档案地址，也不能读取或改动 A 的任何数据。
 *
 * 这里直接用 HTTP 接口验证（guard 的 ownership 钩子在路由之前生效），
 * 不依赖真实检索：调查本身用引擎直接建，只把归属写成 A 的会话。
 */
describe("公网会话隔离", () => {
  const previous = {
    public: process.env.PLATFORM_PUBLIC,
    trust: process.env.PLATFORM_TRUST_PROXY,
  };
  afterEach(() => {
    if (previous.public === undefined) delete process.env.PLATFORM_PUBLIC;
    else process.env.PLATFORM_PUBLIC = previous.public;
    if (previous.trust === undefined) delete process.env.PLATFORM_TRUST_PROXY;
    else process.env.PLATFORM_TRUST_PROXY = previous.trust;
  });

  async function setup() {
    process.env.PLATFORM_PUBLIC = "1";
    const dir = await mkdtemp(join(tmpdir(), "trace-isolation-"));
    const platform = await createPlatform({
      dbPath: join(dir, "data.sqlite"),
      artifactRoot: join(dir, "artifacts"),
    });
    return { platform, dir };
  }

  // 不带 content-type：这些请求没有 body，带上空 JSON 会被 Fastify 拒绝（FST_ERR_CTP_EMPTY_JSON_BODY）。
  function headers(token?: string) {
    return {
      "x-platform-client": "workbench-v1",
      ...(token ? { "x-trace-session": token } : {}),
    };
  }

  it("B 无法通过 projectId / 运行 ID / 档案地址触达 A 的调查", async () => {
    const { platform, dir } = await setup();
    try {
      const mintedA = await platform.app.inject({ method: "POST", url: "/v1/session", headers: { ...headers(), "user-agent": "A" } });
      const mintedB = await platform.app.inject({ method: "POST", url: "/v1/session", headers: { ...headers(), "user-agent": "B" } });
      expect(mintedA.statusCode).toBe(200);
      expect(mintedB.statusCode).toBe(200);
      const a = mintedA.json() as { token: string; sessionId: string };
      const b = mintedB.json() as { token: string; sessionId: string };
      expect(a.sessionId).not.toBe(b.sessionId);

      // A 的项目与调查（归属写成 A 的会话，相当于 A 通过接口建的那次调查）
      const project = platform.engine.createProject({
        name: "A 的隔离测试项目",
        layout: "business",
        permissions: [],
        steps: [],
      });
      platform.store.exec("UPDATE projects SET owner=? WHERE id=?", a.sessionId, project.id);
      const revision = (platform.store.get("SELECT revision FROM projects WHERE id=?", project.id)?.revision as number) || 1;
      const nowIso = new Date().toISOString();
      platform.store.exec(
        "INSERT INTO runs(id,project_id,project_name,revision,plan,permissions,input,status,error,created_at,updated_at,owner) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        "run_iso_a",
        project.id,
        project.name,
        revision,
        "[]",
        "[]",
        JSON.stringify({ filename: "a.txt", text: "A 的调查", dataConsent: true }),
        "completed",
        null,
        nowIso,
        nowIso,
        a.sessionId,
      );

      // 1) 列表：带 projectId 也不能列出别人的调查
      const listA = await platform.app.inject({ method: "GET", url: `/v1/runs?projectId=${project.id}`, headers: headers(a.token) });
      const listB = await platform.app.inject({ method: "GET", url: `/v1/runs?projectId=${project.id}`, headers: headers(b.token) });
      expect(listA.statusCode).toBe(200);
      expect((listA.json() as { id: string }[]).some((item) => item.id === "run_iso_a")).toBe(true);
      expect(listB.statusCode).toBe(200);
      expect((listB.json() as { id: string }[]).some((item) => item.id === "run_iso_a")).toBe(false);

      // 2) 详情 / 项目详情 / 追加检索 / 档案 / 冻结版本：B 一律 404
      const bReads = [
        { method: "GET" as const, url: "/v1/runs/run_iso_a" },
        { method: "GET" as const, url: `/v1/projects/${project.id}` },
        { method: "GET" as const, url: "/v1/runs/run_iso_a/trace/assessment" },
        { method: "GET" as const, url: "/v1/runs/run_iso_a/trace/revisions" },
        { method: "GET" as const, url: "/v1/runs/run_iso_a/artifacts/anything" },
        { method: "GET" as const, url: "/v1/runs/run_iso_a/receipt" },
        { method: "POST" as const, url: "/v1/runs/run_iso_a/trace/followup" },
        { method: "POST" as const, url: "/v1/runs/run_iso_a/trace/auto" },
        { method: "POST" as const, url: "/v1/runs/run_iso_a/trace/approve" },
        { method: "POST" as const, url: "/v1/runs/run_iso_a/cancel" },
      ];
      for (const call of bReads) {
        const response = await platform.app.inject({ ...call, headers: headers(b.token) });
        expect([403, 404]).toContain(response.statusCode);
      }

      // 3) A 自己能读
      const ownRun = await platform.app.inject({ method: "GET", url: "/v1/runs/run_iso_a", headers: headers(a.token) });
      expect(ownRun.statusCode).toBe(200);
      const ownProject = await platform.app.inject({ method: "GET", url: `/v1/projects/${project.id}`, headers: headers(a.token) });
      expect(ownProject.statusCode).toBe(200);
    } finally {
      await platform.app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("没有归属的历史运行同样不能被匿名会话读取", async () => {
    const { platform, dir } = await setup();
    try {
      const minted = await platform.app.inject({ method: "POST", url: "/v1/session", headers: { ...headers(), "user-agent": "C" } });
      const c = minted.json() as { token: string };
      const project = platform.engine.createProject({
        name: "无主项目",
        layout: "business",
        permissions: [],
        steps: [],
      });
      platform.store.exec("UPDATE projects SET owner=NULL WHERE id=?", project.id);
      const orphanRevision = (platform.store.get("SELECT revision FROM projects WHERE id=?", project.id)?.revision as number) || 1;
      const orphanAt = new Date().toISOString();
      platform.store.exec(
        "INSERT INTO runs(id,project_id,project_name,revision,plan,permissions,input,status,error,created_at,updated_at,owner) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)",
        "run_iso_orphan",
        project.id,
        project.name,
        orphanRevision,
        "[]",
        "[]",
        JSON.stringify({ filename: "o.txt", text: "无主调查", dataConsent: true }),
        "completed",
        null,
        orphanAt,
        orphanAt,
      );
      const orphan = await platform.app.inject({ method: "GET", url: "/v1/runs/run_iso_orphan", headers: headers(c.token) });
      expect(orphan.statusCode).toBe(404);
      const orphanProject = await platform.app.inject({ method: "GET", url: `/v1/projects/${project.id}`, headers: headers(c.token) });
      expect(orphanProject.statusCode).toBe(404);
    } finally {
      await platform.app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("配额与检索预算在公网模式下真实生效", async () => {
    const { platform, dir } = await setup();
    const previousQuota = {
      runs: process.env.PLATFORM_SESSION_RUNS_PER_DAY,
      runSearches: process.env.PLATFORM_RUN_MAX_SEARCHES,
      dayBudget: process.env.PLATFORM_DAILY_SEARCH_BUDGET,
    };
    try {
      process.env.PLATFORM_SESSION_RUNS_PER_DAY = "1";
      process.env.PLATFORM_RUN_MAX_SEARCHES = "1";
      process.env.PLATFORM_DAILY_SEARCH_BUDGET = "1000";
      const minted = await platform.app.inject({
        method: "POST",
        url: "/v1/session",
        headers: { ...headers(), "user-agent": "quota" },
      });
      const { token } = minted.json() as { token: string };
      const guard = createGuard(platform.store);
      const session = guard.sessionOf(token)!;
      const ip = "203.0.113.20";
      guard.assertInvestigationAllowed(session, ip);
      guard.recordInvestigation("run_quota_1", session, ip);
      expect(() => guard.assertInvestigationAllowed(session, ip)).toThrowError(/达到上限|额度/);

      // 单次调查的检索预算：第 2 次检索必须被拒绝
      guard.reserveSearch("run_search_budget");
      expect(() => guard.reserveSearch("run_search_budget")).toThrowError(/检索|上限/);
    } finally {
      if (previousQuota.runs === undefined) delete process.env.PLATFORM_SESSION_RUNS_PER_DAY;
      else process.env.PLATFORM_SESSION_RUNS_PER_DAY = previousQuota.runs;
      if (previousQuota.runSearches === undefined) delete process.env.PLATFORM_RUN_MAX_SEARCHES;
      else process.env.PLATFORM_RUN_MAX_SEARCHES = previousQuota.runSearches;
      if (previousQuota.dayBudget === undefined) delete process.env.PLATFORM_DAILY_SEARCH_BUDGET;
      else process.env.PLATFORM_DAILY_SEARCH_BUDGET = previousQuota.dayBudget;
      await platform.app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("默认不信任伪造的转发头，只有显式开启代理信任才按最后一跳识别", async () => {
    const { platform, dir } = await setup();
    try {
      delete process.env.PLATFORM_TRUST_PROXY;
      const spoofed = await platform.app.inject({
        method: "POST",
        url: "/v1/session",
        headers: { ...headers(), "user-agent": "spoof", "x-forwarded-for": "9.9.9.9" },
      });
      const spoofSession = spoofed.json() as { sessionId: string };
      const spoofIp = platform.store.get("SELECT ip FROM web_sessions WHERE id=?", spoofSession.sessionId)?.ip as string;
      expect(spoofIp).not.toBe("9.9.9.9");

      process.env.PLATFORM_TRUST_PROXY = "1";
      const trusted = await platform.app.inject({
        method: "POST",
        url: "/v1/session",
        headers: { ...headers(), "user-agent": "trusted", "x-forwarded-for": "9.9.9.9, 203.0.113.7" },
      });
      const trustedSession = trusted.json() as { sessionId: string };
      const trustedIp = platform.store.get("SELECT ip FROM web_sessions WHERE id=?", trustedSession.sessionId)?.ip as string;
      // 最后一跳才是可信代理写入的真实对端地址
      expect(trustedIp).toBe("203.0.113.7");
    } finally {
      await platform.app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * 会话 Cookie 必须能真正落到浏览器里。
   * 之前无条件写 Secure，明文 HTTP 部署时浏览器直接丢弃：档案下载这类
   * 普通链接跳转带不了请求头，于是只剩 SESSION_REQUIRED。
   */
  /**
   * 交付用的只读公开案例：允许匿名 GET，但不允许匿名写入或读取其它运行。
   */
  it("PLATFORM_DEMO_RUNS 里的运行可匿名只读，其它运行仍 404", async () => {
    const { platform, dir } = await setup();
    const previous = process.env.PLATFORM_DEMO_RUNS;
    try {
      const minted = await platform.app.inject({ method: "POST", url: "/v1/session", headers: { ...headers(), "user-agent": "A" } });
      const owner = (minted.json() as { sessionId: string }).sessionId;
      const runId = "run_demo_public_1";
      const demoProject = platform.engine.createProject({
        name: "公开示例项目",
        layout: "business",
        permissions: [],
        steps: [],
      });
      platform.store.exec("UPDATE projects SET owner=? WHERE id=?", owner, demoProject.id);
      platform.store.exec(
        "INSERT INTO runs(id,project_id,project_name,revision,plan,permissions,input,status,error,created_at,updated_at,owner) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        runId,
        demoProject.id,
        demoProject.name,
        1,
        "[]",
        "[]",
        JSON.stringify({ filename: "demo", text: "示例" }),
        "completed",
        null,
        new Date().toISOString(),
        new Date().toISOString(),
        owner,
      );
      process.env.PLATFORM_DEMO_RUNS = runId;

      const anon = await platform.app.inject({ method: "POST", url: "/v1/session", headers: { ...headers(), "user-agent": "B" } });
      const visitor = (anon.json() as { token: string }).token;
      const read = await platform.app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers: headers(visitor) });
      expect(read.statusCode).toBe(200);
      // 写入仍然要求归属
      const write = await platform.app.inject({ method: "POST", url: `/v1/runs/${runId}/cancel`, headers: headers(visitor) });
      expect(write.statusCode).toBeGreaterThanOrEqual(400);
      // 未登记的运行照旧 404
      const other = await platform.app.inject({ method: "GET", url: "/v1/runs/run_not_demo", headers: headers(visitor) });
      expect(other.statusCode).toBe(404);
    } finally {
      if (previous === undefined) delete process.env.PLATFORM_DEMO_RUNS;
      else process.env.PLATFORM_DEMO_RUNS = previous;
      await platform.app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("会话 Cookie 只在 HTTPS 下带 Secure，普通链接跳转才拿得到会话", async () => {
    const { platform, dir } = await setup();
    try {
      const plain = await platform.app.inject({
        method: "POST",
        url: "/v1/session",
        headers: { ...headers(), "user-agent": "plain-http" },
      });
      const plainCookie = String(plain.headers["set-cookie"] || "");
      expect(plainCookie).toContain("trace_session=");
      expect(plainCookie).toContain("HttpOnly");
      expect(plainCookie).not.toContain("Secure");

      // 受控代理声明 https 时才加回 Secure。
      process.env.PLATFORM_TRUST_PROXY = "1";
      const secure = await platform.app.inject({
        method: "POST",
        url: "/v1/session",
        headers: {
          ...headers(),
          "user-agent": "behind-tls",
          "x-forwarded-proto": "https",
        },
      });
      expect(String(secure.headers["set-cookie"] || "")).toContain("Secure");

      // 只有 Cookie 也能读到自己的会话（档案下载走的就是这条路径）。
      const token = (plain.json() as { token: string }).token;
      const viaCookie = await platform.app.inject({
        method: "GET",
        url: "/v1/session",
        headers: { "x-platform-client": "workbench-v1", cookie: "trace_session=" + token },
      });
      expect(viaCookie.statusCode).toBe(200);
    } finally {
      await platform.app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
