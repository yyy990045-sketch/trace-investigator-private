/**
 * TRACE 应用的数据访问层。
 *
 * 只通过公共 capability-sdk 访问 Runtime；应用自身不保存任何检索结果或结论。
 * 项目「溯证 TRACE 调查流程」首次使用时按固定能力序列创建，之后固定复用。
 */
import {
  createRuntimeClient,
  type AssemblyStep,
  type ProjectRecord,
  type RunRecord,
  type RunStepRecord,
} from "@personal/capability-sdk";

const liveClient = createRuntimeClient(import.meta.env.VITE_RUNTIME_API_URL || "/api");

/**
 * 只读静态展示模式：把同一套界面跑在「历史调查记录」上，不连 Runtime。
 * 数据由 tooling/trace-showcase-export.mjs 从本机真实运行记录导出，只含公开页面信息。
 */
export const SHOWCASE = import.meta.env.VITE_TRACE_MODE === "showcase";

export interface ShowcaseCase {
  key: string;
  label: string;
  note: string;
  runId: string;
  run: RunRecord;
  assessment: NonNullable<TraceBundleView["assessment"]> | null;
  revisions: unknown;
}

export interface ShowcaseData {
  kind: "trace-showcase";
  generatedAt: string;
  product: { name: string; tagline: string; boundary: string };
  cases: ShowcaseCase[];
  /** artifactId -> 相对路径，静态站里直接用文件本身 */
  artifactIndex: Record<string, string>;
}

function showcaseData(): ShowcaseData {
  const data = (window as unknown as { __TRACE_SHOWCASE__?: ShowcaseData }).__TRACE_SHOWCASE__;
  if (!data?.cases?.length)
    throw new Error("静态展示数据缺失：请重新执行只读展示构建。");
  return data;
}

/** 只读展示里的三个案例（工作区模式下为空）。 */
export function showcaseCases(): ShowcaseCase[] {
  if (!SHOWCASE) return [];
  try {
    return showcaseData().cases;
  } catch {
    return [];
  }
}

export function showcaseCase(runId: string): ShowcaseCase {
  const hit = showcaseData().cases.find((item) => item.runId === runId);
  if (!hit) throw new Error("这份静态展示里没有该调查记录。");
  return hit;
}

const readOnly = () =>
  new Error("这是历史调查记录（只读展示）。需要实时联网调查，请在本机运行 Runtime 后打开工作区版本。");

const showcaseClient = {
  run: async (id: string) => showcaseCase(id).run,
  runs: async () => showcaseData().cases.map((item) => item.run),
  artifactUrl: (_runId: string, id: string) => {
    const path = showcaseData().artifactIndex[id];
    if (!path) throw new Error("这份静态展示里没有该档案文件。");
    return "./" + path;
  },
  receiptUrl: () => "#",
  catalog: async () => {
    throw readOnly();
  },
  projects: async () => {
    throw readOnly();
  },
  createProject: async () => {
    throw readOnly();
  },
  execute: async () => {
    throw readOnly();
  },
  decide: async () => {
    throw readOnly();
  },
  retry: async () => {
    throw readOnly();
  },
} as unknown as ReturnType<typeof createRuntimeClient>;

export const client = SHOWCASE ? showcaseClient : liveClient;

export const PROJECT_NAME = "溯证 TRACE 调查流程";

export const PERMISSIONS = [
  "document:read",
  "document:validate",
  "knowledge:search",
  "data:external",
  "evidence:write",
  "file:write",
];

export const ASSEMBLY: AssemblyStep[] = [
  { capabilityId: "trace.case.intake", version: "1.0.0", config: {} },
  { capabilityId: "trace.facts.confirm", version: "1.0.0", config: {} },
  {
    capabilityId: "trace.web.search",
    version: "1.0.0",
    config: { fetchBodyBudget: 6, requestTimeoutMs: 20000, gapMs: 350 },
    timeoutMs: 120000,
  },
  { capabilityId: "trace.evidence.verify", version: "1.0.0", config: {} },
  { capabilityId: "human.confirm", version: "1.0.0", config: {} },
  { capabilityId: "trace.archive.export", version: "1.0.0", config: {} },
];

