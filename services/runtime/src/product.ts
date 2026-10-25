/**
 * 产品化端点：项目独立应用、能力组合、运行反馈与经验沉淀、Studio 概览。
 *
 * 为什么单独成文件：这些都是「平台之上」的产品能力，不该塞进执行引擎。
 * 这里只做四件事，全部落在现有 SQLite 与 Registry 上，不引入新的存储或调度：
 *  1. 项目工作空间：把 Studio 里保存的真实项目生成为可独立构建的应用目录；
 *  2. 能力组合：把一段已验证的执行顺序存成命名组合，供别的项目复用；
 *  3. 运行反馈与经验：人工确认后写入经验条目，区分已验证方案／未验证建议／已知失败；
 *  4. 概览：按项目聚合真实运行、失败原因、交付文件与经验，不编造指标。
 *
 * 边界：Portfolio 正式登记源只读，这里只生成「更新建议」，不写回 assets-index.json。
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { ExecutionError } from "./contracts.ts";
import { id, now } from "./util.ts";
import { registerLinkIntake } from "./link-intake.ts";
import { registerImageIntake } from "./image-intake.ts";
import type { Store } from "./store.ts";
import type { Registry } from "./registry.ts";
import type { Engine } from "./engine.ts";
import type {
  AssemblyStep,
  CapabilityInfo,
  CompositionRecord,
  ExperienceKind,
  ExperienceRecord,
  OverviewRecord,
  ProjectApplication,
  RunFeedbackRecord,
} from "@personal/capability-sdk";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXPERIENCE_KINDS: ExperienceKind[] = [
  "verified_solution",
  "unverified_suggestion",
  "known_failure",
];
/** 这些校验问题说明组合本身不可执行，不允许存成待复用组合。 */
const BLOCKING_ISSUES = new Set([
  "EMPTY_ASSEMBLY",
  "TOO_MANY_STEPS",
  "VERSION_NOT_REGISTERED",
  "CAPABILITY_DISABLED",
  "INCOMPATIBLE_OUTPUT",
  "INVALID_CONFIG",
  "INVALID_RETRY",
  "INVALID_TIMEOUT",
  "UNSAFE_RETRY",
]);
const PENDING_STATUS = new Set([
  "queued",
  "running",
  "waiting_approval",
  "cancel_requested",
]);
const TERMINAL_STATUS = new Set([
  "completed",
  "failed",
  "rejected",
  "canceled",
]);

const stepSchema = {
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
} as const;

function parse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function capabilityRefs(registry: Registry, steps: AssemblyStep[]) {
  return steps.map((step) => {
    const def = registry.get(step.capabilityId, step.version);
    return {
      capabilityId: step.capabilityId,
      version: step.version,
      name: def?.name || step.capabilityId + "@" + step.version,
    };
  });
}

function validation(registry: Registry, steps: AssemblyStep[], permissions: string[]) {
  const result = registry.assembly({ steps, permissions });
  return {
    ready: result.ready,
    issues: result.issues,
    blocking: result.issues.filter((i) => BLOCKING_ISSUES.has(i.code)),
  };
}

function compositionRecord(
  registry: Registry,
  row: any,
): CompositionRecord {
  const steps = parse<AssemblyStep[]>(row.steps, []);
  const permissions = parse<string[]>(row.permissions, []);
  const check = validation(registry, steps, permissions);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    layout: row.layout,
    permissions,
    steps,
    capabilities: capabilityRefs(registry, steps),
    sourceProjectId: row.source_project_id,
    sourceProjectName: row.source_project_name,
    createdBy: row.created_by,
    reuseCount: row.reuse_count,
    lastReusedAt: row.last_reused_at,
    lastReusedProjectName: row.last_reused_project_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    validation: { ready: check.ready && !check.blocking.length, issues: check.issues },
  };
}

