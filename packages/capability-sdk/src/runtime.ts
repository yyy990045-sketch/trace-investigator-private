export type RunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "cancel_requested"
  | "completed"
  | "failed"
  | "rejected"
  | "canceled";
export interface AssemblyStep {
  capabilityId: string;
  version: string;
  config: Record<string, unknown>;
  retries?: number;
  timeoutMs?: number;
}
export interface ProjectDraft {
  name: string;
  layout: "agent" | "business";
  permissions: string[];
  steps: AssemblyStep[];
}
export interface ValidationIssue {
  code: string;
  message: string;
  step?: number;
}
export interface ProjectRecord extends ProjectDraft {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  validation: { ready: boolean; issues: ValidationIssue[] };
}
export interface UploadInput {
  filename: string;
  text: string;
  modelConsent?: boolean;
  /** 结构化业务载荷（如调查案件）；由第一步骤按自己的 schema 校验。 */
  payload?: Record<string, unknown>;
  /** 是否授权本次任务把检索式发送给外部检索服务。 */
  dataConsent?: boolean;
}
export interface DocumentItem {
  id: string;
  text: string;
  source: string;
  scope: string;
}
export interface Citation {
  id: string;
  source: string;
  excerpt: string;
  score: number;
  documentId: string;
}
export interface DocumentBundle {
  filename: string;
  documents: DocumentItem[];
  claims: { key: string; value: string; source: string }[];
  citations?: Citation[];
  checks?: { name: string; passed: boolean; detail: string; status?: "passed" | "not_evaluated" }[];
  query?: string;
  modelConsent?: boolean;
  verification?: { summary: string; verdict: string; citations: string[] };
  [key: string]: unknown;
}
export interface AssetLink {
  assetId: string;
  registryVersion?: string;
  registrySha256?: string;
  assetVersion?: null;
  relation:
    "design_reference" | "independent_implementation" | "code_adaptation" | "code_migration";
  adapter: string;
  sourceFiles: { path: string; commit: string | null; sha256: string | null }[];
  note: string;
}
export interface CapabilityInfo {
  id: string;
  version: string;
  name: string;
  description: string;
  inputProtocol: string;
  outputProtocol: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  configSchema: Record<string, unknown>;
  defaultConfig: Record<string, unknown>;
  permissions: string[];
  effects: string[];
  kind: "tool" | "human";
  requiresApproval?: boolean;
  approvalScope?: string;
  dependencies: { id: string; ready: boolean; reason: string }[];
  enabled: boolean;
  status:
    | "ready_unverified"
    | "verified"
    | "registered_missing_dependencies"
    | "disabled";
  implementationHash: string;
  assets: AssetLink[];
  acceptance: { runId: string; stepId: string; at: string } | null;
}
export interface RuntimeAsset {
  id: string;
  name: string;
  sourceProjects: string[];
  sourceFiles: string[];
  runtimeCapabilities: CapabilityInfo[];
  status: string;
}
export interface Catalog {
  registry: { version: string; sha256: string; path: string };
  capabilities: CapabilityInfo[];
  assets: RuntimeAsset[];
  providers: {
    id: string;
    available: boolean;
    reason: string;
    model?: string;
  }[];
}
export type ExperienceKind =
  | "verified_solution"
  | "unverified_suggestion"
  | "known_failure";
export interface CapabilityRef {
  capabilityId: string;
  version: string;
  name: string;
}
/** 保存下来的能力组合：一段可复用的执行顺序。 */
export interface CompositionRecord {
  id: string;
  name: string;
  description: string;
  layout: "agent" | "business";
  permissions: string[];
  steps: AssemblyStep[];
  capabilities: CapabilityRef[];
  sourceProjectId: string | null;
  sourceProjectName: string | null;
  createdBy: string;
  reuseCount: number;
  lastReusedAt: string | null;
  lastReusedProjectName: string | null;
  createdAt: string;
  updatedAt: string;
  validation: { ready: boolean; issues: ValidationIssue[] };
}
export type FeedbackOutcome = "worked" | "partly" | "failed";
export interface RunFeedbackRecord {
  id: string;
  runId: string;
  projectId: string;
  projectName: string;
  outcome: FeedbackOutcome;
  correction: string;
  reusable: boolean;
  referenceValue: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}