export async function ensureProject(withModel = false): Promise<ProjectRecord> {
  if (SHOWCASE) throw readOnly();
  const name = withModel ? "溯证 TRACE 模型复核调查流程" : PROJECT_NAME;
  const assembly = withModel ? [
    ...ASSEMBLY.slice(0, 4),
    { capabilityId: "trace.model.context", version: "1.0.0", config: {} },
    { capabilityId: "model.verify", version: "1.0.0", config: {}, timeoutMs: 60000, retries: 0 },
    ASSEMBLY[4],
    { capabilityId: "trace.model.archive", version: "1.0.0", config: {} },
  ] : ASSEMBLY;
  const projects = await client.projects();
  const existing = projects.find((p) => p.name === name);
  if (existing) {
    // 能力序列变化时不允许静默替换，交给界面提示重新装配。
    const same =
      existing.steps.length === assembly.length &&
      existing.steps.every((s, i) => s.capabilityId === assembly[i].capabilityId && s.version === assembly[i].version);
    if (!same)
      throw new Error(
        "现有调查流程的项目装配与当前版本不一致，请在 Studio 中新建项目后重试，或删除旧项目。",
      );
    if (!existing.validation.ready)
      throw new Error("当前调查流程有未满足的权限或依赖，请刷新能力状态并核对项目装配。");
    return existing;
  }
  return client.createProject({
    name,
    layout: "business",
    permissions: withModel ? [...PERMISSIONS, "model:invoke"] : PERMISSIONS,
    steps: assembly,
  });
}

export async function searchAvailability() {
  if (SHOWCASE)
    return {
      available: false,
      reason: "这是只读的历史调查展示，不联网查询；需要新调查请在本机运行 Runtime。",
      endpointHost: "",
    };
  const catalog = await client.catalog();
  const provider = catalog.providers.find((p) => p.id === "tencent-wsa-search");
  return {
    available: provider?.available === true,
    reason: provider?.reason || "运行服务未返回检索能力状态。",
    endpointHost: (provider as { endpointHost?: string } | undefined)?.endpointHost || "",
  };
}

export async function modelAvailability() {
  if (SHOWCASE) return { available: false, reason: "历史记录只读展示，不发起模型调用。" };
  const catalog = await client.catalog();
  const provider = catalog.providers.find((item) => item.id === "platform-model");
  return { available: provider?.available === true, reason: provider?.reason || "模型服务尚不可用。" };
}

export interface FactDraft {
  id: string;
  text: string;
  queries: string[];
  timeScope?: string;
  subjectScope?: string;
}

export interface CaseDraft {
  question: string;
  claim: string;
  facts: FactDraft[];
}

export function startInvestigation(project: ProjectRecord, draft: CaseDraft, modelConsent = false) {
  return client.execute(
    project.id,
    {
      filename: "调查案件.json",
      text: draft.question,
      payload: {
        question: draft.question,
        claim: draft.claim,
        facts: draft.facts.map((fact) => ({
          id: fact.id,
          text: fact.text,
          queries: fact.queries,
          ...(fact.timeScope ? { timeScope: fact.timeScope } : {}),
          ...(fact.subjectScope ? { subjectScope: fact.subjectScope } : {}),
        })),
      },
      dataConsent: true,
      modelConsent,
    },
    project.revision,
  );
}

export type Relation = "supports" | "contradicts" | "unclear" | "irrelevant" | "mixed" | "none";

