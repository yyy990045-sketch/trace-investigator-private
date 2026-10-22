/**
 * TRACE 调查卷宗契约（trace.case.v1）。
 *
 * 关键设计：卷宗同时满足公共 document.bundle.v1 的字段要求（filename / documents / claims），
 * 这样 human.confirm、report.export 等既有公共能力可以直接接在调查链后面，
 * 而调查专属信息（检索记录、原文抓取、逐条事实评估、结论）放在额外字段里。
 */
import { bundleSchema, uploadSchema, emptyConfig, type Schema } from "../../src/contracts.ts";
import type { SearchAttempt, SearchConfiguration } from "./searchpro.ts";
import type { AnalysablePage, CaseAssessment, FactAssessment, TraceFact } from "./analyze.ts";

export const TRACE_VERSION = "trace.case.v1";

export interface TraceBodyRecord {
  pageId: string;
  url: string;
  ok: boolean;
  httpStatus: number | null;
  contentType: string;
  bytes: number;
  textLength: number;
  reprintMarkers: string[];
  error: { code: string; message: string } | null;
  durationMs: number;
}

export interface TraceCase {
  question: string;
  /** 用户想核查的说法；缺省时等于 question */
  claim: string;
  facts: TraceFact[];
  /** 事实拆解来源：本版本只支持人工确认，绝不声称 AI 已完成拆解 */
  mode: "manual";
  modeNote: string;
  consent: { search: boolean; model: boolean };
  createdAt: string;
}

export interface SearchStatus {
  provider: "tencent-wsa";
  available: boolean;
  code: string | null;
  reason: string;
  endpointHost: string;
  timeoutMs: number;
  maxAttempts: number;
  totalQueries: number;
  failedQueries: number;
  emptyQueries: number;
  succeededQueries: number;
  rateLimitedQueries: number;
  totalDurationMs: number;
}

export interface TraceBundle {
  filename: string;
  text: string;
  modelConsent: boolean;
  dataConsent: boolean;
  case: TraceCase;
  search: SearchStatus;
  searches: SearchAttempt[];
  pages: AnalysablePage[];
  bodies: TraceBodyRecord[];
  assessment?: {
    facts: FactAssessment[];
    verdict: CaseAssessment;
    independentSources: number;
    bodyAvailable: number;
  };
  /** 满足 document.bundle.v1 的最小映射，供公共能力复用 */
  documents: { id: string; text: string; source: string; scope: string }[];
  claims: { key: string; value: string; source: string }[];
  checks: { name: string; passed: boolean; detail: string; status?: "passed" | "not_evaluated" }[];
  execution?: unknown;
  traceVersion: string;
  [key: string]: unknown;
}

const factSchema = {
  type: "object",
  required: ["id", "text", "queries"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 40 },
    text: { type: "string", minLength: 2, maxLength: 400 },
    queries: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 120 } },
    timeScope: { type: "string", maxLength: 60 },
    subjectScope: { type: "string", maxLength: 60 },
  },
  additionalProperties: false,
};

export const traceBundleSchema: Schema = {
  type: "object",
  required: [
    "filename",
    "case",
    "search",
    "searches",
    "pages",
    "bodies",
    "documents",
    "claims",
    "checks",
    "traceVersion",
  ],
  properties: {
    filename: { type: "string" },
    text: { type: "string" },
    modelConsent: { type: "boolean" },
    dataConsent: { type: "boolean" },
    traceVersion: { type: "string", const: TRACE_VERSION },
    case: {
      type: "object",
      required: ["question", "claim", "facts", "mode", "modeNote", "consent", "createdAt"],
      properties: {
        question: { type: "string", minLength: 2, maxLength: 500 },
        claim: { type: "string", minLength: 2, maxLength: 500 },
        facts: { type: "array", maxItems: 6, items: factSchema },
        mode: { type: "string", const: "manual" },
        modeNote: { type: "string" },
        consent: {
          type: "object",
          required: ["search", "model"],
          properties: { search: { type: "boolean" }, model: { type: "boolean" } },
          additionalProperties: false,
        },
        createdAt: { type: "string" },
      },
      additionalProperties: false,
    },
    search: { type: "object" },
    searches: { type: "array", items: { type: "object" } },
    pages: { type: "array", items: { type: "object" } },
    bodies: { type: "array", items: { type: "object" } },
    assessment: { type: "object" },
    documents: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "text", "source", "scope"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          source: { type: "string" },
          scope: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "value", "source"],
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          source: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    checks: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "passed", "detail"],
        properties: {
          name: { type: "string" },
          passed: { type: "boolean" },
          detail: { type: "string" },
          status: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    execution: { type: "object" },
  },
  additionalProperties: true,
};

/** 第一步骤的输入就是公共上传契约（payload 携带结构化案件）。 */
export const traceInputSchema = uploadSchema;
export const traceOutputSchema = traceBundleSchema;
/** 交给公共 human.confirm / 导出使用的契约。 */
export const publicBundleSchema = bundleSchema;
export const emptyTraceConfig = emptyConfig;

export function emptySearchStatus(config: SearchConfiguration): SearchStatus {
  return {
    provider: config.provider,
    available: config.available,
    code: config.code || null,
    reason: config.reason,
    endpointHost: config.endpointHost,
    timeoutMs: config.timeoutMs,
    maxAttempts: config.maxAttempts,
    totalQueries: 0,
    failedQueries: 0,
    emptyQueries: 0,
    succeededQueries: 0,
    rateLimitedQueries: 0,
    totalDurationMs: 0,
  };
}

export function summarizeSearch(config: SearchConfiguration, attempts: SearchAttempt[]): SearchStatus {
  const failed = attempts.filter((a) => a.error && a.error.code !== "SEARCH_PROVIDER_ERROR").length;
  const empty = attempts.filter((a) => a.error?.message.includes("没有返回任何网页")).length;
  return {
    ...emptySearchStatus(config),
    totalQueries: attempts.length,
    failedQueries: failed,
    emptyQueries: empty,
    succeededQueries: attempts.filter((a) => !a.error).length,
    rateLimitedQueries: attempts.filter((a) => a.error?.code === "SEARCH_RATE_LIMITED").length,
    totalDurationMs: attempts.reduce((n, a) => n + a.durationMs, 0),
  };
}
