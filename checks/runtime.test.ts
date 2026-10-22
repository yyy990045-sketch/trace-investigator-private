import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatform } from "../services/runtime/src/app";
import {
  standardAssembly,
  standardPermissions,
  type ProjectDraft,
} from "@personal/capability-sdk";
import { hash } from "../services/runtime/src/util";
import {
  bundleSchema,
  emptyConfig,
  ExecutionError,
} from "../services/runtime/src/contracts";

const input = {
  filename: "授权测试.txt",
  text: "本轮资料只包含范围说明和交付安排。\n\n所有结论保留来源，人工确认后生成文件。",
};
const project = (changes: Partial<ProjectDraft> = {}): ProjectDraft => ({
  name: "运行验收项目",
  layout: "agent",
  permissions: standardPermissions,
  steps: structuredClone(standardAssembly),
  ...changes,
});
let dir: string, p: Awaited<ReturnType<typeof createPlatform>>;
async function until(rid: string, status: string) {
  for (let i = 0; i < 250; i++) {
    const r = p.store.run(rid)!;
    if (r.status === status) return r;
    if (
      ["failed", "rejected", "canceled", "completed"].includes(r.status) &&
      r.status !== status
    )
      throw new Error(JSON.stringify(r.error));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out: " + JSON.stringify(p.store.run(rid)));
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "capability-runtime-test-"));
  p = await createPlatform({
    dbPath: join(dir, "test.sqlite"),
    artifactRoot: join(dir, "artifacts"),
  });
});
afterEach(async () => {
  await p.app.close();
  await rm(dir, { recursive: true, force: true });
});
describe("Real persisted execution", () => {
  it("parses, checks, retrieves, records evidence, approves and downloads actual files", async () => {
    const saved = p.engine.createProject(project());
    const created = p.engine.createRun(saved.id, input);
    expect(created.id.startsWith("run_")).toBe(true);
    const waiting = await until(created.id, "waiting_approval");
    expect(waiting.steps.filter((s) => s.status === "completed")).toHaveLength(
      5,
    );
    expect(waiting.artifacts).toHaveLength(0);
    p.engine.decide(
      created.id,
      waiting.approvals[0].id,
      "approve",
      "本地验收者",
    );
    const done = await until(created.id, "completed");
    expect(done.artifacts).toHaveLength(2);
    const md = done.artifacts.find((a) => a.filename.endsWith(".md"))!;
    const response = await p.app.inject({
      url: `/v1/runs/${done.id}/artifacts/${md.id}`,
    });
    expect(response.statusCode).toBe(200);
    expect(hash(response.body)).toBe(md.sha256);
    expect(response.body).toContain("授权测试.txt#段落1");
    expect(response.body).toContain("未执行模型核验");
    expect(done.evidence.some((e) => e.kind === "retrieval.sources")).toBe(
      true,
    );
    let previous = "";
    for (const event of done.events) {
      expect(event.previousHash).toBe(previous);
      expect(event.hash).toBe(
        hash({
          runId: done.id,
          type: event.type,
          data: event.data,
          at: event.at,
          previous,
        }),
      );
      previous = event.hash;
    }
    expect(
      p.registry.info(p.registry.get("documents.scope-check", "1.0.0")!).status,
    ).toBe("verified");
  });
  it("rejects and cancels persistent approval nodes; never generates delivery files", async () => {
    for (const decision of ["reject", "cancel"]) {
      const saved = p.engine.createProject(project());
      const r = p.engine.createRun(saved.id, input),
        waiting = await until(r.id, "waiting_approval");
      if (decision === "reject")
        p.engine.decide(r.id, waiting.approvals[0].id, "reject", "验收者");
      else p.engine.cancel(r.id);
      const final = p.store.run(r.id)!;
      expect(final.status).toBe(
        decision === "reject" ? "rejected" : "canceled",
      );
      expect(final.artifacts).toHaveLength(0);
      expect(() =>
        p.engine.decide(r.id, waiting.approvals[0].id, "approve", "迟到决定"),
      ).toThrow();
    }
  });
  it("records actual malformed input, scope violations and unresolved source conflicts", async () => {
    const texts = [
      { filename: "bad.json", text: "{" },
      {
        filename: "scope.json",
        text: JSON.stringify({
          documents: [{ id: "a", text: "资料", source: "授权测试源A", scope: "restricted" }],
        }),
      },
      {
        filename: "conflict.json",
        text: JSON.stringify({
          documents: [
            { id: "a", text: "范围A", source: "授权测试源A" },
            { id: "b", text: "范围B", source: "授权测试源B" },
          ],
          claims: [
            { key: "范围", value: "A", source: "a" },
            { key: "范围", value: "B", source: "b" },
          ],
        }),
      },
    ];
    for (const data of texts) {
      const saved = p.engine.createProject(project());
      const r = p.engine.createRun(saved.id, data);
      const failed = await until(r.id, "failed");
      expect(failed.error?.code).toBe(
        data.filename === "bad.json"
          ? "INVALID_JSON"
          : data.filename === "scope.json"
            ? "SCOPE_DENIED"
            : "UNRESOLVED_CONFLICT",
      );
      expect(failed.steps.some((s) => s.status === "failed")).toBe(true);
      expect(failed.artifacts).toHaveLength(0);
    }
  });
  it("recovers stored waiting approvals after closing and reopening SQLite, without rerunning completed steps", async () => {
    const saved = p.engine.createProject(project());
    const r = p.engine.createRun(saved.id, input);
    const waiting = await until(r.id, "waiting_approval");
    const evidenceCount = waiting.evidence.length;
    await p.app.close();
    p = await createPlatform({
      dbPath: join(dir, "test.sqlite"),
      artifactRoot: join(dir, "artifacts"),
    });
    expect(p.store.run(r.id)?.status).toBe("waiting_approval");
    expect(p.store.run(r.id)?.evidence.length).toBe(evidenceCount);
    p.engine.decide(r.id, waiting.approvals[0].id, "approve", "重启后确认人");
    const done = await until(r.id, "completed");
    expect(done.steps.slice(0, 5).every((s) => s.attempts === 1)).toBe(true);
  });
  it("blocks incompatible, missing version, permission and provider combinations before execution", () => {
    const bad = [
      project({ permissions: [] }),
      project({ steps: [standardAssembly[0], standardAssembly[0]] }),
      project({ steps: [{ ...standardAssembly[0], version: "9.0.0" }] }),
      project({
        steps: [
          ...standardAssembly.slice(0, 3),
          {
            capabilityId: "knowledge.remote.search",
            version: "1.0.0",
            config: {},
          },
        ],
      }),
    ];
    for (const data of bad) {
      const saved = p.engine.createProject(data);
      expect(saved.validation.ready).toBe(false);
      expect(() => p.engine.createRun(saved.id, input)).toThrow();
    }
    const saved = p.engine.createProject(project());
    p.store.exec(
      "INSERT INTO capability_settings VALUES(?,?,?)",
      "documents.parse",
      "1.0.0",
      0,
    );
    expect(() => p.engine.createRun(saved.id, input)).toThrow();
    expect(p.store.all("SELECT id FROM runs")).toHaveLength(0);
  });
  it("loads a new executable plugin without editing Engine, passes output to later steps and retains its evidence", async () => {
    const steps = structuredClone(standardAssembly);
    steps.splice(2, 0, {
      capabilityId: "text.metrics",
      version: "1.0.0",
      config: {},
    });
    const saved = p.engine.createProject(project({ steps }));
    const r = p.engine.createRun(saved.id, input),
      waiting = await until(r.id, "waiting_approval");
    const metric = waiting.evidence.find(
      (e) => e.kind === "extension.text-metrics",
    );
    expect((metric?.data as any).characters).toBeGreaterThan(0);
    p.engine.decide(r.id, waiting.approvals[0].id, "approve", "插件验收者");
    const done = await until(r.id, "completed");
    expect(
      (done.steps.at(-1)?.output as any).metrics.characters,
    ).toBeGreaterThan(0);
  });
  it("protects external writes with permission and approval bound to the exact step input", async () => {
    let actualCalls = 0;
    p.registry.register(
      {
        id: "test.external-write",
        version: "1.0.0",
        name: "隔离权限测试能力",
        description: "No production call",
        inputProtocol: "document.bundle.v1",
        outputProtocol: "document.bundle.v1",
        inputSchema: bundleSchema,
        outputSchema: bundleSchema,
        configSchema: emptyConfig,
        defaultConfig: {},
        permissions: [],
        effects: ["external_write"],
        kind: "tool",
        idempotent: false,
        assets: [],
        async execute(value) {
          actualCalls++;
          return value;
        },
      },
      "isolated-test",
    );
    const steps = [
      standardAssembly[0],
      { capabilityId: "test.external-write", version: "1.0.0", config: {} },
    ];
    const blocked = p.engine.createProject(project({ steps }));
    expect(() => p.engine.createRun(blocked.id, input)).toThrow();
    expect(actualCalls).toBe(0);
    const saved = p.engine.createProject(
      project({
        steps,
        permissions: [...standardPermissions, "external:write"],
      }),
    );
    const r = p.engine.createRun(saved.id, input);
    const waiting = await until(r.id, "waiting_approval");
    expect(actualCalls).toBe(0);
    p.engine.decide(r.id, waiting.approvals[0].id, "approve", "权限测试者");
    await until(r.id, "completed");
    expect(actualCalls).toBe(1);
  });
  it("validates capability outputs and applies bounded retry only for declared idempotent transient failure", async () => {
    let calls = 0;
    p.registry.register(
      {
        id: "test.transient",
        version: "1.0.0",
        name: "隔离重试验证",
        description: "Actual exception then actual pass-through",
        inputProtocol: "document.bundle.v1",
        outputProtocol: "document.bundle.v1",
        inputSchema: bundleSchema,
        outputSchema: bundleSchema,
        configSchema: emptyConfig,
        defaultConfig: {},
        permissions: [],
        effects: ["none"],
        kind: "tool",
        idempotent: true,
        assets: [],
        async execute(value) {
          if (++calls === 1)
            throw new ExecutionError("TEMPORARY", "隔离临时错误", true);
          return value;
        },
      },
      "retry-test",
    );
    const saved = p.engine.createProject(
      project({
        steps: [
          standardAssembly[0],
          {
            capabilityId: "test.transient",
            version: "1.0.0",
            config: {},
            retries: 1,
          },
        ],
      }),
    );
    const r = p.engine.createRun(saved.id, input);
    const done = await until(r.id, "completed");
    expect(done.steps[1].attempts).toBe(2);
    expect(done.events.some((e) => e.type === "step.retry")).toBe(true);
  });
  it("rejects cross-origin mutations and stale project revisions", async () => {
    const saved = p.engine.createProject(project());
    const denied = await p.app.inject({
      method: "POST",
      url: `/v1/projects/${saved.id}/runs`,
      headers: {
        origin: "https://unrelated.invalid",
        "x-platform-client": "workbench-v1",
      },
      payload: input,
    });
    expect(denied.statusCode).toBe(403);
    const headers = { "x-platform-client": "workbench-v1" };
    const ok = await p.app.inject({
      method: "PUT",
      url: "/v1/projects/" + saved.id,
      headers,
      payload: { ...project(), revision: 1 },
    });
    expect(ok.statusCode).toBe(200);
    const stale = await p.app.inject({
      method: "PUT",
      url: "/v1/projects/" + saved.id,
      headers,
      payload: { ...project(), revision: 1 },
    });
    expect(stale.statusCode).toBe(409);
  });
});