export interface SourceAssessment {
  pageId: string;
  url: string;
  site: string;
  title: string;
  date: string;
  excerpt: string;
  relation: Relation;
  relevance: number;
  reasons: string[];
  bodyAvailable: boolean;
  bodyExcerpt: string | null;
  originality: "original_candidate" | "reprint" | "unknown";
  reprintMarkers: string[];
  clusterId: string;
  duplicate: boolean;
  dateStatus: "in_range" | "out_of_range" | "unknown";
  dateNote: string;
  /**
   * 独立性三态：unique 未检测到重复（不等于"已证实独立"）；
   * duplicate 有明确依据证明同源；unconfirmed 有同源线索但证据不足。
   */
  independence?: "unique" | "duplicate" | "unconfirmed";
  citedOrigin?: { org: string; quote: string } | null;
  duplicateOf?: { primary: string; basis: string } | null;
  independenceNote?: string;
  /** 人工修正后保留的系统自动判断 */
  autoRelation?: Relation;
  /** 有人工修正时才有；原始搜索返回与摘录不因此改变 */
  manualCorrection?: {
    relation: Relation;
    note: string;
    actor: string;
    at: string;
    impact?: CorrectionImpact;
  } | null;
}

export interface FactAssessment {
  factId: string;
  fact: string;
  relation: Relation;
  independentClusters: number;
  bodyBackedClusters: number;
  supports: number;
  contradicts: number;
  unclear?: number;
  irrelevant?: number;
  unconfirmedSources?: number;
  unconfirmedClusters?: number;
  /** 被多条来源共同引用的原始出处（按 1 条独立证据计） */
  sharedOrigins?: { org: string; count: number }[];
  sources: SourceAssessment[];
  reasons: string[];
}

export interface Verdict {
  outcome: "supported" | "contradicted" | "disputed" | "outdated" | "insufficient";
  headline: string;
  statement: string;
  confidence: "low" | "medium" | "high";
  reasons: string[];
  counts: {
    queries: number;
    failedQueries: number;
    emptyQueries: number;
    pages: number;
    independentSources: number;
    bodyAvailable: number;
  };
}

export interface SearchAttemptView {
  query: string;
  requestId: string | null;
  httpStatus: number | null;
  durationMs: number;
  attempts: number;
  resultCount: number;
  requestedAt: string;
  error: { code: string; message: string; retryable: boolean } | null;
}

export interface TraceCaseView {
  question: string;
  claim: string;
  mode: "manual";
  modeNote: string;
  createdAt: string;
  facts: FactDraft[];
}

export interface TraceBundleView {
  case: TraceCaseView;
  search: {
    available: boolean;
    reason: string;
    code: string | null;
    endpointHost: string;
    totalQueries: number;
    succeededQueries: number;
    failedQueries: number;
    emptyQueries: number;
    rateLimitedQueries: number;
    totalDurationMs: number;
  };
  searches: SearchAttemptView[];
  bodies: { pageId: string; url: string; ok: boolean; httpStatus: number | null; textLength: number; error: { code: string; message: string } | null }[];
  assessment?: {
    facts: FactAssessment[];
    verdict: Verdict;
    independentSources: number;
    bodyAvailable: number;
    clusters?: SourceCluster[];
    openQuestions?: string[];
    pageCount?: number;
    followupCount?: number;
    correctionCount?: number;
    unconfirmedPages?: string[];
    clusterBasis?: Record<string, string>;
    corrections?: CorrectionRecord[];
  };
  checks: { name: string; passed: boolean; detail: string; status?: string }[];
}

export function stepOf(run: RunRecord, capabilityId: string): RunStepRecord | undefined {
  return run.steps.find((step) => step.capabilityId === capabilityId);
}

/** 取当前最新的调查卷宗：优先核验结果，其次检索结果，最后立案结果。 */
export function bundleOf(run: RunRecord): TraceBundleView | null {
  for (const id of ["trace.evidence.verify", "trace.web.search", "trace.case.intake"]) {
    const step = stepOf(run, id);
    if (step?.output && (step.output as { case?: unknown }).case)
      return step.output as TraceBundleView;
  }
  return null;
}

export function activeRun(run: RunRecord) {
  return ["queued", "running", "waiting_approval", "cancel_requested"].includes(run.status);
}

export function pendingApproval(run: RunRecord) {
  return run.approvals.find((a) => a.status === "pending");
}

