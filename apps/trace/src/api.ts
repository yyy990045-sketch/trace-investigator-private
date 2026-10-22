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

export const client = createRuntimeClient(
  import.meta.env.VITE_RUNTIME_API_URL || "/api",
);

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

export async function ensureProject(): Promise<ProjectRecord> {
  const projects = await client.projects();
  const existing = projects.find((p) => p.name === PROJECT_NAME);
  if (existing) {
    // 能力序列变化时不允许静默替换，交给界面提示重新装配。
    const same =
      existing.steps.length === ASSEMBLY.length &&
      existing.steps.every((s, i) => s.capabilityId === ASSEMBLY[i].capabilityId);
    if (!same)
      throw new Error(
        "现有调查流程的项目装配与当前版本不一致，请在 Studio 中新建项目后重试，或删除旧项目。",
      );
    return existing;
  }
  return client.createProject({
    name: PROJECT_NAME,
    layout: "business",
    permissions: PERMISSIONS,
    steps: ASSEMBLY,
  });
}

export async function searchAvailability() {
  const catalog = await client.catalog();
  const provider = catalog.providers.find((p) => p.id === "tencent-wsa-search");
  return {
    available: provider?.available === true,
    reason: provider?.reason || "运行服务未返回检索能力状态。",
    endpointHost: (provider as { endpointHost?: string } | undefined)?.endpointHost || "",
  };
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

export function startInvestigation(project: ProjectRecord, draft: CaseDraft) {
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
  return traceRequest<{ source: string; at: string | null; assessment: TraceBundleView["assessment"] | null }>(
    `/v1/runs/${encodeURIComponent(runId)}/trace/assessment`,
  );
}

/** 针对某条事实追加一次真实检索；结果写进同一条调查记录。 */
export function postFollowup(runId: string, query: string, factId?: string) {
  return traceRequest<FollowupRecord>(`/v1/runs/${encodeURIComponent(runId)}/trace/followup`, "POST", {
    query,
    ...(factId ? { factId } : {}),
  });
}

/** 把追加检索合并回卷宗并重算结论。 */
export function postReassess(runId: string) {
  return traceRequest<{ source: string; at: string; assessment: NonNullable<TraceBundleView["assessment"]> }>(
    `/v1/runs/${encodeURIComponent(runId)}/trace/reassess`,
    "POST",
    {},
  );
}

/** 三个真实案例：点一下即可带入表单，用户也可以完全自己提问。 */
export interface SampleCase {
  id: string;
  tag: string;
  question: string;
  claim: string;
  note: string;
  facts: FactDraft[];
}

export const sampleCases: SampleCase[] = [
  {
    id: "A-original-source",
    tag: "能找到原始出处",
    question: "《中华人民共和国个人信息保护法》是什么时候通过、什么时候施行的？",
    claim: "《中华人民共和国个人信息保护法》自2021年11月1日起施行",
    note: "官方原文可查，适合看「原始出处 vs 转载」的差别",
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
    tag: "需要交叉验证",
    question: "2024年中国新能源汽车产量到底是多少？不同来源给出的数字一致吗？",
    claim: "2024年中国新能源汽车产量超过1200万辆",
    note: "多家统计口径不一，适合看「数量断言怎么比」",
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
    tag: "证据可能不足",
    question: "2025年是否已经建成覆盖全国的氢能长途重卡加氢网络？",
    claim: "2025年中国已建成覆盖全国主要干线的氢能长途重卡加氢网络",
    note: "容易查到相关新闻但不足以支撑结论，适合看「拒绝下结论」",
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