describe("Failure controls and dependency honesty", () => {
  it("rejects invalid capability output before downstream steps", async () => {
    p.registry.register(
      {
        id: "test.invalid-output",
        version: "1.0.0",
        name: "隔离输出校验",
        description: "Intentional invalid output for contract verification",
        inputProtocol: "document.bundle.v1",
        outputProtocol: "document.bundle.v1",
        inputSchema: bundleSchema,
        outputSchema: bundleSchema,
        configSchema: emptyConfig,
        defaultConfig: {},
        permissions: [],
        effects: ["none"],
        kind: "tool",
        idempotent: true,
        assets: [],
        async execute() {
          return {};
        },
      },
      "invalid-output",
    );
    const saved = p.engine.createProject(
      project({
        steps: [
          standardAssembly[0],
          { capabilityId: "test.invalid-output", version: "1.0.0", config: {} },
        ],
      }),
    );
    const run = p.engine.createRun(saved.id, input);
    expect((await until(run.id, "failed")).error?.code).toBe(
      "STEP_OUTPUT_INVALID",
    );
  });
  it("times out a non-cooperating capability without inventing completion", async () => {
    p.registry.register(
      {
        id: "test.unresponsive",
        version: "1.0.0",
        name: "隔离超时验证",
        description: "A capability that never produces output",
        inputProtocol: "document.bundle.v1",
        outputProtocol: "document.bundle.v1",
        inputSchema: bundleSchema,
        outputSchema: bundleSchema,
        configSchema: emptyConfig,
        defaultConfig: {},
        permissions: [],
        effects: ["none"],
        kind: "tool",
        idempotent: true,
        assets: [],
        execute: () => new Promise(() => {}),
      },
      "timeout",
    );
    const saved = p.engine.createProject(
      project({
        steps: [
          standardAssembly[0],
          {
            capabilityId: "test.unresponsive",
            version: "1.0.0",
            config: {},
            timeoutMs: 100,
          },
        ],
      }),
    );
    const r = p.engine.createRun(saved.id, input);
    const failed = await until(r.id, "failed");
    expect(failed.error?.code).toBe("STEP_TIMEOUT");
    expect(failed.steps[1].output).toBe(null);
  });
  it("cancels an actually running, abort-aware tool", async () => {
    p.registry.register(
      {
        id: "test.abort-aware",
        version: "1.0.0",
        name: "隔离取消验证",
        description: "Waits for abort, never returns fabricated output",
        inputProtocol: "document.bundle.v1",
        outputProtocol: "document.bundle.v1",
        inputSchema: bundleSchema,
        outputSchema: bundleSchema,
        configSchema: emptyConfig,
        defaultConfig: {},
        permissions: [],
        effects: ["none"],
        kind: "tool",
        idempotent: true,
        assets: [],
        execute: (value, config, ctx) =>
          new Promise((_, reject) =>
            ctx.signal.addEventListener(
              "abort",
              () => reject(ctx.signal.reason),
              { once: true },
            ),
          ),
      },
      "cancel",
    );
    const saved = p.engine.createProject(
      project({
        steps: [
          standardAssembly[0],
          { capabilityId: "test.abort-aware", version: "1.0.0", config: {} },
        ],
      }),
    );
    const r = p.engine.createRun(saved.id, input);
    await until(r.id, "running");
    p.engine.cancel(r.id);
    const canceled = await until(r.id, "canceled");
    expect(canceled.artifacts).toHaveLength(0);
  });
  it("keeps an in-flight external write outcome uncertain rather than falsely claiming cancellation", async () => {
    p.registry.register(
      {
        id: "test.uncertain-write",
        version: "1.0.0",
        name: "隔离副作用取消",
        description: "Does not call a real external service",
        inputProtocol: "document.bundle.v1",
        outputProtocol: "document.bundle.v1",
        inputSchema: bundleSchema,
        outputSchema: bundleSchema,
        configSchema: emptyConfig,
        defaultConfig: {},
        permissions: [],
        effects: ["external_write"],
        kind: "tool",
        idempotent: false,
        assets: [],
        execute: (value, config, ctx) =>
          new Promise((_, reject) =>
            ctx.signal.addEventListener(
              "abort",
              () => reject(ctx.signal.reason),
              { once: true },
            ),
          ),
      },
      "uncertain",
    );
    const saved = p.engine.createProject(
      project({
        permissions: [...standardPermissions, "external:write"],
        steps: [
          standardAssembly[0],
          {
            capabilityId: "test.uncertain-write",
            version: "1.0.0",
            config: {},
          },
        ],
      }),
    );
    const r = p.engine.createRun(saved.id, input),
      waiting = await until(r.id, "waiting_approval");
    p.engine.decide(r.id, waiting.approvals[0].id, "approve", "隔离测试");
    await until(r.id, "running");
    p.engine.cancel(r.id);
    const failed = await until(r.id, "failed");
    expect(failed.error?.code).toBe("EXTERNAL_OUTCOME_UNCERTAIN");
    expect(() => p.engine.retry(r.id)).toThrow();
  });
});