export function archiveArtifacts(run: RunRecord) {
  return run.artifacts.filter((a) => a.filename.startsWith("调查档案"));
}

export const outcomeText: Record<Verdict["outcome"], string> = {
  supported: "有依据支持",
  contradicted: "存在反证",
  disputed: "存在争议",
  outdated: "信息过期或原文不足",
  insufficient: "证据不足",
};

export const relationText: Record<Relation, string> = {
  supports: "支持",
  contradicts: "反对",
  unclear: "无法确认",
  irrelevant: "无关",
  mixed: "存在争议",
  none: "无可用来源",
};

export const stepText: Record<string, string> = {
  "trace.case.intake": "立案",
  "trace.facts.confirm": "事实确认",
  "trace.web.search": "联网检索",
  "trace.evidence.verify": "证据核验",
  "trace.model.context": "准备复核",
  "model.verify": "模型复核",
  "trace.model.archive": "档案导出",
  "human.confirm": "人工确认",
  "trace.archive.export": "档案导出",
};

/** 同源/转载分组：让界面能直接说「这几篇其实是同一个原始出处」。 */
export interface SourceCluster {
  id: string;
  primary: {
    title: string;
    url: string;
    site: string;
    date: string;
    bodyAvailable: boolean;
    originality: SourceAssessment["originality"];
  };
  size: number;
  reprint: boolean;
  members: { title: string; url: string; site: string; date: string; bodyAvailable: boolean }[];
}

export interface FollowupPage {
  id: string;
  title: string;
  url: string;
  site: string;
  date: string;
  passage: string;
}

export interface FollowupRecord {
  query: string;
  requestId: string | null;
  httpStatus: number | null;
  durationMs: number;
  resultCount: number;
  requestedAt: string;
  error: { code: string; message: string } | null;
  pages: FollowupPage[];
}

const runtimeBase = (import.meta.env.VITE_RUNTIME_API_URL || "/api").replace(/\/$/, "");

async function traceRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(runtimeBase + path, {
      method,
      headers: { "content-type": "application/json", "x-platform-client": "workbench-v1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("无法连接本机运行服务，请确认 Runtime 已启动。");
  }
  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`运行服务返回异常（HTTP ${response.status}）。`);
  }
  if (!response.ok) throw new Error(data.message || "请求失败");
  return data as T;
}

/** 读取当前评估：优先最新重算结果，其次核验步骤输出。 */
export function fetchAssessment(runId: string) {
  if (SHOWCASE) {
    const item = showcaseCase(runId);
    return Promise.resolve({ source: "archive", at: null, assessment: item.assessment });
  }
  return traceRequest<{ source: string; at: string | null; assessment: TraceBundleView["assessment"] | null }>(
    `/v1/runs/${encodeURIComponent(runId)}/trace/assessment`,
  );
}

/** 针对某条事实追加一次真实检索；结果写进同一条调查记录。 */
export function postFollowup(runId: string, query: string, factId?: string) {
  if (SHOWCASE) return Promise.reject(readOnly());
  return traceRequest<FollowupRecord>(`/v1/runs/${encodeURIComponent(runId)}/trace/followup`, "POST", {
    query,
    ...(factId ? { factId } : {}),
  });
}

/** 把追加检索合并回卷宗并重算结论。 */
export function postReassess(runId: string) {
  if (SHOWCASE) return Promise.reject(readOnly());
  return traceRequest<{ source: string; at: string; assessment: NonNullable<TraceBundleView["assessment"]> }>(
    `/v1/runs/${encodeURIComponent(runId)}/trace/reassess`,
    "POST",
    {},
  );
}

/** 一次人工修正在写入前后对结论的实际影响（服务端真实重算出来的）。 */
export interface CorrectionImpact {
  sourceBefore: Relation;
  sourceAfter: Relation;
  factBefore: string;
  factAfter: string;
  supportsBefore: number;
  supportsAfter: number;
  clustersBefore: number;
  clustersAfter: number;
  verdictBefore: Verdict["outcome"];
  verdictAfter: Verdict["outcome"];
}