export interface ExperienceRecord {
  id: string;
  title: string;
  kind: ExperienceKind;
  problem: string;
  resolution: string;
  projectId: string | null;
  projectName: string | null;
  runId: string | null;
  capabilities: CapabilityRef[];
  tags: string[];
  sourceFeedbackId: string | null;
  verifiedRunId: string | null;
  verifiedProjectName: string | null;
  verifiedAt: string | null;
  author: string;
  createdAt: string;
  updatedAt: string;
}
/** 一条调查纠错经验：结构化字段来自真实调查记录，人工只补处理方式与边界。 */
export interface TraceExperienceRecord {
  id: string;
  title: string;
  kind: string;
  status: "pending" | "confirmed" | "disabled";
  version: number;
  projectId: string | null;
  projectName: string | null;
  runId: string | null;
  author: string;
  createdAt: string;
  updatedAt: string;
  payload: {
    kind: "date_role" | "quantity_strict" | "scope_partial";
    sourceClaim: string;
    sourceFacts: string[];
    sourceRunIds: string[];
    sourceProjectIds: string[];
    wrongJudgment: string;
    correctedJudgment: string;
    handling: string;
    limits: string;
    checkPoints: string[];
    evidence: { runId: string; url: string; title: string; relation: string; quote: string; date: string }[];
    version: number;
    status: "pending" | "confirmed" | "disabled";
    history: { at: string; action: string; actor: string; note?: string }[];
  } | null;
}

