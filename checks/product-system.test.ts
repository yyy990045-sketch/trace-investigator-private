import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatform } from "../services/runtime/src/app";
import {
  standardAssembly,
  standardPermissions,
  type ProjectDraft,
} from "@personal/capability-sdk";

const headers = { "x-platform-client": "workbench-v1" };
const project = (changes: Partial<ProjectDraft> = {}): ProjectDraft => ({
  name: "产品体系验收项目",
  layout: "agent",
  permissions: standardPermissions,
  steps: structuredClone(standardAssembly),
  ...changes,
});
const scoped = (scope: string) =>
  JSON.stringify({
    documents: [
      { id: "doc-1", text: "本轮资料用于核验范围与交付。", source: "本机合成资料", scope },
    ],
    claims: [],
  });
let dir: string, p: Awaited<ReturnType<typeof createPlatform>>;
const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
  p.app.inject({ method, url, headers, payload: payload as any });
async function until(runId: string, status: string) {
  for (let i = 0; i < 400; i++) {
    const run = p.store.run(runId)!;
    if (run.status === status) return run;
    if (["failed", "rejected", "canceled", "completed"].includes(run.status) && run.status !== status)
      throw new Error("意外的运行状态：" + run.status + " " + JSON.stringify(run.error));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("等待超时：" + status);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "product-system-test-"));
  p = await createPlatform({ dbPath: join(dir, "test.sqlite"), artifactRoot: join(dir, "artifacts") });
});
afterEach(async () => {
  await p.app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("能力组合跨项目复用", () => {
  it("保存组合后能在另一个项目里复用，并拒绝过期修订", async () => {
    const created = await call("POST", "/v1/compositions", {
      name: "标准资料核验组合",
      permissions: standardPermissions,
      steps: structuredClone(standardAssembly),
      createdBy: "本机验收者",
    });
    expect(created.statusCode).toBe(201);
    const composition = created.json();
    expect(composition.capabilities).toHaveLength(standardAssembly.length);

    const target = p.engine.createProject(project({ name: "复用目标项目", steps: [] }));
    const applied = await call("POST", `/v1/projects/${target.id}/compositions`, {
      compositionId: composition.id,
      revision: target.revision,
      mode: "replace",
    });
    expect(applied.statusCode).toBe(200);
    const updated = applied.json();
    expect(updated.steps).toHaveLength(standardAssembly.length);
    expect(updated.revision).toBe(target.revision + 1);
    expect(p.store.get("SELECT reuse_count FROM compositions WHERE id=?", composition.id).reuse_count).toBe(1);

    const stale = await call("POST", `/v1/projects/${target.id}/compositions`, {
      compositionId: composition.id,
      revision: target.revision,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("PROJECT_CONFLICT");
  });

  it("含未注册能力的组合不允许保存", async () => {
    const blocked = await call("POST", "/v1/compositions", {
      name: "不可执行组合",
      permissions: standardPermissions,
      steps: [{ capabilityId: "not.registered", version: "1.0.0", config: {} }],
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().code).toBe("COMPOSITION_BLOCKED");
    expect(blocked.json().issues[0].code).toBe("VERSION_NOT_REGISTERED");
  });
});

describe("运行反馈与经验沉淀", () => {
  it("未结束的运行不能记反馈，失败运行必须写清人工修正", async () => {
    const saved = p.engine.createProject(project());
    const waiting = p.engine.createRun(saved.id, {
      filename: "反馈测试.txt",
      text: "资料段落一。\n\n资料段落二。",
    });
    await until(waiting.id, "waiting_approval");
    const early = await call("POST", `/v1/runs/${waiting.id}/feedback`, {
      outcome: "worked",
      correction: "",
      reusable: true,
      author: "本机验收者",
    });
    expect(early.statusCode).toBe(400);
    expect(early.json().code).toBe("RUN_NOT_TERMINAL");

    const failing = p.engine.createRun(saved.id, {
      filename: "范围越界.json",
      text: scoped("medical"),
    });
    const failed = await until(failing.id, "failed");
    expect(failed.steps[1].error?.code).toBe("SCOPE_DENIED");
    const missing = await call("POST", `/v1/runs/${failing.id}/feedback`, {
      outcome: "failed",
      correction: "",
      reusable: true,
      author: "本机验收者",
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe("CORRECTION_REQUIRED");
    const ok = await call("POST", `/v1/runs/${failing.id}/feedback`, {
      outcome: "partly",
      correction: "把资料 scope 改成 general 后重跑通过。",
      reusable: true,
      referenceValue: "新项目先确认每条资料的 scope。",
      author: "本机验收者",
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().feedback.correction).toContain("general");
    expect(ok.json().run.failures[0].code).toBe("SCOPE_DENIED");
  });

  it("经验必须人工确认，且只能由成功运行升级为已验证方案", async () => {
    const saved = p.engine.createProject(project());
    const failedRun = await until(
      p.engine.createRun(saved.id, { filename: "范围越界.json", text: scoped("medical") }).id,
      "failed",
    );
    const unconfirmed = await call("POST", "/v1/experiences", {
      title: "资料范围越界",
      kind: "unverified_suggestion",
      problem: "scope 不在 allowedScopes 内。",
      resolution: "改用 general 后重跑。",
      runId: failedRun.id,
      author: "本机验收者",
      confirmed: false,
    });
    expect(unconfirmed.statusCode).toBe(400);
    expect(unconfirmed.json().code).toBe("EXPERIENCE_NOT_CONFIRMED");

    const created = await call("POST", "/v1/experiences", {
      title: "资料范围越界要先改成 general",
      kind: "unverified_suggestion",
      problem: "documents.scope-check 报 SCOPE_DENIED。",
      resolution: "把 documents[].scope 改成项目 allowedScopes 内的 general 后重跑。",
      tags: ["资料范围"],
      runId: failedRun.id,
      author: "本机验收者",
      confirmed: true,
    });
    expect(created.statusCode).toBe(201);
    const experience = created.json();
    expect(experience.capabilities).toHaveLength(standardAssembly.length);

    const found = await call("GET", "/v1/experiences?q=general&kind=unverified_suggestion");
    expect(found.json().map((e: { id: string }) => e.id)).toContain(experience.id);

    const badVerify = await call("PATCH", `/v1/experiences/${experience.id}`, {
      verifiedByRunId: failedRun.id,
    });
    expect(badVerify.statusCode).toBe(400);
    expect(badVerify.json().code).toBe("RUN_NOT_COMPLETED");

    const waiting = await until(
      p.engine.createRun(saved.id, { filename: "修正后重跑.txt", text: "资料段落一。\n\n资料段落二。" }).id,
      "waiting_approval",
    );
    p.engine.decide(waiting.id, waiting.approvals[0].id, "approve", "本机验收者");
    await until(waiting.id, "completed");
    const verified = await call("PATCH", `/v1/experiences/${experience.id}`, {
      verifiedByRunId: waiting.id,
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().kind).toBe("verified_solution");
    expect(verified.json().verifiedRunId).toBe(waiting.id);
  });
});

describe("平台概览与项目应用", () => {
  it("概览按真实运行聚合，未配置模型时明确说明没有数据", async () => {
    const saved = p.engine.createProject(project());
    await until(p.engine.createRun(saved.id, { filename: "概览.txt", text: "资料段落。" }).id, "waiting_approval");
    const overview = await call("GET", "/v1/overview");
    expect(overview.statusCode).toBe(200);
    const data = overview.json();
    const entry = data.projects.find((item: { id: string }) => item.id === saved.id);
    expect(entry.capabilities).toHaveLength(standardAssembly.length);
    expect(entry.runs.pending).toBe(1);
    expect(data.models.calls).toBe(0);
    expect(data.models.cost).toBe("not_tracked");
  });

  it("未授权端口不允许生成独立应用", async () => {
    const saved = p.engine.createProject(project());
    const blocked = await call("POST", `/v1/projects/${saved.id}/application`, {
      appName: "verify-app",
      port: 65530,
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().code).toBe("APP_ORIGIN_NOT_ALLOWED");
    expect(await call("GET", `/v1/projects/${saved.id}/application`).then((r) => r.json())).toBeNull();
  });
});