/** 一条人工修正记录：只改证据关系，不改原始搜索返回与摘录。 */
export interface CorrectionRecord {
  pageId: string;
  factId: string;
  relation: Relation;
  note: string;
  actor: string;
  at: string;
  impact?: CorrectionImpact;
}

export interface RevisionSummary {
  revision: number;
  at: string;
  actor: string;
  artifacts: { id: string; filename: string; bytes: number; sha256: string }[];
  verdict: { outcome: Verdict["outcome"]; headline: string; counts: Verdict["counts"] } | null;
  followupCount: number;
  correctionCount: number;
  changes: string[];
  assessment: NonNullable<TraceBundleView["assessment"]> | null;
  derived: boolean;
}

export interface RevisionsView {
  /** 最近一次已交付的版本号；0 表示还没有交付过 */
  deliveredRevision: number;
  /** 交付之后又有了新的追问/修正，当前结论尚未成档 */
  dirty: boolean;
  pendingFollowups: number;
  pendingCorrections: number;
  current: NonNullable<TraceBundleView["assessment"]>;
  changes: string[];
  revisions: RevisionSummary[];
}

/** 已交付版本、当前结论与版本之间的差异。 */
export function fetchRevisions(runId: string) {
  if (SHOWCASE) return Promise.resolve(showcaseCase(runId).revisions as RevisionsView);
  return traceRequest<RevisionsView>(`/v1/runs/${encodeURIComponent(runId)}/trace/revisions`);
}

/** 人工修正某条证据与事实的关系：只改判断，不动原始搜索返回与摘录。 */
export function postCorrection(
  runId: string,
  input: { pageId: string; factId: string; relation: Relation; note: string; actor: string },
) {
  if (SHOWCASE) return Promise.reject(readOnly());
  return traceRequest<{ correction: CorrectionRecord; impact?: CorrectionImpact; correctionCount: number }>(
    `/v1/runs/${encodeURIComponent(runId)}/trace/correction`,
    "POST",
    input,
  );
}

/** 重新确认：把当前结论固化成新的交付版本，旧版本文件保持原样。 */
export function postRedeliver(runId: string, actor: string) {
  if (SHOWCASE) return Promise.reject(readOnly());
  return traceRequest<{
    revision: number;
    at: string;
    actor: string;
    artifacts: { id: string; filename: string; bytes: number; sha256: string }[];
    changes: string[];
    verdict: { outcome: Verdict["outcome"]; headline: string; counts: Verdict["counts"] };
  }>(`/v1/runs/${encodeURIComponent(runId)}/trace/redeliver`, "POST", { actor });
}

/** 三个真实案例：点一下即可带入表单，用户也可以完全自己提问。 */
export interface SampleCase {
  id: string;
  /** 评委视角的三类定位：A 有明确原始证据 / B 需跨来源核查 / C 补充调查后仍可能证据不足 */
  kind: "A" | "B" | "C";
  tag: string;
  question: string;
  claim: string;
  note: string;
  /** 跑完之后应该看到什么（描述能力边界，不预设结论） */
  expect: string;
  /** 证据不足时的建议追问（只在 C 类给） */
  followupHint?: string;
  facts: FactDraft[];
}

