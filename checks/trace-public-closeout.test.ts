import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatform } from "../services/runtime/src/app.ts";
import { expireAbandonedApprovals } from "../services/runtime/src/public-guard.ts";
import { standardAssembly, standardPermissions } from "@personal/capability-sdk";
import { buildAssessment, redeliverArchive } from "../services/runtime/src/trace-followup.ts";
import { traceSearch } from "../services/runtime/src/trace-search.ts";
import { hash } from "../services/runtime/src/util.ts";

async function seededTrace(platform: Awaited<ReturnType<typeof createPlatform>>) {
  const project = platform.engine.createProject({ name: "本地固定记录", layout: "business", permissions: [], steps: [] });
  const runId = "run_local_fixed";
  const at = "2025-01-01T00:00:00.000Z";
  const fact = { id: "fact-1", text: "水星和金星都没有天然卫星。", queries: ["水星 金星 天然卫星"] };
  const bundle = { case: { question: fact.text, claim: fact.text, facts: [fact] }, search: { available: true, totalQueries: 1 }, pages: [{ id: "p", url: "https://science.example.org/planets", site: "示例", title: "太阳系行星", date: "", passage: "金星和水星是太阳系中仅有的两颗没有卫星的行星。" }], searches: [], bodyTexts: {} };
  platform.store.exec("INSERT INTO runs(id,project_id,project_name,revision,plan,permissions,input,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", runId, project.id, project.name, 1, JSON.stringify([{ capabilityId: "trace.evidence.verify", version: "1.0.0", config: {} }]), "[]", JSON.stringify({ text: fact.text, dataConsent: true }), "completed", at, at);
  platform.store.exec("INSERT INTO steps(id,run_id,position,capability_id,version,definition_hash,status,output,finished_at) VALUES(?,?,?,?,?,?,?,?,?)", "step_local", runId, 0, "trace.evidence.verify", "1.0.0", "local-fixture", "completed", JSON.stringify(bundle), at);
  return runId;
}

describe("当前判断、冻结档案和搜索预算", () => {
  it("无补查的规则变化会变脏，新增更正版并保留旧文件；重复维护不产生新版本", async () => {
    const oldPublic = process.env.PLATFORM_PUBLIC;
    delete process.env.PLATFORM_PUBLIC;
    const dir = await mkdtemp(join(tmpdir(), "trace-version-"));
    const p = await createPlatform({ dbPath: join(dir, "db.sqlite"), artifactRoot: join(dir, "artifacts") });
    try {
      const rid = await seededTrace(p);
      const old = structuredClone(buildAssessment(p.store.run(rid)!).assessment);
      old.verdict.outcome = "contradicted";
      const file = await p.engine.writeArtifact(rid, "step_local", "调查档案.md", "旧档案保持原样", "text/markdown", new AbortController().signal, { requireActive: false });
      const record = { revision: 1, at: "2025-01-01T00:00:00.000Z", actor: "历史", artifacts: [file], assessment: old, followupCount: 0, correctionCount: 0, changes: [] };
      p.store.exec("INSERT INTO evidence VALUES(?,?,?,?,?,?,?)", "e_old", rid, "step_local", "trace.revision", hash(record), JSON.stringify(record), record.at);
      expect((await p.app.inject({ method: "GET", url: `/v1/runs/${rid}/trace/revisions` })).json().dirty).toBe(true);
      const fresh = await redeliverArchive(p.store, p.engine, rid, "规则修复重算（维护操作）");
      expect(fresh.revision).toBe(2);
      const view = (await p.app.inject({ method: "GET", url: `/v1/runs/${rid}/trace/revisions` })).json();
      expect(view.dirty).toBe(false);
      expect(view.revisions).toHaveLength(2);
      const oldPath = p.store.get("SELECT path FROM artifacts WHERE id=?", file.id).path;
      expect(await readFile(oldPath, "utf8")).toBe("旧档案保持原样");
      await expect(redeliverArchive(p.store, p.engine, rid, "重复维护")).rejects.toMatchObject({ code: "NO_CHANGES" });
    } finally {
      await p.app.close(); await rm(dir, { recursive: true, force: true });
      if (oldPublic === undefined) delete process.env.PLATFORM_PUBLIC; else process.env.PLATFORM_PUBLIC = oldPublic;
    }
  });

  it("重试计费；手动、自动补查超额不联网；仅原文抓取不扣搜索预算", async () => {
    const keys = ["PLATFORM_PUBLIC", "PLATFORM_RUN_MAX_SEARCHES", "PLATFORM_WSA_API_KEY", "PLATFORM_WSA_MAX_ATTEMPTS", "PLATFORM_TRACE_FETCH_ENABLED"];
    const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, { PLATFORM_PUBLIC: "1", PLATFORM_RUN_MAX_SEARCHES: "1", PLATFORM_WSA_API_KEY: "local-fixture", PLATFORM_WSA_MAX_ATTEMPTS: "2", PLATFORM_TRACE_FETCH_ENABLED: "false" });
    const dir = await mkdtemp(join(tmpdir(), "trace-budget-"));
    const p = await createPlatform({ dbPath: join(dir, "db.sqlite"), artifactRoot: join(dir, "artifacts") });
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ Error: { Code: "RequestLimitExceeded" } }), { status: 429 }));
    try {
      const rid = await seededTrace(p);
      const minted = await p.app.inject({ method: "POST", url: "/v1/session", headers: { "x-platform-client": "workbench-v1" } });
      const session = minted.json();
      const cookie = String(minted.headers["set-cookie"] || "").split(";")[0];
      p.store.exec("UPDATE runs SET owner=? WHERE id=?", session.sessionId, rid);
      const headers = { "x-platform-client": "workbench-v1", cookie };
      const attempt = await traceSearch(rid, "水星 金星 天然卫星");
      expect(attempt.error?.code).toBe("SEARCH_LIMIT_PER_RUN");
      expect(attempt.attempts).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      const manual = await p.app.inject({ method: "POST", url: `/v1/runs/${rid}/trace/followup`, headers, payload: { query: "水星 卫星 原文" } });
      expect(manual.json().error.code).toBe("SEARCH_LIMIT_PER_RUN");
      const auto = await p.app.inject({ method: "POST", url: `/v1/runs/${rid}/trace/auto`, headers, payload: { max: 1 } });
      expect(auto.json().executed[0].error.code).toBe("SEARCH_LIMIT_PER_RUN");
      await p.app.inject({ method: "POST", url: `/v1/runs/${rid}/trace/followup`, headers, payload: { query: "水星原文", sourceOnly: true, sourceUrls: ["https://science.example.org/planets"] } });
      const restricted = await p.app.inject({ method: "POST", url: `/v1/runs/${rid}/trace/followup`, headers, payload: { query: "查询某明星家庭住址" } });
      expect(restricted.json().code).toBe("TRACE_SCOPE_RESTRICTED");
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(p.store.get("SELECT count FROM search_usage WHERE run_id=?", rid).count).toBe(1);
    } finally {
      fetch.mockRestore(); await p.app.close(); await rm(dir, { recursive: true, force: true });
      for (const key of keys) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
    }
  });
});

