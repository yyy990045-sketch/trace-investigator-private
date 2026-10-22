import Ajv from "ajv";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { hash } from "./util.ts";
import type { CapabilityDefinition } from "./contracts.ts";
import type { Store } from "./store.ts";
import type {
  AssemblyStep,
  CapabilityInfo,
  ValidationIssue,
  ProjectDraft,
} from "@personal/capability-sdk";
export class Registry {
  ajv = new Ajv({ allErrors: true, strict: false });
  definitions = new Map<string, CapabilityDefinition>();
  hashes = new Map<string, string>();
  protocols = new Map<string, string>();
  constructor(public store: Store) {}
  key(id: string, version: string) {
    return id + "@" + version;
  }
  register(def: CapabilityDefinition, sourceHash: string) {
    if (
      !/^[a-z][a-z0-9.-]+$/.test(def.id) ||
      !/^\d+\.\d+\.\d+$/.test(def.version)
    )
      throw new Error("Invalid capability id/version");
    const key = this.key(def.id, def.version);
    if (this.definitions.has(key))
      throw new Error("Duplicate capability " + key);
    for (const [protocol, schema] of [
      [def.inputProtocol, def.inputSchema],
      [def.outputProtocol, def.outputSchema],
    ] as const) {
      const digest = hash(schema);
      if (
        this.protocols.has(protocol) &&
        this.protocols.get(protocol) !== digest
      )
        throw new Error("Conflicting protocol schema " + protocol);
      this.protocols.set(protocol, digest);
      this.ajv.compile(schema);
    }
    this.ajv.compile(def.configSchema);
    this.definitions.set(key, def);
    this.hashes.set(
      key,
      hash({
        sourceHash,
        manifest: { ...def, execute: undefined, dependencies: undefined },
        execute: def.execute.toString(),
      }),
    );
  }
  get(id: string, version: string) {
    return this.definitions.get(this.key(id, version));
  }
  definitionHash(id: string, version: string) {
    return this.hashes.get(this.key(id, version)) || "";
  }
  enabled(id: string, version: string) {
    return (
      this.store.get(
        "SELECT enabled FROM capability_settings WHERE capability_id=? AND version=?",
        id,
        version,
      )?.enabled !== 0
    );
  }
  validate(schema: Record<string, unknown>, data: unknown) {
    const check = this.ajv.compile(schema);
    return check(data)
      ? null
      : this.ajv.errorsText(check.errors, { separator: "; " });
  }
  info(def: CapabilityDefinition): CapabilityInfo {
    const implementationHash = this.definitionHash(def.id, def.version);
    const acceptance =
      this.store.get(
        `SELECT r.id runId,s.id stepId,s.finished_at at FROM steps s JOIN runs r ON r.id=s.run_id WHERE s.capability_id=? AND s.version=? AND s.definition_hash=? AND s.status='completed' AND r.status='completed' ORDER BY s.finished_at DESC LIMIT 1`,
        def.id,
        def.version,
        implementationHash,
      ) || null;
    const dependencies = def.dependencies?.() || [];
    const enabled = this.enabled(def.id, def.version);
    return {
      id: def.id,
      version: def.version,
      name: def.name,
      description: def.description,
      inputProtocol: def.inputProtocol,
      outputProtocol: def.outputProtocol,
      inputSchema: def.inputSchema,
      outputSchema: def.outputSchema,
      configSchema: def.configSchema,
      defaultConfig: def.defaultConfig,
      permissions: def.permissions,
      effects: def.effects,
      kind: def.kind,
      requiresApproval: def.requiresApproval,
      approvalScope: def.approvalScope,
      dependencies,
      enabled,
      status: !enabled
        ? "disabled"
        : dependencies.some((d) => !d.ready)
          ? "registered_missing_dependencies"
          : acceptance
            ? "verified"
            : "ready_unverified",
      implementationHash,
      assets: def.assets,
      acceptance,
    };
  }
  assembly(project: Pick<ProjectDraft, "steps" | "permissions">): {
    ready: boolean;
    issues: ValidationIssue[];
  } {
    const issues: ValidationIssue[] = [];
    let protocol = "source.upload.v1";
    if (!project.steps.length)
      issues.push({
        code: "EMPTY_ASSEMBLY",
        message: "至少选择一个处理步骤。",
      });
    if (project.steps.length > 30)
      issues.push({
        code: "TOO_MANY_STEPS",
        message: "初版最多30个顺序步骤。",
      });
    project.steps.forEach((step, i) => {
      const def = this.get(step.capabilityId, step.version);
      if (!def) {
        issues.push({
          code: "VERSION_NOT_REGISTERED",
          message: `未注册 ${step.capabilityId}@${step.version}`,
          step: i,
        });
        return;
      }
      const info = this.info(def);
      if (!info.enabled)
        issues.push({
          code: "CAPABILITY_DISABLED",
          message: `${def.name} 已禁用。`,
          step: i,
        });
      for (const d of info.dependencies.filter((d) => !d.ready))
        issues.push({
          code: "MISSING_DEPENDENCY",
          message: `${def.name}：${d.reason}`,
          step: i,
        });
      for (const permission of def.permissions)
        if (!project.permissions.includes(permission))
          issues.push({
            code: "PERMISSION_REQUIRED",
            message: `${def.name} 需要项目权限 ${permission}`,
            step: i,
          });
      if (
        def.effects.includes("external_write") &&
        !project.permissions.includes("external:write")
      )
        issues.push({
          code: "EXTERNAL_WRITE_PERMISSION",
          message: "外部写入需要明确的 external:write 项目权限。",
          step: i,
        });
      if (protocol !== def.inputProtocol)
        issues.push({
          code: "INCOMPATIBLE_OUTPUT",
          message: `上一步输出 ${protocol}，${def.name} 需要 ${def.inputProtocol}`,
          step: i,
        });
      protocol = def.outputProtocol;
      const error = this.validate(def.configSchema, step.config);
      if (error)
        issues.push({
          code: "INVALID_CONFIG",
          message: `${def.name} 配置无效：${error}`,
          step: i,
        });
      if (
        step.retries !== undefined &&
        (!Number.isInteger(step.retries) ||
          step.retries < 0 ||
          step.retries > 2)
      )
        issues.push({
          code: "INVALID_RETRY",
          message: "重试次数必须是0至2。",
          step: i,
        });
      if (
        step.timeoutMs !== undefined &&
        (!Number.isInteger(step.timeoutMs) ||
          step.timeoutMs < 100 ||
          step.timeoutMs > 120000)
      )
        issues.push({
          code: "INVALID_TIMEOUT",
          message: "超时必须在100至120000毫秒之间。",
          step: i,
        });
      if (
        (step.retries || 0) > 0 &&
        (!def.idempotent || def.effects.includes("external_write"))
      )
        issues.push({
          code: "UNSAFE_RETRY",
          message: "有不可重放副作用的能力不允许自动重试。",
          step: i,
        });
    });
    return { ready: issues.length === 0, issues };
  }
  async catalog() {
    const path =
      process.env.PORTFOLIO_REGISTRY_PATH ||
      join(
        homedir(),
        "Projects/personal-ai-portfolio/registry/assets-index.json",
      );
    const bytes = await readFile(path);
    const source = JSON.parse(bytes.toString());
    const capabilities = [...this.definitions.values()].map((d) =>
      this.info(d),
    );
    return {
      registry: {
        version: source.meta.version,
        sha256: hash(bytes.toString()),
        path,
      },
      capabilities,
      assets: source.capabilities.map((a: any) => {
        const linked = capabilities.filter((c) =>
          c.assets.some((link) => link.assetId === a.cid),
        );
        return {
          id: a.cid,
          name: a.name,
          sourceProjects: a.source_projects,
          sourceFiles: a.source_files,
          runtimeCapabilities: linked,
          status: !linked.length
            ? "source_only"
            : linked.some((c) => c.status === "verified")
              ? "independent_implementation_verified"
              : linked.some(
                    (c) => c.status === "registered_missing_dependencies",
                  )
                ? "registered_missing_dependencies"
                : "adapted_not_verified",
        };
      }),
    };
  }
}
