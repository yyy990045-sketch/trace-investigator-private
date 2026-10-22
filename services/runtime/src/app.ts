import { searchConfiguration } from "../adapters/trace/searchpro.ts";
import { registerTraceEndpoints } from "./trace-followup.ts";
import Fastify from "fastify";
import { resolve, join } from "node:path";
import { readFile, readdir, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Store } from "./store.ts";
import { Registry } from "./registry.ts";
import { Engine } from "./engine.ts";
import { builtins } from "../capabilities/builtins.ts";
import { modelConfiguration } from "./providers.ts";
import { ExecutionError, type CapabilityDefinition } from "./contracts.ts";
import { hash, now } from "./util.ts";
import type { ProjectDraft, UploadInput } from "@personal/capability-sdk";
const root = resolve(import.meta.dirname, "../../..");
export async function createPlatform(
  options: {
    dbPath?: string;
    artifactRoot?: string;
    pluginDir?: string;
    recover?: boolean;
  } = {},
) {
  const store = new Store(
    options.dbPath ||
      resolve(
        process.env.PLATFORM_DATA_DIR || join(root, "data"),
        "platform.sqlite",
      ),
  );
  const registry = new Registry(store);
  const builtinHash = hash(
    (
      await readFile(new URL("../capabilities/builtins.ts", import.meta.url))
    ).toString(),
  );
  for (const cap of await builtins()) registry.register(cap, builtinHash);
  const pluginDir =
    options.pluginDir || resolve(import.meta.dirname, "../plugins");
  for (const file of (await readdir(pluginDir))
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
    .sort()) {
    const full = join(pluginDir, file);
    const mod = await import(pathToFileURL(full).href);
    registry.register(
      mod.default as CapabilityDefinition,
      hash((await readFile(full)).toString()),
    );
  }
  const engine = new Engine(
    store,
    registry,
    options.artifactRoot ||
      resolve(process.env.PLATFORM_DATA_DIR || join(root, "data"), "artifacts"),
  );
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const allowed = new Set(
    (
      process.env.PLATFORM_ALLOWED_ORIGINS ||
      "http://127.0.0.1:4310,http://127.0.0.1:4311,http://127.0.0.1:4312,http://127.0.0.1:4314,http://127.0.0.1:4315,http://127.0.0.1:4316,http://127.0.0.1:4414,http://127.0.0.1:4415,http://127.0.0.1:4416"
    ).split(","),
  );
  app.addHook("onRequest", async (req, reply) => {
    const host = new URL("http://" + (req.headers.host || "localhost"))
      .hostname;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
      reply.code(403);
      throw new ExecutionError("HOST_DENIED", "仅允许本机运行服务主机名。");
    }
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) {
      reply.code(403);
      throw new ExecutionError(
        "ORIGIN_DENIED",
        "此页面未获准访问本机运行服务。",
      );
    }
    if (origin) {
      reply
        .header("Access-Control-Allow-Origin", origin)
        .header("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      reply
        .header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS")
        .header(
          "Access-Control-Allow-Headers",
          "content-type,x-platform-client",
        );
      return reply.code(204).send();
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-platform-client"] !== "workbench-v1"
    ) {
      reply.code(403);
      throw new ExecutionError(
        "CLIENT_HEADER_REQUIRED",
        "写操作需要本平台客户端标识。",
      );
    }
  });
  app.setErrorHandler((error: any, req, reply) => {
    const code = error.code || "INTERNAL_ERROR";
    const known = error instanceof ExecutionError;
    const status =
      reply.statusCode >= 400
        ? reply.statusCode
        : code.endsWith("_NOT_FOUND")
          ? 404
          : /CONFLICT|CHANGED/.test(code)
            ? 409
            : code === "ASSEMBLY_BLOCKED"
              ? 409
              : known || error.validation
                ? 400
                : 500;
    reply
      .code(status)
      .send({
        code,
        message: known
          ? error.message
          : error.validation
            ? "请求格式不正确。"
            : "运行服务内部错误；详细内容未写入公共日志。",
        ...(error.issues ? { issues: error.issues } : {}),
      });
  });
  const projectBody = {
    type: "object",
    required: ["name", "layout", "permissions", "steps"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 80 },
      layout: { enum: ["agent", "business"] },
      permissions: {
        type: "array",
        uniqueItems: true,
        items: { type: "string", maxLength: 80 },
      },
      steps: {
        type: "array",
        maxItems: 30,
        items: {
          type: "object",
          required: ["capabilityId", "version", "config"],
          properties: {
            capabilityId: { type: "string", maxLength: 100 },
            version: { type: "string", maxLength: 30 },
            config: { type: "object" },
            retries: { type: "integer", minimum: 0, maximum: 2 },
            timeoutMs: { type: "integer", minimum: 100, maximum: 120000 },
          },
          additionalProperties: false,
        },
      },
      revision: { type: "integer", minimum: 1 },
    },
    additionalProperties: false,
  };
  app.get("/v1/health", async () => ({
    status: "ok",
    service: "personal-capability-runtime",
    version: "0.3.0",
    database: "sqlite",
  }));
  app.get("/v1/catalog", async () => ({
    ...(await registry.catalog()),
    providers: [
      {
        id: "local-upload-lexical",
        available: true,
        reason: "仅检索本次授权上传资料；词项匹配，无远程知识库和向量检索。",
      },
      { id: "platform-model", ...modelConfiguration() },
      // 元宝搜索：可用性来自服务端进程配置，前端只读，不接触密钥。
      {
        id: "tencent-wsa-search",
        available: searchConfiguration().available,
        reason: searchConfiguration().reason,
        provider: searchConfiguration().provider,
        endpointHost: searchConfiguration().endpointHost,
      },
      {
        id: "historical-remote-rag",
        available: false,
        reason: "历史远程客户端未适配/未授权，未读取旧凭证。",
      },
    ],
  }));
  app.patch<{
    Params: { id: string; version: string };
    Body: { enabled: boolean };
  }>(
    "/v1/capabilities/:id/:version",
    {
      schema: {
        body: {
          type: "object",
          required: ["enabled"],
          properties: { enabled: { type: "boolean" } },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const def = registry.get(req.params.id, req.params.version);
      if (!def)
        throw new ExecutionError("CAPABILITY_NOT_FOUND", "能力版本不存在。");
      store.exec(
        "INSERT INTO capability_settings VALUES(?,?,?) ON CONFLICT(capability_id,version) DO UPDATE SET enabled=excluded.enabled",
        def.id,
        def.version,
        req.body.enabled ? 1 : 0,
      );
      return registry.info(def);
    },
  );
  app.get("/v1/projects", async () =>
    store
      .all("SELECT * FROM projects ORDER BY updated_at DESC")
      .map((p) => engine.project(p.id)),
  );
  app.post<{ Body: ProjectDraft }>(
    "/v1/projects",
    { schema: { body: projectBody } },
    async (req, reply) => {
      if (!req.body.name.trim())
        throw new ExecutionError("INVALID_PROJECT_NAME", "项目名称不能为空。");
      reply.code(201);
      return engine.createProject({ ...req.body, name: req.body.name.trim() });
    },
  );
  app.get<{ Params: { id: string } }>("/v1/projects/:id", async (req) =>
    engine.project(req.params.id),
  );
  app.put<{
    Params: { id: string };
    Body: ProjectDraft & { revision: number };
  }>(
    "/v1/projects/:id",
    {
      schema: {
        body: {
          ...projectBody,
          required: [...projectBody.required, "revision"],
        },
      },
    },
    async (req) => {
      const p = engine.project(req.params.id);
      const { revision, ...body } = req.body;
      if (!body.name.trim())
        throw new ExecutionError("INVALID_PROJECT_NAME", "项目名称不能为空。");
      const updated = store.exec(
        "UPDATE projects SET name=?,data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
        body.name,
        JSON.stringify(body),
        now(),
        p.id,
        revision,
      );
      if (updated.changes !== 1)
        throw new ExecutionError(
          "PROJECT_CONFLICT",
          "项目已被其他页面修改，请刷新后再保存。",
        );
      return engine.project(p.id);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/v1/projects/:id/validate",
    async (req) => engine.project(req.params.id).validation,
  );
  app.post<{ Params: { id: string }; Body: UploadInput & { expectedRevision: number } }>(
    "/v1/projects/:id/runs",
    async (req, reply) => {
      reply.code(201);
      const { expectedRevision, ...input } = req.body;
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
        throw new ExecutionError("REVISION_REQUIRED", "执行需要明确的项目组合版本。");
      return engine.createRun(req.params.id, input, expectedRevision);
    },
  );
  app.get<{ Querystring: { projectId?: string } }>("/v1/runs", async (req) => {
    const rows = req.query.projectId
      ? store.all(
          "SELECT id FROM runs WHERE project_id=? ORDER BY created_at DESC LIMIT 100",
          req.query.projectId,
        )
      : store.all("SELECT id FROM runs ORDER BY created_at DESC LIMIT 100");
    return rows.map((r) => {
      const run = store.run(r.id)!;
      return { ...run, evidence: [], modelCalls: [] };
    });
  });
  app.get<{ Params: { id: string } }>("/v1/runs/:id", async (req) => {
    const run = store.run(req.params.id);
    if (!run) throw new ExecutionError("RUN_NOT_FOUND", "任务不存在。");
    return run;
  });
  app.post<{ Params: { id: string } }>("/v1/runs/:id/cancel", async (req) =>
    engine.cancel(req.params.id),
  );
  app.post<{ Params: { id: string } }>("/v1/runs/:id/retry", async (req) =>
    engine.retry(req.params.id),
  );
  app.post<{
    Params: { id: string; approvalId: string };
    Body: { decision: "approve" | "reject"; actor: string };
  }>(
    "/v1/runs/:id/approvals/:approvalId",
    {
      schema: {
        body: {
          type: "object",
          required: ["decision", "actor"],
          properties: {
            decision: { enum: ["approve", "reject"] },
            actor: { type: "string", minLength: 1, maxLength: 80 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      if (!req.body.actor.trim())
        throw new ExecutionError("ACTOR_REQUIRED", "请填写确认人。");
      return engine.decide(
        req.params.id,
        req.params.approvalId,
        req.body.decision,
        req.body.actor.trim(),
      );
    },
  );
  // A final receipt is derived only after completion; export-step snapshots stay immutable.
  app.get<{ Params: { id: string } }>("/v1/runs/:id/receipt", async (req, reply) => {
    const run = store.run(req.params.id);
    if (!run) throw new ExecutionError("RUN_NOT_FOUND", "任务不存在。");
    const completion = run.events.findLast((e) => e.type === "run.completed");
    // 导出步骤按「声明了本地文件副作用且已完成」识别，兼容 report.export 与业务自有导出（如 trace.archive.export）。
    const exportSteps = run.steps.filter((s) => {
      const manifest = run.assembly.find(
        (a) => a.capabilityId === s.capabilityId && a.version === s.version,
      )?.manifest;
      return s.status === "completed" && (manifest?.effects || []).includes("local_file");
    });
    const exports = exportSteps.length
      ? exportSteps
      : run.steps.filter((s) => s.capabilityId === "report.export" && s.status === "completed");
    const exportEvents = run.events.filter((e) => e.type === "step.completed" &&
      exports.some((s) => s.id === (e.data as { stepId?: string }).stepId));
    const approved = run.approvals.filter((a) => a.status === "approved");
    if (run.status !== "completed" || !completion || !exports.length || !exportEvents.length || !approved.length || !run.artifacts.length)
      throw new ExecutionError("RECEIPT_NOT_FINAL", "需要运行完成、人工批准、报告导出完成事件及真实文件，才能下载最终凭证。");
    for (const a of store.all("SELECT * FROM artifacts WHERE run_id=?", run.id)) {
      let bytes;
      try { bytes = await readFile(a.path); } catch { throw new ExecutionError("ARTIFACT_MISSING", "交付文件缺失，无法证明最终交付。"); }
      if (hash(bytes.toString()) !== a.sha256 || bytes.length !== a.bytes)
        throw new ExecutionError("ARTIFACT_HASH_MISMATCH", "交付文件摘要不一致，已阻止最终凭证下载。");
    }
    const snapshot = run.steps.find((s) => s.capabilityId === "runtime.snapshot")?.output as { execution?: unknown } | undefined;
    const receipt = { receiptKind: "final-run-receipt", generatedAt: now(), runId: run.id,
      finalStatus: run.status, finalStatusAt: completion.at,
      finalStatusSource: "SQLite runs.status + persisted run.completed event, not export-time snapshot",
      completionEvent: completion, reportExportCompletionEvents: exportEvents,
      approvals: approved, artifacts: run.artifacts,
      intermediateExecutionSnapshot: snapshot?.execution || null,
      integrity: "All artifact SHA-256 values and byte counts verified at receipt generation. Local audit record, not an external signature." };
    return reply.header("cache-control", "no-store")
      .header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="${run.id}-final-receipt.json"`)
      .send(JSON.stringify(receipt, null, 2));
  });
  app.get<{ Params: { id: string; artifactId: string } }>(
    "/v1/runs/:id/artifacts/:artifactId",
    async (req, reply) => {
      const a = store.get(
        "SELECT * FROM artifacts WHERE id=? AND run_id=?",
        req.params.artifactId,
        req.params.id,
      );
      if (!a) throw new ExecutionError("ARTIFACT_NOT_FOUND", "文件不存在。");
      const run = store.run(req.params.id)!;
      if (run.status !== "completed")
        throw new ExecutionError(
          "ARTIFACT_NOT_DELIVERED",
          "任务尚未成功完成，文件不能作为正式交付下载。",
        );
      let bytes;
      try {
        bytes = await readFile(a.path);
      } catch {
        throw new ExecutionError(
          "ARTIFACT_MISSING",
          "结果文件缺失，未用预览替代。",
        );
      }
      if (hash(bytes.toString()) !== a.sha256)
        throw new ExecutionError(
          "ARTIFACT_HASH_MISMATCH",
          "文件校验失败，已阻止下载。",
        );
      return reply
        .header("content-type", a.mime)
        .header(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
        )
        .send(bytes);
    },
  );
  app.addHook("onClose", async () => {
    await engine.stop();
    store.close();
  });
  // TRACE 专用端点：证据追问与结论重算（复用真实检索/抓取与同一套规则）。
  registerTraceEndpoints(app, store);
  if (options.recover !== false) engine.recover();
  return { app, store, registry, engine };
}