describe("Public approval expiration", () => {
  const previous = process.env.PLATFORM_PUBLIC;
  afterEach(() => {
    if (previous === undefined) delete process.env.PLATFORM_PUBLIC;
    else process.env.PLATFORM_PUBLIC = previous;
  });

  it("expires only abandoned public approvals and preserves the run for audit", async () => {
    process.env.PLATFORM_PUBLIC = "1";
    const dir = await mkdtemp(join(tmpdir(), "trace-public-closeout-"));
    const platform = await createPlatform({ dbPath: join(dir, "data.sqlite"), artifactRoot: join(dir, "artifacts") });
    try {
      const project = platform.engine.createProject({
        name: "公网审批测试",
        layout: "agent",
        permissions: standardPermissions,
        steps: structuredClone(standardAssembly),
      });
      const created = platform.engine.createRun(project.id, {
        filename: "case.txt",
        text: "对比两条公开来源，人工批准后归档。",
      });
      let waiting = platform.store.run(created.id);
      for (let i = 0; i < 200 && waiting?.status !== "waiting_approval"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        waiting = platform.store.run(created.id);
      }
      expect(waiting?.status).toBe("waiting_approval");
      platform.store.exec("UPDATE runs SET owner=?,updated_at=? WHERE id=?", "ses_test", "2020-01-01T00:00:00.000Z", created.id);
      const first = expireAbandonedApprovals(platform.store, platform.engine, 300_000);
      expect(first).toBe(1);
      const canceled = platform.store.run(created.id)!;
      expect(canceled.status).toBe("canceled");
      expect(canceled.approvals.every((a) => a.status === "canceled")).toBe(true);
      expect(canceled.events.some((e) => e.type === "approval.expired")).toBe(true);
      expect(expireAbandonedApprovals(platform.store, platform.engine, 300_000)).toBe(0);
      expect(() => platform.engine.decide(created.id, waiting!.approvals[0].id, "approve", "迟到审核")).toThrow();
    } finally {
      await platform.app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import { traceDisplayRun } from "../services/runtime/src/trace-display.ts";
it("页面视图移除重复原文但保留来源判断，原始记录不变", () => {
  const original = {
    assembly: [{capabilityId:"trace.web.search"}],
    steps: [{ input: {text:"raw"}, output: {
      case:{question:"问题"}, text:"重复文本", bodyTexts:{p:{text:"正文"}}, documents:[{text:"正文"}],
      assessment:{facts:[{fact:"事实",sources:[{url:"https://example.com",keySentence:"关键原文"}]}]},
    }}],
    evidence:[{data:{pages:[{passage:"摘要"}],bodies:[{pageId:"p",ok:true,text:"正文",textLength:2}]}}],
  };
  const view = traceDisplayRun(original as any);
  expect((view.steps[0].output as any).bodyTexts).toBeUndefined();
  expect((view.steps[0].output as any).assessment.facts[0].sources[0].keySentence).toBe("关键原文");
  expect((view.evidence[0].data as any).pages[0].passage).toBe("摘要");
  expect(original.steps[0].output.bodyTexts.p.text).toBe("正文");
});
