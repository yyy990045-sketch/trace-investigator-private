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
    let data;
    try { data = JSON.parse(raw); } catch {
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