export const sampleCases: SampleCase[] = [
  {
    id: "A-original-source",
    kind: "A",
    tag: "A · 有明确原始证据",
    question: "《中华人民共和国个人信息保护法》是什么时候通过、什么时候施行的？",
    claim: "《中华人民共和国个人信息保护法》自2021年11月1日起施行",
    note: "官方原文可查，适合看「原始出处 vs 转载」的差别",
    expect: "能看到官方站点的原文被取到、结论直接引到具体网址，并演示一次人工修正判断。",
    facts: [
      {
        id: "fact-1",
        text: "《中华人民共和国个人信息保护法》自2021年11月1日起施行",
        queries: ["个人信息保护法 施行日期 2021年11月1日", "个人信息保护法 全文 主席令"],
        timeScope: "2021年",
        subjectScope: "中华人民共和国",
      },
    ],
  },
  {
    id: "B-cross-check",
    kind: "B",
    tag: "B · 需要跨来源核查",
    question: "2024年中国新能源汽车产量到底是多少？不同来源给出的数字一致吗？",
    claim: "2024年中国新能源汽车产量超过1200万辆",
    note: "多家统计口径不一，适合看「数量断言怎么比」",
    expect: "能看到系统把「超过 1200 万辆」这类数量断言逐条对照来源数字，口径不一致时明确说明。",
    facts: [
      {
        id: "fact-1",
        text: "2024年中国新能源汽车产量超过1200万辆",
        queries: ["2024年 中国 新能源汽车 产量 万辆", "2024年 新能源汽车 产销 统计数据"],
        timeScope: "2024年",
        subjectScope: "中国",
      },
    ],
  },
  {
    id: "C-insufficient",
    kind: "C",
    tag: "C · 补充调查后仍可能证据不足",
    question: "2025年是否已经建成覆盖全国的氢能长途重卡加氢网络？",
    claim: "2025年中国已建成覆盖全国主要干线的氢能长途重卡加氢网络",
    note: "容易查到相关新闻但不足以支撑结论，适合看「拒绝下结论」",
    expect: "相关新闻很多，但缺少能直接支撑该说法的原文，系统会保留证据不足并列出还缺什么。",
    followupHint: "全国 氢能重卡 加氢站 干线 投运 里程",
    facts: [
      {
        id: "fact-1",
        text: "2025年中国已建成覆盖全国主要干线的氢能长途重卡加氢网络",
        queries: ["2025年 全国 氢能 重卡 加氢网络 建成", "全国加氢站 覆盖 干线 重卡"],
        timeScope: "2025年",
        subjectScope: "中国",
      },
    ],
  },
];

/** 从调查记录里取出所有追加检索。 */
export function followupsOf(run: RunRecord): FollowupRecord[] {
  return run.evidence
    .filter((item) => item.kind === "trace.followup")
    .map((item) => item.data as FollowupRecord);
}

/** 从调查记录里取出所有人工修正（按时间顺序）。 */
export function correctionsOf(run: RunRecord): CorrectionRecord[] {
  return run.evidence
    .filter((item) => item.kind === "trace.correction")
    .map((item) => item.data as CorrectionRecord);
}

/** 已交付到第几版：取版本证据里的最大版本号，没有版本证据时按档案文件数推断。 */
export function revisionsOf(run: RunRecord): number {
  const stored = run.evidence
    .filter((item) => item.kind === "trace.revision")
    .map((item) => (item.data as { revision?: number }).revision || 0);
  if (stored.length) return Math.max(...stored);
  const files = archiveArtifacts(run).filter((file) => file.filename.endsWith(".md")).length;
  return files;
}

/**
 * 当前评估：优先用最新一次重算（含追问与修正），其次最新交付版本的快照，
 * 最后才用核验步骤的输出——否则首页会把首版数字当成现在的数字。
 */
export function currentAssessment(run: RunRecord): NonNullable<TraceBundleView["assessment"]> | null {
  const reassessed = run.evidence.filter((item) => item.kind === "trace.reassessment").pop();
  if (reassessed) {
    const assessment = (reassessed.data as { assessment?: NonNullable<TraceBundleView["assessment"]> }).assessment;
    if (assessment?.verdict) return assessment;
  }
  const delivered = run.evidence.filter((item) => item.kind === "trace.revision").pop();
  if (delivered) {
    const assessment = (delivered.data as { assessment?: NonNullable<TraceBundleView["assessment"]> }).assessment;
    if (assessment?.verdict) return assessment;
  }
  return (bundleOf(run)?.assessment as NonNullable<TraceBundleView["assessment"]>) || null;
}

