import { mkdir, writeFile, rename, readFile, unlink } from "node:fs/promises";
import { join, basename } from "node:path";
import { setTimeout as backoff } from "node:timers/promises";
import type {
  AssemblyStep,
  ProjectDraft,
  UploadInput,
  ArtifactRecord,
} from "@personal/capability-sdk";
import type { Store } from "./store.ts";
import type { Registry } from "./registry.ts";
import {
  ExecutionError,
  uploadSchema,
  type ExecutionContext,
} from "./contracts.ts";
import { hash, id, now } from "./util.ts";
import { localKnowledge, invokeModel } from "./providers.ts";
export class Engine {
  active = new Map<string, AbortController>();
  closing = false;
  workers = new Set<Promise<void>>();
  operations = new Set<Promise<unknown>>();
  track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation)).catch(() => {});
    return operation;
  }
  constructor(
    public store: Store,
    public registry: Registry,
    public artifactRoot: string,
  ) {}
  project(pid: string) {
    const p = this.store.project(
      this.store.get("SELECT * FROM projects WHERE id=?", pid),
    );
    if (!p) throw new ExecutionError("PROJECT_NOT_FOUND", "项目不存在。");
    return { ...p, validation: this.registry.assembly(p) };
  }
  createProject(data: ProjectDraft) {
    return this.project(this.store.createProject(data).id);
  }
  createRun(pid: string, input: UploadInput, expectedRevision?: number) {
    const p = this.project(pid);
    if (expectedRevision !== undefined && expectedRevision !== p.revision)
      throw new ExecutionError("PROJECT_CONFLICT", "项目组合已变化，请刷新配置并重新确认后执行。");
    const validation = this.registry.assembly(p);
    if (!validation.ready)
      throw Object.assign(
        new ExecutionError("ASSEMBLY_BLOCKED", "组合未通过执行前校验。"),
        { issues: validation.issues },
      );
    const invalid = this.registry.validate(uploadSchema, input);
    if (invalid) throw new ExecutionError("INPUT_SCHEMA_INVALID", invalid);
    // 外发授权：发往外部模型需 modelConsent，发往外部检索服务需 dataConsent。
    if (
      p.steps.some((s: AssemblyStep) =>
        this.registry
          .get(s.capabilityId, s.version)
          ?.effects.includes("external_data"),
      ) &&
      input.modelConsent !== true &&
      input.dataConsent !== true
    )
      throw new ExecutionError(
        "DATA_CONSENT_REQUIRED",
        "该组合会向外发送资料，需要本次任务的明确授权。",
      );
    const rid = id("run"),
      at = now();
    this.store.transaction(() => {
      this.store.exec(
        "INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        rid,
        pid,
        p.name,
        p.revision,
        JSON.stringify(
          p.steps.map((s: AssemblyStep) => ({
            ...s,
            manifest: this.registry.info(
              this.registry.get(s.capabilityId, s.version)!,
            ),
          })),
        ),
        JSON.stringify(p.permissions),
        JSON.stringify(input),
        "queued",
        null,
        at,
        at,
      );
      p.steps.forEach((s: AssemblyStep, i: number) =>
        this.store.exec(
          "INSERT INTO steps(id,run_id,position,capability_id,version,definition_hash,status) VALUES(?,?,?,?,?,?,?)",
          id("step"),
          rid,
          i,
          s.capabilityId,
          s.version,
          this.registry.definitionHash(s.capabilityId, s.version),
          "pending",
        ),
      );
      this.store.event(rid, "run.created", {
        projectId: pid,
        projectRevision: p.revision,
        steps: p.steps.length,
        inputHash: hash(input),
      });
    });
    this.schedule(rid);
    return this.store.run(rid)!;
  }
  schedule(rid: string) {
    if (!this.closing) queueMicrotask(() => {
      const task = this.work(rid);
      this.workers.add(task);
      void task.finally(() => this.workers.delete(task)).catch(() => {});
    });
  }
  assertActive(rid: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const status = this.store.get(
      "SELECT status FROM runs WHERE id=?",
      rid,
    )?.status;
    if (status !== "running")
      throw new ExecutionError(
        "RUN_NOT_ACTIVE",
        "任务已停止，不再允许写入结果。",
      );
  }
  async work(rid: string) {
    if (this.active.has(rid) || this.closing) return;
    const raw = this.store.get("SELECT * FROM runs WHERE id=?", rid);
    if (!raw || raw.status !== "queued") return;
    const controller = new AbortController();
    this.active.set(rid, controller);
    this.store.transaction(() => this.store.setStatus(rid, "running"));
    const plan: AssemblyStep[] = JSON.parse(raw.plan);
    let currentStep: string | null = null;
    let externalInFlight = false;
    try {
      for (const [i, selection] of plan.entries()) {
        this.assertActive(rid, controller.signal);
        const row = this.store.get(
          "SELECT * FROM steps WHERE run_id=? AND position=?",
          rid,
          i,
        );
        if (row.status === "completed") continue;
        currentStep = row.id;
        const def = this.registry.get(
          selection.capabilityId,
          selection.version,
        );
        if (
          !def ||
          row.definition_hash !==
            this.registry.definitionHash(
              selection.capabilityId,
              selection.version,
            )
        )
          throw new ExecutionError(
            "CAPABILITY_CHANGED",
            "能力实现已变化或版本不存在，请重新装配并执行。",
          );
        const current = this.registry.info(def);
        if (!current.enabled)
          throw new ExecutionError("CAPABILITY_DISABLED", "能力已禁用。");
        if (current.dependencies.some((d) => !d.ready))
          throw new ExecutionError(
            "DEPENDENCY_UNAVAILABLE",
            current.dependencies
              .filter((d) => !d.ready)
              .map((d) => d.reason)
              .join("；"),
          );
        const permissions: string[] = JSON.parse(raw.permissions);
        if (
          def.permissions.some((p) => !permissions.includes(p)) ||
          (def.effects.includes("external_write") &&
            !permissions.includes("external:write"))
        )
          throw new ExecutionError(
            "PERMISSION_REQUIRED",
            "任务没有该能力需要的权限。",
          );
        const input =
          i === 0
            ? JSON.parse(raw.input)
            : JSON.parse(
                this.store.get(
                  "SELECT output FROM steps WHERE run_id=? AND position=?",
                  rid,
                  i - 1,
                ).output,
              );
        const badInput = this.registry.validate(def.inputSchema, input);
        if (badInput) throw new ExecutionError("STEP_INPUT_INVALID", badInput);
        const inputHash = hash(input);
        const strictExternal = def.effects.includes("external_write");
        // Only explicitly shared delivery scopes may reuse an approval for identical input.
        const approved = this.store.all(
          "SELECT * FROM approvals WHERE run_id=? AND input_hash=? AND status='approved'",
          rid, inputHash,
        );
        const approval = approved.find((a) => a.step_id === row.id || (
          !strictExternal && def.approvalScope && plan.some((s, pos) =>
            (s as AssemblyStep & { manifest?: { approvalScope?: string } }).manifest?.approvalScope === def.approvalScope &&
            this.store.get("SELECT id FROM steps WHERE run_id=? AND position=?", rid, pos)?.id === a.step_id
          )
        ));
        if (
          (def.kind === "human" || def.requiresApproval || strictExternal) &&
          !approval
        ) {
          this.store.transaction(() => {
            this.store.exec(
              "UPDATE steps SET status=?,input=?,started_at=COALESCE(started_at,?) WHERE id=?",
              "waiting_approval",
              JSON.stringify(input),
              now(),
              row.id,
            );
            this.store.exec(
              "INSERT INTO approvals VALUES(?,?,?,?,?,?,?)",
              id("approval"),
              rid,
              row.id,
              inputHash,
              "pending",
              null,
              null,
            );
            this.store.setStatus(rid, "waiting_approval");
            this.store.event(rid, "approval.requested", {
              stepId: row.id,
              inputHash,
              capability: def.id,
              externalWrite: strictExternal,
            });
          });
          return;
        }
        let attempt = 0;
        const maxRetries = selection.retries || 0;
        while (true) {
          const started = Date.now(),
            signalController = new AbortController();
          const abort = () => signalController.abort(controller.signal.reason);
          controller.signal.addEventListener("abort", abort, { once: true });
          const timeout = setTimeout(
            () =>
              signalController.abort(
                new ExecutionError(
                  "STEP_TIMEOUT",
                  `能力 ${def.name} 执行超时。`,
                ),
              ),
            selection.timeoutMs || 30000,
          );
          let timedOutReject: ((error: unknown) => void) | undefined;
          const aborted = new Promise<never>((_, reject) => {
            timedOutReject = reject;
            signalController.signal.addEventListener(
              "abort",
              () =>
                reject(
                  signalController.signal.reason ||
                    new ExecutionError("STEP_ABORTED", "步骤已停止。"),
                ),
              { once: true },
            );
          });
          this.store.transaction(() => {
            this.store.exec(
              "UPDATE steps SET status=?,attempts=attempts+1,input=?,error=NULL,started_at=?,finished_at=NULL WHERE id=?",
              "running",
              JSON.stringify(input),
              now(),
              row.id,
            );
            this.store.event(rid, "step.started", {
              stepId: row.id,
              capability: def.id,
              version: def.version,
              attempt: row.attempts + attempt + 1,
            });
          });
          const ctx: ExecutionContext = {
            runId: rid,
            stepId: row.id,
            projectId: raw.project_id,
            signal: signalController.signal,
            knowledge: localKnowledge,
            evidence: (kind, data) => {
              this.assertActive(rid, signalController.signal);
              this.store.exec(
                "INSERT INTO evidence VALUES(?,?,?,?,?,?,?)",
                id("evidence"),
                rid,
                row.id,
                kind,
                hash(data),
                JSON.stringify(data),
                now(),
              );
            },
            snapshot: () => {
              this.assertActive(rid, signalController.signal);
              const r = this.store.run(rid)!;
              return {
                runId: rid,
                snapshotKind: "intermediate-execution",
                generatedAt: now(),
                statusSource: "SQLite runs.status at snapshot time; not final delivery state",
                status: r.status,
                projectRevision: r.projectRevision,
                steps: r.steps.map((s) => ({
                  id: s.id,
                  capability: s.capabilityId,
                  status: s.status,
                  attempts: s.attempts,
                })),
              };
            },
            model: (bundle) => {
              this.assertActive(rid, signalController.signal);
              if (!def.effects.includes("external_data") || !def.permissions.includes("model:invoke") ||
                  !def.permissions.includes("data:external") || JSON.parse(raw.input).modelConsent !== true)
                throw new ExecutionError("MODEL_PERMISSION_DENIED", "当前能力或本次资料未授权模型外发。");
              return this.track(invokeModel(
                { ...bundle, modelConsent: true },
                { runId: rid, stepId: row.id, signal: signalController.signal },
                this.store,
              ));
            },
            artifact: (filename, content, mime) => {
              this.assertActive(rid, signalController.signal);
              if (!def.permissions.includes("file:write") || !def.effects.includes("local_file") || !approval)
                throw new ExecutionError("ARTIFACT_PERMISSION_DENIED", "文件写入需要能力声明、项目权限及本次输入审批。");
              return this.track(this.writeArtifact(
                rid,
                row.id,
                filename,
                content,
                mime,
                signalController.signal,
              ));
            },
          };
          try {
            externalInFlight = strictExternal;
            const output = await Promise.race([
              def.execute(input, selection.config, ctx),
              aborted,
            ]);
            this.assertActive(rid, signalController.signal);
            externalInFlight = false;
            const invalid = this.registry.validate(def.outputSchema, output);
            if (invalid)
              throw new ExecutionError("STEP_OUTPUT_INVALID", invalid);
            ctx.evidence("step.output", {
              capability: def.id,
              version: def.version,
              inputHash,
              outputHash: hash(output),
              output,
            });
            this.store.transaction(() => {
              this.store.exec(
                "UPDATE steps SET status=?,output=?,finished_at=?,duration_ms=? WHERE id=?",
                "completed",
                JSON.stringify(output),
                now(),
                Date.now() - started,
                row.id,
              );
              this.store.event(rid, "step.completed", {
                stepId: row.id,
                outputHash: hash(output),
                durationMs: Date.now() - started,
              });
            });
            break;
          } catch (error) {
            if (controller.signal.aborted) throw error;
            const e =
              error instanceof ExecutionError
                ? error
                : new ExecutionError(
                    "CAPABILITY_FAILED",
                    error instanceof Error ? error.message : "能力执行失败。",
                  );
            if (
              attempt < maxRetries &&
              e.retryable &&
              def.idempotent &&
              !strictExternal
            ) {
              attempt++;
              this.store.event(rid, "step.retry", {
                stepId: row.id,
                attempt,
                code: e.code,
              });
              await backoff(100 * 2 ** attempt, undefined, {
                signal: controller.signal,
              });
              continue;
            }
            throw e;
          } finally {
            clearTimeout(timeout);
            controller.signal.removeEventListener("abort", abort);
            timedOutReject = undefined;
          }
        }
      }
      this.assertActive(rid, controller.signal);
      this.store.transaction(() => this.store.setStatus(rid, "completed"));
    } catch (error) {
      const cancellation =
        controller.signal.aborted ||
        this.store.get("SELECT status FROM runs WHERE id=?", rid)?.status ===
          "cancel_requested";
      const uncertain = externalInFlight;
      const canceled = cancellation && !uncertain;
      const e = uncertain
        ? new ExecutionError(
            "EXTERNAL_OUTCOME_UNCERTAIN",
            "外部写入已开始但结果未确认，需要人工核实；禁止直接标记已取消或自动重试。",
          )
        : error instanceof ExecutionError
          ? error
          : new ExecutionError(
              "EXECUTION_FAILED",
              error instanceof Error ? error.message : "任务执行失败。",
            );
      this.store.transaction(() => {
        if (currentStep)
          this.store.exec(
            "UPDATE steps SET status=?,error=?,finished_at=? WHERE id=? AND status<>?",
            canceled ? "canceled" : "failed",
            JSON.stringify({
              code: canceled ? "CANCELED" : e.code,
              message: canceled ? "用户取消了任务。" : e.message,
            }),
            now(),
            currentStep,
            "completed",
          );
        this.store.setStatus(
          rid,
          canceled ? "canceled" : "failed",
          canceled ? null : { code: e.code, message: e.message },
        );
      });
    } finally {
      this.active.delete(rid);
    }
  }
  decide(
    rid: string,
    aid: string,
    decision: "approve" | "reject",
    actor: string,
  ) {
    this.store.transaction(() => {
      const run = this.store.get("SELECT * FROM runs WHERE id=?", rid),
        a = this.store.get(
          "SELECT * FROM approvals WHERE id=? AND run_id=?",
          aid,
          rid,
        );
      if (
        !run ||
        run.status !== "waiting_approval" ||
        !a ||
        a.status !== "pending"
      )
        throw new ExecutionError("DECISION_CONFLICT", "任务已不再等待此审批。");
      const step = this.store.get("SELECT * FROM steps WHERE id=?", a.step_id);
      if (
        step.status !== "waiting_approval" ||
        hash(JSON.parse(step.input)) !== a.input_hash
      )
        throw new ExecutionError(
          "APPROVAL_INPUT_CHANGED",
          "审批对象已变化，不能沿用旧审批。",
        );
      this.store.exec(
        "UPDATE approvals SET status=?,actor=?,decided_at=? WHERE id=?",
        decision === "approve" ? "approved" : "rejected",
        actor,
        now(),
        aid,
      );
      this.store.exec(
        "UPDATE steps SET status=?,finished_at=? WHERE id=?",
        decision === "approve" ? "pending" : "rejected",
        decision === "approve" ? null : now(),
        a.step_id,
      );
      this.store.event(rid, "approval." + decision, {
        approvalId: aid,
        stepId: a.step_id,
        inputHash: a.input_hash,
        actor,
      });
      this.store.setStatus(rid, decision === "approve" ? "queued" : "rejected");
    });
    if (decision === "approve") this.schedule(rid);
    return this.store.run(rid)!;
  }
  cancel(rid: string) {
    const run = this.store.run(rid);
    if (!run) throw new ExecutionError("RUN_NOT_FOUND", "运行不存在。");
    if (
      !["queued", "running", "waiting_approval", "cancel_requested"].includes(
        run.status,
      )
    )
      throw new ExecutionError("CANCEL_CONFLICT", "任务已结束，不能取消。");
    this.store.transaction(() => {
      const next =
        run.status === "running" || run.status === "cancel_requested"
          ? "cancel_requested"
          : "canceled";
      this.store.exec(
        "UPDATE approvals SET status='canceled',decided_at=? WHERE run_id=? AND status='pending'",
        now(),
        rid,
      );
      this.store.exec(
        "UPDATE steps SET status='canceled',finished_at=? WHERE run_id=? AND status='waiting_approval'",
        now(),
        rid,
      );
      this.store.setStatus(rid, next);
    });
    this.active.get(rid)?.abort(new ExecutionError("CANCELED", "用户取消。"));
    return this.store.run(rid)!;
  }
  retry(rid: string) {
    const run = this.store.run(rid);
    if (!run || run.status !== "failed")
      throw new ExecutionError("RETRY_CONFLICT", "只有失败任务可以重新执行。");
    const raw = this.store.get("SELECT * FROM runs WHERE id=?", rid);
    const steps: (AssemblyStep & { manifest?: { effects?: string[] } })[] = JSON.parse(raw.plan);
    if (
      steps.some((s) => !s.manifest || s.manifest.effects?.includes("external_write"))
    )
      throw new ExecutionError(
        "UNSAFE_RETRY",
        "含外部写入的失败任务需要先核实实际结果，不能直接重试。",
      );
    const next = this.createRun(run.projectId, run.input, run.projectRevision);
    this.store.event(next.id, "run.retried_from", { runId: rid });
    return next;
  }
  recover() {
    this.store.transaction(() => {
      for (const r of this.store.all(
        "SELECT id FROM runs WHERE status IN ('running','cancel_requested')",
      )) {
        this.store.exec(
          "UPDATE steps SET status='failed',error=?,finished_at=? WHERE run_id=? AND status='running'",
          JSON.stringify({
            code: "PROCESS_INTERRUPTED",
            message: "服务在步骤执行中中断；未假定执行成功，也未自动重放。",
          }),
          now(),
          r.id,
        );
        this.store.setStatus(r.id, "failed", {
          code: "PROCESS_INTERRUPTED",
          message: "运行服务重启，中断步骤需检查后重试。",
        });
      }
    });
    for (const r of this.store.all("SELECT id FROM runs WHERE status='queued'"))
      this.schedule(r.id);
  }
  async writeArtifact(
    rid: string,
    sid: string,
    filename: string,
    content: string,
    mime: string,
    signal: AbortSignal,
    // 已交付的调查允许在完成后再落一个新版本的文件；此时不再要求 run 处于 running。
    options: { requireActive?: boolean } = {},
  ): Promise<ArtifactRecord> {
    const guard = () => {
      if (options.requireActive !== false) this.assertActive(rid, signal);
      signal.throwIfAborted();
    };
    guard();
    if (
      filename !== basename(filename) ||
      /[\\/\x00-\x1f]/.test(filename) ||
      filename.length > 180
    )
      throw new ExecutionError("UNSAFE_FILENAME", "文件名不安全。");
    if (Buffer.byteLength(content) > 4_000_000)
      throw new ExecutionError("ARTIFACT_TOO_LARGE", "结果文件过大。");
    const digest = hash(content),
      existing = this.store.get(
        "SELECT * FROM artifacts WHERE run_id=? AND filename=?",
        rid,
        filename,
      );
    if (existing) {
      if (
        existing.sha256 !== digest ||
        hash((await readFile(existing.path)).toString()) !== digest
      )
        throw new ExecutionError(
          "ARTIFACT_CONFLICT",
          "已有文件与当前内容不一致。",
        );
      return {
        id: existing.id,
        filename,
        mime,
        sha256: digest,
        bytes: existing.bytes,
        createdAt: existing.created_at,
      };
    }
    const aid = id("file"),
      dir = join(this.artifactRoot, rid),
      path = join(dir, aid + "-" + filename),
      temp = path + ".tmp";
    await mkdir(dir, { recursive: true });
    await writeFile(temp, content, { flag: "wx" });
    try {
      guard();
      await rename(temp, path);
      guard();
      const at = now(),
        bytes = Buffer.byteLength(content);
      this.store.exec(
        "INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?,?)",
        aid,
        rid,
        sid,
        filename,
        mime,
        digest,
        bytes,
        path,
        at,
      );
      this.store.event(rid, "artifact.created", {
        id: aid,
        filename,
        sha256: digest,
        bytes,
      });
      return { id: aid, filename, mime, sha256: digest, bytes, createdAt: at };
    } catch (e) {
      await unlink(temp).catch(() => {});
      await unlink(path).catch(() => {});
      throw e;
    }
  }
  async stop() {
    this.closing = true;
    for (const c of this.active.values())
      c.abort(new ExecutionError("SERVICE_STOPPING", "运行服务正在关闭。"));
    await Promise.allSettled([...this.workers]);
    // Provider and file operations must finish their abort/audit cleanup before SQLite closes.
    while (this.operations.size) await Promise.allSettled([...this.operations]);
  }
}