function feedbackRecord(row: any): RunFeedbackRecord {
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    projectName: row.project_name,
    outcome: row.outcome,
    correction: row.correction,
    reusable: !!row.reusable,
    referenceValue: row.reference_value,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function experienceRecord(row: any): ExperienceRecord {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    problem: row.problem,
    resolution: row.resolution,
    projectId: row.project_id,
    projectName: row.project_name,
    runId: row.run_id,
    capabilities: parse(row.capabilities, []),
    tags: parse(row.tags, []),
    sourceFeedbackId: row.source_feedback_id,
    verifiedRunId: row.verified_run_id,
    verifiedProjectName: row.verified_project_name,
    verifiedAt: row.verified_at,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function applicationRecord(row: any): ProjectApplication {
  const workspace = "@personal/" + row.app_name;
  return {
    projectId: row.project_id,
    appName: row.app_name,
    title: row.title,
    layout: row.layout,
    port: row.port,
    relativePath: row.path,
    status: row.status,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    devUrl: "http://127.0.0.1:" + row.port,
    commands: {
      dev: "npm run dev --workspace " + workspace,
      build: "npm run build --workspace " + workspace,
    },
  };
}

function portFree(port: number) {
  return new Promise<boolean>((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.once("listening", () => probe.close(() => done(true)));
    probe.listen(port, "127.0.0.1");
  });
}

function generateApplication(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    const child = spawn(process.execPath, ["tooling/create-app.mjs", ...args], {
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", (error) =>
      done({ code: 1, stdout, stderr: String(error) }),
    );
    child.once("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

export function registerProductEndpoints(
  app: FastifyInstance,
  deps: {
    store: Store;
    registry: Registry;
    engine: Engine;
    allowedOrigins: Set<string>;
  },
) {
  const { store, registry, engine, allowedOrigins } = deps;

  // 输入导入（截图之外的另一种入口：粘贴公开网页链接读正文）。
  // 之所以挂在这里而不改 app.ts：app.ts 正被并行会话修改，避免把别人的未提交改动卷进来。
  registerLinkIntake(app);
  // 输入导入（AI 识图）：仅当用户显式选择「AI 识别」时才会把截图发给模型。
  registerImageIntake(app, store);

  /* ---------------------------------------------------------------- 项目应用 */

  app.get<{ Params: { id: string } }>(
    "/v1/projects/:id/application",
    async (req) => {
      engine.project(req.params.id);
      const row = store.get(
        "SELECT * FROM project_applications WHERE project_id=?",
        req.params.id,
      );
      return row ? applicationRecord(row) : null;
    },
  );

  app.post<{
    Params: { id: string };
    Body: { appName: string; port: number; title?: string };
  }>(
    "/v1/projects/:id/application",
    {
      schema: {
        body: {
          type: "object",
          required: ["appName", "port"],
          properties: {
            appName: { type: "string", pattern: "^[a-z][a-z0-9-]{1,45}$" },
            port: { type: "integer", minimum: 1024, maximum: 65535 },
            title: { type: "string", maxLength: 80 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const project = engine.project(req.params.id);
      const { appName, port } = req.body;
      const title = (req.body.title || project.name).trim() || project.name;
      const origin = "http://127.0.0.1:" + port;
      // 不新增通配放行：生成的应用端口必须已在 Runtime 允许来源里。
      if (!allowedOrigins.has(origin))
        throw new ExecutionError(
          "APP_ORIGIN_NOT_ALLOWED",
          `端口 ${port} 尚未在 Runtime 允许来源中；当前已授权的本机入口：${[...allowedOrigins].join("、")}。请选择其中一个端口，或在 .env.platform 的 PLATFORM_ALLOWED_ORIGINS 里加入 ${origin} 后重启 Runtime。`,
        );
      if (!(await portFree(port)))
        throw new ExecutionError(
          "APP_PORT_IN_USE",
          `端口 ${port} 已被占用，请换一个已授权的空闲端口。`,
        );
      const target = resolve(ROOT, "apps", appName);
      const existing = store.get(
        "SELECT * FROM project_applications WHERE app_name=? OR project_id=?",
        appName,
        project.id,
      );
      if (existing && existing.project_id !== project.id)
        throw new ExecutionError(
          "APP_NAME_TAKEN",
          `应用目录名 ${appName} 已属于另一个项目，请换一个名称。`,
        );
      const result = await generateApplication([
        project.layout,
        appName,
        "--port",
        String(port),
        "--title",
        title,
        "--project-id",
        project.id,
      ]);
      const at = now();
      if (result.code !== 0) {
        const message = (result.stderr || result.stdout || "生成器退出")
          .trim()
          .slice(0, 400);
        store.exec(
          `INSERT INTO project_applications(project_id,app_name,title,layout,port,path,status,message,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(project_id) DO UPDATE SET app_name=excluded.app_name,title=excluded.title,layout=excluded.layout,port=excluded.port,path=excluded.path,status=excluded.status,message=excluded.message,updated_at=excluded.updated_at`,
          project.id,
          appName,
          title,
          project.layout,
          port,
          "apps/" + appName,
          "failed",
          message,
          existing?.created_at || at,
          at,
        );
        throw new ExecutionError("APP_GENERATION_FAILED", "应用生成失败：" + message);
      }
      const message = `已生成 apps/${appName}，独立端口 ${port}，绑定项目 ${project.id}。下一步：npm install（首次）→ npm run dev --workspace @personal/${appName}。`;
      store.exec(
        `INSERT INTO project_applications(project_id,app_name,title,layout,port,path,status,message,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(project_id) DO UPDATE SET app_name=excluded.app_name,title=excluded.title,layout=excluded.layout,port=excluded.port,path=excluded.path,status=excluded.status,message=excluded.message,updated_at=excluded.updated_at`,
        project.id,
        appName,
        title,
        project.layout,
        port,
        "apps/" + appName,
        "generated",
        message,
        existing?.created_at || at,
        at,
      );
      reply.code(201);
      return applicationRecord(
        store.get(
          "SELECT * FROM project_applications WHERE project_id=?",
          project.id,
        ),
      );
    },
  );

  /* ---------------------------------------------------------------- 能力组合 */

  app.get("/v1/compositions", async () =>
    store
      .all("SELECT * FROM compositions ORDER BY updated_at DESC")
      .map((row) => compositionRecord(registry, row)),
  );

  app.post<{
    Body: {
      name: string;
      description?: string;
      layout?: "agent" | "business";
      permissions?: string[];
      steps: AssemblyStep[];
      sourceProjectId?: string;
      createdBy?: string;
    };
  }>(
    "/v1/compositions",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "steps"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            description: { type: "string", maxLength: 400 },
            layout: { enum: ["agent", "business"] },
            permissions: {
              type: "array",
              uniqueItems: true,
              items: { type: "string", maxLength: 80 },
            },
            steps: { type: "array", minItems: 1, maxItems: 30, items: stepSchema },
            sourceProjectId: { type: "string", maxLength: 80 },
            createdBy: { type: "string", maxLength: 80 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const name = req.body.name.trim();
      if (!name) throw new ExecutionError("INVALID_NAME", "组合名称不能为空。");
      const steps = req.body.steps;
      const permissions = req.body.permissions || [];
      const check = validation(registry, steps, permissions);
      if (check.blocking.length)
        throw Object.assign(
          new ExecutionError(
            "COMPOSITION_BLOCKED",
            "组合里有无法执行的步骤，先修正再保存。",
          ),
          { issues: check.blocking },
        );
      const source = req.body.sourceProjectId
        ? store.get("SELECT id,name FROM projects WHERE id=?", req.body.sourceProjectId)
        : null;
      const pid = id("composition"),
        at = now();
      store.exec(
        "INSERT INTO compositions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        pid,
        name,
        (req.body.description || "").trim(),
        req.body.layout || "agent",
        JSON.stringify(permissions),
        JSON.stringify(steps),
        source?.id || null,
        source?.name || null,
        (req.body.createdBy || "本机开发者").trim(),
        0,
        null,
        null,
        null,
        at,
        at,
      );
      reply.code(201);
      return compositionRecord(
        registry,
        store.get("SELECT * FROM compositions WHERE id=?", pid),
      );
    },
  );

  app.get<{ Params: { id: string } }>("/v1/compositions/:id", async (req) => {
    const row = store.get(
      "SELECT * FROM compositions WHERE id=?",
      req.params.id,
    );
    if (!row) throw new ExecutionError("COMPOSITION_NOT_FOUND", "组合不存在。");
    return compositionRecord(registry, row);
  });

  app.delete<{ Params: { id: string } }>(
    "/v1/compositions/:id",
    async (req, reply) => {
      const removed = store.exec(
        "DELETE FROM compositions WHERE id=?",
        req.params.id,
      );
      if (removed.changes !== 1)
        throw new ExecutionError("COMPOSITION_NOT_FOUND", "组合不存在。");
      reply.code(204);
      return null;
    },
  );

  app.post<{
    Params: { id: string };
    Body: { compositionId: string; revision: number; mode?: "append" | "replace" };
  }>(
    "/v1/projects/:id/compositions",
    {
      schema: {
        body: {
          type: "object",
          required: ["compositionId", "revision"],
          properties: {
            compositionId: { type: "string", maxLength: 80 },
            revision: { type: "integer", minimum: 1 },
            mode: { enum: ["append", "replace"] },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const project = engine.project(req.params.id);
      const row = store.get(
        "SELECT * FROM compositions WHERE id=?",
        req.body.compositionId,
      );
      if (!row) throw new ExecutionError("COMPOSITION_NOT_FOUND", "组合不存在。");
      const composition = compositionRecord(registry, row);
      if (project.revision !== req.body.revision)
        throw new ExecutionError(
          "PROJECT_CONFLICT",
          "项目已被其他页面修改，请刷新后再复用组合。",
        );
      const mode = req.body.mode || "append";
      const steps =
        mode === "replace"
          ? composition.steps
          : [...project.steps, ...composition.steps];
      if (steps.length > 30)
        throw new ExecutionError(
          "TOO_MANY_STEPS",
          "复用后步骤超过30个，请先在项目里精简组合。",
        );
      const permissions = [
        ...new Set([...project.permissions, ...composition.permissions]),
      ];
      const at = now();
      const updated = store.exec(
        "UPDATE projects SET name=?,data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
        project.name,
        JSON.stringify({
          name: project.name,
          layout: project.layout,
          permissions,
          steps,
        }),
        at,
        project.id,
        req.body.revision,
      );
      if (updated.changes !== 1)
        throw new ExecutionError(
          "PROJECT_CONFLICT",
          "项目已被其他页面修改，请刷新后再复用组合。",
        );
      store.exec(
        "UPDATE compositions SET reuse_count=reuse_count+1,last_reused_at=?,last_reused_project_id=?,last_reused_project_name=?,updated_at=? WHERE id=?",
        at,
        project.id,
        project.name,
        at,
        composition.id,
      );
      return engine.project(project.id);
    },
  );

  /* ------------------------------------------------------- 运行反馈与经验沉淀 */

  function relatedExperiences(runId: string, projectId: string, steps: { capabilityId: string; version: string }[]) {
    const keys = new Set(steps.map((s) => s.capabilityId + "@" + s.version));
    const ids = new Set(steps.map((s) => s.capabilityId));
    return store
      .all("SELECT * FROM experiences ORDER BY updated_at DESC")
      .map((row) => experienceRecord(row))
      .filter(
        (e) =>
          e.runId === runId ||
          e.projectId === projectId ||
          e.capabilities.some(
            (c) =>
              keys.has(c.capabilityId + "@" + c.version) ||
              ids.has(c.capabilityId),
          ),
      );
  }

  function feedbackBundle(runId: string) {
    const run = store.run(runId);
    if (!run) throw new ExecutionError("RUN_NOT_FOUND", "运行记录不存在。");
    const row = store.get("SELECT * FROM run_feedback WHERE run_id=?", runId);
    const feedback = row ? feedbackRecord(row) : null;
    return {
      run: {
        id: run.id,
        projectId: run.projectId,
        projectName: run.projectName,
        status: run.status,
        createdAt: run.createdAt,
        inputFilename: run.input?.filename || "",
        capabilities: run.assembly.map((s) => ({
          capabilityId: s.capabilityId,
          version: s.version,
          name: s.manifest?.name || s.capabilityId,
        })),
        failures: run.steps
          .filter((s) => s.status === "failed")
          .map((s) => ({
            position: s.position,
            capabilityId: s.capabilityId,
            name:
              run.assembly.find(
                (a) =>
                  a.capabilityId === s.capabilityId && a.version === s.version,
              )?.manifest?.name || s.capabilityId,
            code: s.error?.code || "UNKNOWN",
            message: s.error?.message || "未记录原因",
            attempts: s.attempts,
            durationMs: s.durationMs,
          })),
        artifacts: run.artifacts,
      },
      feedback,
      experiences: relatedExperiences(run.id, run.projectId, run.assembly),
    };
  }

  app.get<{ Params: { id: string } }>("/v1/runs/:id/feedback", async (req) =>
    feedbackBundle(req.params.id),
  );

  app.post<{
    Params: { id: string };
    Body: {
      outcome: "worked" | "partly" | "failed";
      correction: string;
      reusable: boolean;
      referenceValue?: string;
      author: string;
    };
  }>(
    "/v1/runs/:id/feedback",
    {
      schema: {
        body: {
          type: "object",
          required: ["outcome", "correction", "reusable", "author"],
          properties: {
            outcome: { enum: ["worked", "partly", "failed"] },
            correction: { type: "string", maxLength: 4000 },
            reusable: { type: "boolean" },
            referenceValue: { type: "string", maxLength: 2000 },
            author: { type: "string", minLength: 1, maxLength: 80 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const run = store.run(req.params.id);
      if (!run) throw new ExecutionError("RUN_NOT_FOUND", "运行记录不存在。");
      if (!TERMINAL_STATUS.has(run.status))
        throw new ExecutionError(
          "RUN_NOT_TERMINAL",
          "任务还在执行中，等它结束后再记录反馈。",
        );
      const author = req.body.author.trim();
      if (!author)
        throw new ExecutionError("AUTHOR_REQUIRED", "请填写记录人。");
      const correction = req.body.correction.trim();
      if (req.body.outcome !== "worked" && !correction)
        throw new ExecutionError(
          "CORRECTION_REQUIRED",
          "非顺利完成的运行，请写清楚人工修正了什么；没有修正内容就无法复用。",
        );
      const at = now();
      const existing = store.get(
        "SELECT * FROM run_feedback WHERE run_id=?",
        run.id,
      );
      if (existing) {
        store.exec(
          "UPDATE run_feedback SET outcome=?,correction=?,reusable=?,reference_value=?,author=?,updated_at=? WHERE run_id=?",
          req.body.outcome,
          correction,
          req.body.reusable ? 1 : 0,
          (req.body.referenceValue || "").trim(),
          author,
          at,
          run.id,
        );
      } else {
        store.exec(
          "INSERT INTO run_feedback VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          id("feedback"),
          run.id,
          run.projectId,
          run.projectName,
          req.body.outcome,
          correction,
          req.body.reusable ? 1 : 0,
          (req.body.referenceValue || "").trim(),
          author,
          at,
          at,
        );
      }
      return feedbackBundle(run.id);
    },
  );

  app.get<{
    Querystring: { q?: string; kind?: string; capability?: string; limit?: string };
  }>("/v1/experiences", async (req) => {
    const q = (req.query.q || "").trim().toLowerCase();
    const kind = req.query.kind && EXPERIENCE_KINDS.includes(req.query.kind as ExperienceKind)
      ? req.query.kind
      : "";
    const capability = (req.query.capability || "").trim();
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    return store
      .all("SELECT * FROM experiences ORDER BY updated_at DESC")
      .map((row) => experienceRecord(row))
      .filter((e) => {
        if (kind && e.kind !== kind) return false;
        if (capability) {
          const [cid, version] = capability.split("@");
          if (
            !e.capabilities.some(
              (c) =>
                c.capabilityId === cid && (!version || c.version === version),
            )
          )
            return false;
        }
        if (!q) return true;
        return [
          e.title,
          e.problem,
          e.resolution,
          e.tags.join(" "),
          e.capabilities.map((c) => c.capabilityId + " " + c.name).join(" "),
          e.projectName || "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .slice(0, limit);
  });

  app.post<{
    Body: {
      title: string;
      kind: ExperienceKind;
      problem: string;
      resolution: string;
      capabilities?: { capabilityId: string; version: string }[];
      tags?: string[];
      projectId?: string;
      runId?: string;
      sourceFeedbackId?: string;
      author: string;
      confirmed: boolean;
    };
  }>(
    "/v1/experiences",
    {
      schema: {
        body: {
          type: "object",
          required: ["title", "kind", "problem", "resolution", "author", "confirmed"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 120 },
            kind: { enum: EXPERIENCE_KINDS },
            problem: { type: "string", minLength: 1, maxLength: 4000 },
            resolution: { type: "string", maxLength: 4000 },
            capabilities: {
              type: "array",
              maxItems: 30,
              items: {
                type: "object",
                required: ["capabilityId", "version"],
                properties: {
                  capabilityId: { type: "string", maxLength: 100 },
                  version: { type: "string", maxLength: 30 },
                },
                additionalProperties: false,
              },
            },
            tags: {
              type: "array",
              maxItems: 20,
              items: { type: "string", maxLength: 40 },
            },
            projectId: { type: "string", maxLength: 80 },
            runId: { type: "string", maxLength: 80 },
            sourceFeedbackId: { type: "string", maxLength: 80 },
            author: { type: "string", minLength: 1, maxLength: 80 },
            confirmed: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      // 只有人确认过的内容才进长期资产；AI 不能自动写入。
      if (req.body.confirmed !== true)
        throw new ExecutionError(
          "EXPERIENCE_NOT_CONFIRMED",
          "经验条目必须由人确认后才能写入（confirmed 必须为 true）。",
        );
      const run = req.body.runId
        ? store.run(req.body.runId)
        : null;
      if (req.body.runId && !run)
        throw new ExecutionError("RUN_NOT_FOUND", "关联的运行记录不存在。");
      const project = run
        ? store.get("SELECT id,name FROM projects WHERE id=?", run.projectId)
        : req.body.projectId
          ? store.get("SELECT id,name FROM projects WHERE id=?", req.body.projectId)
          : null;
      const capabilities = (
        req.body.capabilities ||
        (run
          ? run.assembly.map((s) => ({
              capabilityId: s.capabilityId,
              version: s.version,
            }))
          : [])
      ).map((c) => {
        const def = registry.get(c.capabilityId, c.version);
        return {
          capabilityId: c.capabilityId,
          version: c.version,
          name: def?.name || c.capabilityId + "@" + c.version,
        };
      });
      const at = now(),
        xid = id("experience");
      store.exec(
        "INSERT INTO experiences(id,title,kind,problem,resolution,project_id,project_name,run_id,capabilities,tags,source_feedback_id,verified_run_id,verified_project_name,verified_at,author,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        xid,
        req.body.title.trim(),
        req.body.kind,
        req.body.problem.trim(),
        (req.body.resolution || "").trim(),
        project?.id || null,
        project?.name || null,
        run?.id || null,
        JSON.stringify(capabilities),
        JSON.stringify(
          (req.body.tags || []).map((t) => t.trim()).filter(Boolean),
        ),
        req.body.sourceFeedbackId || null,
        null,
        null,
        null,
        req.body.author.trim(),
        at,
        at,
      );
      reply.code(201);
      return experienceRecord(
        store.get("SELECT * FROM experiences WHERE id=?", xid),
      );
    },
  );

  app.patch<{ Params: { id: string }; Body: { verifiedByRunId: string } }>(
    "/v1/experiences/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["verifiedByRunId"],
          properties: { verifiedByRunId: { type: "string", maxLength: 80 } },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const row = store.get("SELECT * FROM experiences WHERE id=?", req.params.id);
      if (!row) throw new ExecutionError("EXPERIENCE_NOT_FOUND", "经验条目不存在。");
      const experience = experienceRecord(row);
      const run = store.run(req.body.verifiedByRunId);
      if (!run) throw new ExecutionError("RUN_NOT_FOUND", "验证用的运行记录不存在。");
      if (run.status !== "completed")
        throw new ExecutionError(
          "RUN_NOT_COMPLETED",
          "只有真正执行成功的运行才能把建议升级为已验证方案。",
        );
      const used = new Set(
        run.assembly.map((s) => s.capabilityId + "@" + s.version),
      );
      const missing = experience.capabilities.filter(
        (c) => !used.has(c.capabilityId + "@" + c.version),
      );
      if (missing.length)
        throw new ExecutionError(
          "VERIFICATION_MISMATCH",
          "这次运行没有用到经验里的能力：" +
            missing.map((c) => c.capabilityId + "@" + c.version).join("、"),
        );
      store.exec(
        "UPDATE experiences SET kind='verified_solution',verified_run_id=?,verified_project_name=?,verified_at=?,updated_at=? WHERE id=?",
        run.id,
        run.projectName,
        now(),
        now(),
        experience.id,
      );
      return experienceRecord(
        store.get("SELECT * FROM experiences WHERE id=?", experience.id),
      );
    },
  );

  /* ---------------------------------------------------------------- 概览 */

  app.get("/v1/overview", async () => {
    const projects = store.all("SELECT * FROM projects ORDER BY updated_at DESC");
    const statusRows = store.all(
      "SELECT project_id,status,COUNT(*) AS count FROM runs GROUP BY project_id,status",
    );
    const lastRuns = store.all(
      "SELECT id,project_id,project_name,status,created_at,input FROM runs ORDER BY created_at DESC LIMIT 12",
    );
    const failedSteps = store.all(
      "SELECT s.capability_id,s.position,s.error,r.id AS run_id,r.project_name,r.created_at FROM steps s JOIN runs r ON r.id=s.run_id WHERE s.status='failed' ORDER BY r.created_at DESC LIMIT 200",
    );
    const artifactRows = store.all(
      "SELECT a.filename,a.bytes,a.created_at,r.id AS run_id,r.project_name FROM artifacts a JOIN runs r ON r.id=a.run_id ORDER BY a.created_at DESC",
    );
    const feedbackRows = store.all(
      "SELECT * FROM run_feedback ORDER BY updated_at DESC",
    );
    const experienceRows = store.all(
      "SELECT * FROM experiences ORDER BY updated_at DESC",
    );
    const applicationRows = store.all("SELECT * FROM project_applications");
    const modelRow = store.get(
      "SELECT COUNT(*) AS calls,COALESCE(SUM(duration_ms),0) AS duration FROM model_calls",
    );
    const feedbackByProject = new Map<string, number>();
    for (const row of feedbackRows)
      feedbackByProject.set(
        row.project_id,
        (feedbackByProject.get(row.project_id) || 0) + 1,
      );
    const artifactCountByProject = new Map<string, number>();
    for (const row of store.all(
      "SELECT r.project_id,COUNT(*) AS count FROM artifacts a JOIN runs r ON r.id=a.run_id GROUP BY r.project_id",
    ))
      artifactCountByProject.set(row.project_id, Number(row.count));


    const byStatus: Record<string, number> = {};
    const projectRunStats = new Map<
      string,
      { completed: number; failed: number; pending: number; total: number }
    >();
    for (const row of statusRows) {
      byStatus[row.status] = (byStatus[row.status] || 0) + row.count;
      const stats =
        projectRunStats.get(row.project_id) ||
        { completed: 0, failed: 0, pending: 0, total: 0 };
      stats.total += row.count;
      if (row.status === "completed") stats.completed += row.count;
      else if (row.status === "failed" || row.status === "rejected")
        stats.failed += row.count;
      else if (PENDING_STATUS.has(row.status)) stats.pending += row.count;
      projectRunStats.set(row.project_id, stats);
    }

    const failureMap = new Map<
      string,
      {
        code: string;
        message: string;
        count: number;
        lastRunId: string;
        projectName: string;
        capability: string;
        at: string;
      }
    >();
    for (const row of failedSteps) {
      const error = parse<{ code?: string; message?: string }>(row.error, {});
      const code = error.code || "UNKNOWN";
      const key = code + "|" + row.capability_id;
      const current = failureMap.get(key);
      if (current) current.count += 1;
      else
        failureMap.set(key, {
          code,
          message: error.message || "未记录原因",
          count: 1,
          lastRunId: row.run_id,
          projectName: row.project_name,
          capability: row.capability_id,
          at: row.created_at,
        });
    }

    const experiences = experienceRows.map((row) => experienceRecord(row));
    const experienceByProject = new Map<string, number>();
    for (const e of experiences)
      if (e.projectId)
        experienceByProject.set(
          e.projectId,
          (experienceByProject.get(e.projectId) || 0) + 1,
        );

    const overview: OverviewRecord = {
      generatedAt: now(),
      projects: projects.map((row) => {
        const data = parse<{
          layout?: "agent" | "business";
          steps?: AssemblyStep[];
          permissions?: string[];
        }>(row.data, {});
        const steps = data.steps || [];
        const check = registry.assembly({
          steps,
          permissions: data.permissions || [],
        });
        const stats = projectRunStats.get(row.id) || {
          completed: 0,
          failed: 0,
          pending: 0,
          total: 0,
        };
        // 每个项目自己的最近一次运行，不能只看全局最近 12 条，否则有历史的项目会被误显示为“尚未运行”。
        const last = store.get(
          "SELECT id,status,created_at,input FROM runs WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
          row.id,
        );
        const application = applicationRows.find(
          (a) => a.project_id === row.id,
        );
        return {
          id: row.id,
          name: row.name,
          layout: data.layout || "agent",
          revision: row.revision,
          updatedAt: row.updated_at,
          ready: check.ready,
          issueCount: check.issues.length,
          capabilities: capabilityRefs(registry, steps).map((c) => {
            const info = registry.get(c.capabilityId, c.version);
            return {
              ...c,
              status: info
                ? registry.info(info).status
                : ("unregistered" as CapabilityInfo["status"] | "unregistered"),
            };
          }),
          runs: stats,
          lastRun: last
            ? {
                id: last.id,
                status: last.status,
                createdAt: last.created_at,
                filename: parse<{ filename?: string }>(last.input, {}).filename || "",
              }
            : null,
          feedbackCount: feedbackByProject.get(row.id) || 0,
          experienceCount: experienceByProject.get(row.id) || 0,
          artifacts: artifactCountByProject.get(row.id) || 0,
          application: application ? applicationRecord(application) : null,
        };
      }),
      runs: {
        total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
        byStatus,
        recent: lastRuns.map((row) => ({
          id: row.id,
          projectId: row.project_id,
          projectName: row.project_name,
          status: row.status,
          createdAt: row.created_at,
          filename: parse<{ filename?: string }>(row.input, {}).filename || "",
          failedStep:
            failedSteps
              .filter((f) => f.run_id === row.id)
              .map((f) => ({
                position: f.position,
                capability: f.capability_id,
                message:
                  parse<{ message?: string }>(f.error, {}).message ||
                  "未记录原因",
              }))[0] || null,
        })),
        failures: [...failureMap.values()].sort(
          (a, b) => b.count - a.count || a.at.localeCompare(b.at) * -1,
        ),
      },
      feedback: {
        total: feedbackRows.length,
        recent: feedbackRows.slice(0, 8).map((row) => feedbackRecord(row)),
      },
      experiences: {
        total: experiences.length,
        byKind: experiences.reduce<Record<string, number>>((acc, e) => {
          acc[e.kind] = (acc[e.kind] || 0) + 1;
          return acc;
        }, {}),
        recent: experiences.slice(0, 8),
      },
      artifacts: {
        total: artifactRows.length,
        recent: artifactRows.slice(0, 6).map((row) => ({
          runId: row.run_id,
          projectName: row.project_name,
          filename: row.filename,
          bytes: row.bytes,
          createdAt: row.created_at,
        })),
      },
      models: {
        calls: Number(modelRow?.calls || 0),
        durationMs: Number(modelRow?.duration || 0),
        cost: "not_tracked",
        note:
          Number(modelRow?.calls || 0) > 0
            ? "模型调用次数与耗时来自 model_calls 表；费用未接入计费数据。"
            : "本机尚未发生模型调用（Provider 未配置），没有调用量、耗时和费用数据。",
      },
    };
    return overview;
  });

  /* -------------------------------------------------- Portfolio 更新建议（只读） */

  app.get<{ Params: { id: string } }>(
    "/v1/experiences/:id/portfolio-suggestion",
    async (req) => {
      const row = store.get("SELECT * FROM experiences WHERE id=?", req.params.id);
      if (!row) throw new ExecutionError("EXPERIENCE_NOT_FOUND", "经验条目不存在。");
      const experience = experienceRecord(row);
      let registryInfo: { version: string; sha256: string; path: string } | null =
        null;
      try {
        const catalog = await registry.catalog();
        registryInfo = catalog.registry;
      } catch {
        registryInfo = null;
      }
      if (!registryInfo)
        throw new ExecutionError(
          "PORTFOLIO_UNAVAILABLE",
          "Portfolio 登记源当前不可读取，无法生成更新建议。",
        );
      // 只生成建议内容，绝不写回 assets-index.json。
      return {
        registry: registryInfo,
        appliesTo: "portfolio-assets-index",
        writeBack: false,
        reason: "Portfolio 正式登记源只读，这里只给出可供人工审阅的更新建议。",
        suggestion: {
          action: "add_candidate",
          entry: {
            name: experience.title,
            kind: experience.kind,
            summary: experience.problem,
            resolution: experience.resolution,
            capabilities: experience.capabilities.map(
              (c) => c.capabilityId + "@" + c.version,
            ),
            evidenceRunId: experience.verifiedRunId || experience.runId,
            sourceProject: experience.projectName,
          },
        },
      };
    },
  );

  /** 读取一次生成的应用清单，确认目录里真实存在哪些文件。 */
  app.get<{ Params: { id: string } }>(
    "/v1/projects/:id/application/manifest",
    async (req) => {
      const row = store.get(
        "SELECT * FROM project_applications WHERE project_id=?",
        req.params.id,
      );
      if (!row) throw new ExecutionError("APPLICATION_NOT_FOUND", "该项目还没有生成独立应用。");
      const application = applicationRecord(row);
      const directory = resolve(ROOT, application.relativePath);
      const files: string[] = [];
      const walk = async (dir: string, prefix: string) => {
        const { readdir } = await import("node:fs/promises");
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (entry.name === "node_modules" || entry.name === "dist") continue;
          const next = prefix ? prefix + "/" + entry.name : entry.name;
          if (entry.isDirectory()) await walk(resolve(dir, entry.name), next);
          else files.push(next);
        }
      };
      try {
        await walk(directory, "");
      } catch {
        throw new ExecutionError(
          "APPLICATION_DIRECTORY_MISSING",
          "记录中的应用目录已不存在：" + application.relativePath,
        );
      }
      const entry = await readFile(resolve(directory, "src/main.tsx"), "utf8")
        .then((text) => ({ readable: true, bindsProject: text.includes(row.project_id as string) }))
        .catch(() => ({ readable: false, bindsProject: false }));
      return { application, files: files.sort(), entry };
    },
  );
}