/** 一次运行的可反馈摘要：项目、能力、失败步骤与真实交付。 */
export interface RunFeedbackBundle {
  run: {
    id: string;
    projectId: string;
    projectName: string;
    status: RunStatus;
    createdAt: string;
    inputFilename: string;
    capabilities: CapabilityRef[];
    failures: {
      position: number;
      capabilityId: string;
      name: string;
      code: string;
      message: string;
      attempts: number;
      durationMs: number | null;
    }[];
    artifacts: ArtifactRecord[];
  };
  feedback: RunFeedbackRecord | null;
  experiences: ExperienceRecord[];
}
export interface ProjectApplication {
  projectId: string;
  appName: string;
  title: string;
  layout: "agent" | "business";
  port: number;
  relativePath: string;
  status: "generated" | "failed";
  message: string | null;
  createdAt: string;
  updatedAt: string;
  devUrl: string;
  commands: { dev: string; build: string };
}
export interface ApplicationManifest {
  application: ProjectApplication;
  files: string[];
  entry: { readable: boolean; bindsProject: boolean };
}
export interface PortfolioSuggestion {
  registry: { version: string; sha256: string; path: string };
  appliesTo: string;
  writeBack: false;
  reason: string;
  suggestion: {
    action: string;
    entry: {
      name: string;
      kind: ExperienceKind;
      summary: string;
      resolution: string;
      capabilities: string[];
      evidenceRunId: string | null;
      sourceProject: string | null;
    };
  };
}
export interface OverviewProject {
  id: string;
  name: string;
  layout: "agent" | "business";
  revision: number;
  updatedAt: string;
  ready: boolean;
  issueCount: number;
  capabilities: (CapabilityRef & { status: CapabilityInfo["status"] | "unregistered" })[];
  runs: { completed: number; failed: number; pending: number; total: number };
  lastRun: { id: string; status: RunStatus; createdAt: string; filename: string } | null;
  feedbackCount: number;
  experienceCount: number;
  artifacts: number;
  application: ProjectApplication | null;
}
export interface OverviewRecord {
  generatedAt: string;
  projects: OverviewProject[];
  runs: {
    total: number;
    byStatus: Record<string, number>;
    recent: {
      id: string;
      projectId: string;
      projectName: string;
      status: RunStatus;
      createdAt: string;
      filename: string;
      failedStep: { position: number; capability: string; message: string } | null;
    }[];
    failures: {
      code: string;
      message: string;
      count: number;
      lastRunId: string;
      projectName: string;
      capability: string;
      at: string;
    }[];
  };
  feedback: { total: number; recent: RunFeedbackRecord[] };
  experiences: { total: number; byKind: Record<string, number>; recent: ExperienceRecord[] };
  artifacts: {
    total: number;
    recent: { runId: string; projectName: string; filename: string; bytes: number; createdAt: string }[];
  };
  models: { calls: number; durationMs: number; cost: "not_tracked"; note: string };
}
export interface RunStepRecord {
  id: string;
  position: number;
  capabilityId: string;
  version: string;
  status: string;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  input: unknown;
  output: unknown;
  error: { code: string; message: string } | null;
}
export interface ArtifactRecord {
  id: string;
  filename: string;
  mime: string;
  sha256: string;
  bytes: number;
  createdAt: string;
}
export interface EvidenceRecord {
  id: string;
  kind: string;
  sha256: string;
  data: unknown;
  createdAt: string;
  stepId: string;
}
export interface ApprovalRecord {
  id: string;
  stepId: string;
  inputHash: string;
  status: string;
  actor: string | null;
  decidedAt: string | null;
}
export interface RunRecord {
  id: string;
  projectId: string;
  projectName: string;
  projectRevision: number;
  assembly: (AssemblyStep & { manifest?: CapabilityInfo })[];
  status: RunStatus;
  input: UploadInput;
  createdAt: string;
  updatedAt: string;
  error: { code: string; message: string } | null;
  steps: RunStepRecord[];
  approvals: ApprovalRecord[];
  evidence: EvidenceRecord[];
  artifacts: ArtifactRecord[];
  events: {
    id: number;
    type: string;
    at: string;
    data: unknown;
    previousHash: string;
    hash: string;
  }[];
  modelCalls: {
    id: string;
    model: string;
    status: string;
    durationMs: number;
    response: unknown;
    error: unknown;
  }[];
}
export class RuntimeApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues: ValidationIssue[] = [],
  ) {
    super(message);
  }
}
export function createRuntimeClient(base = "/api") {
  const root = base.replace(/\/$/, "");
  async function request<T>(
    url: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(root + "/v1" + url, {
        method,
        headers: {
          "content-type": "application/json",
          "x-platform-client": "workbench-v1",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new RuntimeApiError(
        0,
        "RUNTIME_UNREACHABLE",
        "无法连接运行服务，请启动Runtime后重试。",
      );
    }
    const raw = await response.text();
    let data: any = null;
    if (raw) try { data = JSON.parse(raw); } catch {
      throw new RuntimeApiError(response.status, "RUNTIME_RESPONSE_INVALID",
        `运行服务返回异常（HTTP ${response.status}），请确认Runtime已启动后重试。`);
    }
    if (!response.ok)
      throw new RuntimeApiError(
        response.status,
        data.code || "REQUEST_FAILED",
        data.message || "请求失败",
        data.issues || [],
      );
    return data;
  }
  return {
    catalog: () => request<Catalog>("/catalog"),
    projects: () => request<ProjectRecord[]>("/projects"),
    project: (id: string) =>
      request<ProjectRecord>("/projects/" + encodeURIComponent(id)),
    createProject: (value: ProjectDraft) =>
      request<ProjectRecord>("/projects", "POST", value),
    saveProject: (id: string, value: ProjectDraft & { revision: number }) =>
      request<ProjectRecord>(
        "/projects/" + encodeURIComponent(id),
        "PUT",
        value,
      ),
    validateProject: (id: string) =>
      request<ProjectRecord["validation"]>(
        "/projects/" + encodeURIComponent(id) + "/validate",
        "POST",
        {},
      ),
    runs: (projectId?: string) =>
      request<RunRecord[]>(
        "/runs" +
          (projectId ? "?projectId=" + encodeURIComponent(projectId) : ""),
      ),
    run: (id: string) => request<RunRecord>("/runs/" + encodeURIComponent(id)),
    execute: (projectId: string, input: UploadInput, expectedRevision: number) =>
      request<RunRecord>(
        "/projects/" + encodeURIComponent(projectId) + "/runs",
        "POST",
        { ...input, expectedRevision },
      ),
    cancel: (id: string) =>
      request<RunRecord>(
        "/runs/" + encodeURIComponent(id) + "/cancel",
        "POST",
        {},
      ),
    decide: (
      runId: string,
      approvalId: string,
      decision: "approve" | "reject",
      actor: string,
    ) =>
      request<RunRecord>(
        "/runs/" +
          encodeURIComponent(runId) +
          "/approvals/" +
          encodeURIComponent(approvalId),
        "POST",
        { decision, actor },
      ),
    retry: (id: string) =>
      request<RunRecord>(
        "/runs/" + encodeURIComponent(id) + "/retry",
        "POST",
        {},
      ),
    setEnabled: (id: string, version: string, enabled: boolean) =>
      request<CapabilityInfo>(
        "/capabilities/" +
          encodeURIComponent(id) +
          "/" +
          encodeURIComponent(version),
        "PATCH",
        { enabled },
      ),
    artifactUrl: (runId: string, id: string) =>
      root +
      "/v1/runs/" +
      encodeURIComponent(runId) +
      "/artifacts/" +
      encodeURIComponent(id),
    receiptUrl: (runId: string) => root + "/v1/runs/" + encodeURIComponent(runId) + "/receipt",
    // 项目应用：复用现有应用生成器，不另写一套项目管理。
    overview: () => request<OverviewRecord>("/overview"),
    application: (projectId: string) =>
      request<ProjectApplication | null>(
        "/projects/" + encodeURIComponent(projectId) + "/application",
      ),
    createApplication: (
      projectId: string,
      value: { appName: string; port: number; title?: string },
    ) =>
      request<ProjectApplication>(
        "/projects/" + encodeURIComponent(projectId) + "/application",
        "POST",
        value,
      ),
    applicationManifest: (projectId: string) =>
      request<ApplicationManifest>(
        "/projects/" + encodeURIComponent(projectId) + "/application/manifest",
      ),
    // 能力组合：保存、复用、删除。
    compositions: () => request<CompositionRecord[]>("/compositions"),
    createComposition: (value: {
      name: string;
      description?: string;
      layout?: "agent" | "business";
      permissions?: string[];
      steps: AssemblyStep[];
      sourceProjectId?: string;
      createdBy?: string;
    }) => request<CompositionRecord>("/compositions", "POST", value),
    deleteComposition: (id: string) =>
      request<null>("/compositions/" + encodeURIComponent(id), "DELETE"),
    applyComposition: (
      projectId: string,
      value: { compositionId: string; revision: number; mode?: "append" | "replace" },
    ) =>
      request<ProjectRecord>(
        "/projects/" + encodeURIComponent(projectId) + "/compositions",
        "POST",
        value,
      ),
    // 运行反馈与经验沉淀。
    feedback: (runId: string) =>
      request<RunFeedbackBundle>("/runs/" + encodeURIComponent(runId) + "/feedback"),
    saveFeedback: (
      runId: string,
      value: {
        outcome: FeedbackOutcome;
        correction: string;
        reusable: boolean;
        referenceValue?: string;
        author: string;
      },
    ) =>
      request<RunFeedbackBundle>(
        "/runs/" + encodeURIComponent(runId) + "/feedback",
        "POST",
        value,
      ),
    experiences: (query: { q?: string; kind?: string; capability?: string } = {}) => {
      const search = new URLSearchParams();
      if (query.q) search.set("q", query.q);
      if (query.kind) search.set("kind", query.kind);
      if (query.capability) search.set("capability", query.capability);
      const suffix = search.toString();
      return request<ExperienceRecord[]>("/experiences" + (suffix ? "?" + suffix : ""));
    },
    createExperience: (value: {
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
    }) => request<ExperienceRecord>("/experiences", "POST", value),
    verifyExperience: (id: string, verifiedByRunId: string) =>
      request<ExperienceRecord>(
        "/experiences/" + encodeURIComponent(id),
        "PATCH",
        { verifiedByRunId },
      ),
    portfolioSuggestion: (id: string) =>
      request<PortfolioSuggestion>(
        "/experiences/" + encodeURIComponent(id) + "/portfolio-suggestion",
      ),
    /** 调查纠错经验（TRACE）：待确认 → 已确认 → 停用，状态变化保留历史。 */
    traceExperiences: () =>
      request<{
        total: number;
        byStatus: { pending: number; confirmed: number; disabled: number };
        experiences: TraceExperienceRecord[];
      }>("/trace/experiences"),
    traceExperienceStatus: (
      id: string,
      value: { action: "confirm" | "disable" | "restore"; actor: string; note?: string },
    ) =>
      request<{ experience: TraceExperienceRecord }>(
        "/trace/experiences/" + encodeURIComponent(id) + "/status",
        "POST",
        value,
      ),
  };
}
export type RuntimeApi = ReturnType<typeof createRuntimeClient>;
export const standardPermissions = [
  "document:read",
  "document:validate",
  "knowledge:search",
  "evidence:write",
  "file:write",
];
export const standardAssembly: AssemblyStep[] = [
  { capabilityId: "documents.parse", version: "1.0.0", config: {} },
  {
    capabilityId: "documents.scope-check",
    version: "1.0.0",
    config: { allowedScopes: ["general"], rejectConflicts: true },
  },
  {
    capabilityId: "knowledge.search",
    version: "1.0.0",
    config: { query: "", limit: 5 },
  },
  { capabilityId: "evidence.record", version: "1.0.0", config: {} },
  { capabilityId: "runtime.snapshot", version: "1.0.0", config: {} },
  { capabilityId: "human.confirm", version: "1.0.0", config: {} },
  { capabilityId: "report.export", version: "1.0.0", config: {} },
];