/**
 * 一个案例的摘要：首页卡片、首页主推面板、跨页跳转都从这里取数，
 * 保证「首页看到的数字」和「调查记录里的数字」是同一份。
 */
/** 模型辅助语义复核：只有在这次调查里真实调用并完成时才存在。 */
export interface ModelReview {
  available: boolean;
  model: string;
  durationMs: number | null;
  verdict: string;
  summary: string;
  citations: { id: string; source: string; excerpt: string }[];
}

export function modelReviewOf(run: RunRecord): ModelReview | null {
  const step = stepOf(run, "model.verify");
  if (!step || step.status !== "completed") return null;
  const output = (step.output || {}) as {
    verification?: { summary?: string; verdict?: string; citations?: string[] };
    citations?: { id: string; source: string; excerpt?: string }[];
  };
  const verification = output.verification;
  if (!verification?.summary) return null;
  const pool = output.citations || [];
  const wanted = verification.citations || [];
  const call = ((run as unknown as { modelCalls?: { model: string; status: string; durationMs: number }[] }).modelCalls || []).find(
    (item) => item.status === "completed",
  );
  return {
    available: true,
    model: call?.model || "平台已配置模型",
    durationMs: call?.durationMs ?? null,
    verdict: verification.verdict || "unclear",
    summary: verification.summary,
    citations: wanted
      .map((id) => pool.find((item) => item.id === id))
      .filter((item): item is { id: string; source: string; excerpt?: string } => !!item)
      .map((item) => ({ id: item.id, source: item.source, excerpt: (item.excerpt || "").slice(0, 600) })),
  };
}

export interface CaseDigest {
  runId: string;
  question: string;
  claim: string;
  outcome: Verdict["outcome"] | null;
  statement: string;
  counts: Verdict["counts"] | null;
  gaps: string[];
  sources: SourceAssessment[];
  independentSources: number;
  bodyBacked: number;
  versions: number;
  followupQueries: string[];
  corrections: CorrectionRecord[];
  factCounts: { supports: number; contradicts: number; unclear: number; irrelevant: number };
  latestChange: string[];
  /** 只有在这次调查里真的跑过模型复核才有值 */
  modelReview: ModelReview | null;
}

export function digestOf(run: RunRecord): CaseDigest {
  const assessment = (currentAssessment(run) || {}) as NonNullable<TraceBundleView["assessment"]>;
  const intake = stepOf(run, "trace.case.intake")?.output as
    | { case?: { question?: string; claim?: string } }
    | undefined;
  const facts = (assessment.facts || []) as FactAssessment[];
  const sources = [...new Map(facts.flatMap((fact) => fact.sources || []).map((source) => [source.pageId, source])).values()];
  const revisions = run.evidence
    .filter((item) => item.kind === "trace.revision")
    .map((item) => item.data as { changes?: string[] });
  return {
    runId: run.id,
    question: intake?.case?.question || run.input?.text || "",
    claim: intake?.case?.claim || intake?.case?.question || run.input?.text || "",
    outcome: assessment.verdict?.outcome ?? null,
    statement: assessment.verdict?.statement ?? "",
    counts: assessment.verdict?.counts ?? null,
    gaps: assessment.openQuestions || [],
    sources,
    independentSources: assessment.independentSources ?? 0,
    bodyBacked: assessment.bodyAvailable ?? 0,
    versions: revisionsOf(run),
    followupQueries: followupsOf(run).map((item) => item.query),
    corrections: correctionsOf(run),
    factCounts: {
      supports: facts.reduce((sum, fact) => sum + (fact.supports || 0), 0),
      contradicts: facts.reduce((sum, fact) => sum + (fact.contradicts || 0), 0),
      unclear: facts.reduce((sum, fact) => sum + (fact.unclear || 0), 0),
      irrelevant: facts.reduce((sum, fact) => sum + (fact.irrelevant || 0), 0),
    },
    latestChange: revisions.length ? revisions[revisions.length - 1].changes || [] : [],
    modelReview: modelReviewOf(run),
  };
}