// Guards for review findings: authorization, version agreement and shutdown cleanup.
describe("Reviewed runtime boundaries", () => {
  it("blocks stale run creation through HTTP", async () => {
    const saved = p.engine.createProject(project());
    const response = await p.app.inject({ method: "POST", url: `/v1/projects/${saved.id}/runs`,
      headers: { "x-platform-client": "workbench-v1" }, payload: { ...input, expectedRevision: 99 } });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("PROJECT_CONFLICT");
    expect(p.store.all("SELECT id FROM runs")).toHaveLength(0);
  });
  it("blocks undeclared model and artifact operations even if plugin fabricates consent", async () => {
    for (const operation of ["model", "artifact"]) {
      const def = { ...p.registry.get("runtime.snapshot", "1.0.0")!, id: "test.context-" + operation,
        permissions: [], effects: ["none"] as ["none"], async execute(value: any, config: any, ctx: any) {
          if (operation === "model") await ctx.model({ ...value, modelConsent: true });
          else await ctx.artifact("unauthorized.txt", "no", "text/plain");
          return value;
        } };
      p.registry.register(def, "context-guard-" + operation);
      const saved = p.engine.createProject(project({steps: [standardAssembly[0], {capabilityId: def.id, version:"1.0.0",config:{}}]}));
      const run = p.engine.createRun(saved.id, input);
      const failed = await until(run.id, "failed");
      expect(failed.error?.code).toBe(operation === "model" ? "MODEL_PERMISSION_DENIED" : "ARTIFACT_PERMISSION_DENIED");
      expect(failed.modelCalls).toHaveLength(0);
      expect(failed.artifacts).toHaveLength(0);
    }
  });
  it("does not reuse approval across unrelated steps with identical inputs", async () => {
    const definition = { ...p.registry.get("human.confirm", "1.0.0")!, id: "test.separate-approval", approvalScope: undefined };
    p.registry.register(definition, "separate-approval");
    const saved = p.engine.createProject(project({ steps: [...standardAssembly.slice(0,1), standardAssembly[5], {capabilityId:definition.id,version:"1.0.0",config:{}}]}));
    const run = p.engine.createRun(saved.id,input);
    const first = await until(run.id,"waiting_approval");
    p.engine.decide(run.id,first.approvals[0].id,"approve","本机验收");
    const second = await until(run.id,"waiting_approval");
    expect(second.approvals).toHaveLength(2);
    expect(second.approvals[1].status).toBe("pending");
    p.engine.cancel(run.id);
  });
  it("drains provider cleanup and blocks late capability evidence after shutdown", async () => {
    let late: (()=>void) | undefined;
    const def = { ...p.registry.get("runtime.snapshot","1.0.0")!, id:"test.late-cleanup", execute: (value:any,config:any,ctx:any) => new Promise<any>(() => { late=()=>ctx.evidence("late",{}); }) };
    p.registry.register(def,"late-cleanup");
    const saved=p.engine.createProject(project({steps:[standardAssembly[0],{capabilityId:def.id,version:"1.0.0",config:{}}]}));
    const run=p.engine.createRun(saved.id,input);
    for(let i=0;!late && i<100;i++) await new Promise(resolve=>setTimeout(resolve,2));
    let cleaned=false;
    p.engine.track(new Promise(resolve=>setTimeout(()=>{ cleaned=true; resolve(null); },20)));
    await p.engine.stop();
    expect(cleaned).toBe(true);
    expect(()=>late!()).toThrow();
    expect(p.store.run(run.id)?.status).toBe("canceled");
  });
});
