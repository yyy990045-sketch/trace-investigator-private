/**
 * trace.web.search —— 真实联网检索与原文取证。
 *
 * 现实约束全部显式化：
 *  - 每条检索式单独记录 requestId / HTTP 状态 / 耗时 / 尝试次数 / 错误码；
 *  - 限流与超时不会伪装成「没有结果」，而是写成 SEARCH_RATE_LIMITED / SEARCH_TIMEOUT；
 *  - 未配置密钥时整个步骤直接失败（BLOCKED），绝不返回编造网页；
 *  - 原文抓取按预算串行执行，失败记录原因，不因为有摘要就当成有原文。
 */
import { setTimeout as sleep } from "node:timers/promises";
import { ExecutionError, type CapabilityDefinition } from "../src/contracts.ts";
import { searchConfiguration } from "../adapters/trace/searchpro.ts";
import { traceSearch } from "../src/trace-search.ts";
import { assertTraceScope } from "../adapters/trace/scope.ts";
import { fetchSource } from "../adapters/trace/fetch-source.ts";
import {
  TRACE_VERSION,
  summarizeSearch,
  traceBundleSchema,
} from "../adapters/trace/bundle.ts";

const configSchema = {
  type: "object",
  required: ["fetchBodyBudget", "requestTimeoutMs", "gapMs"],
  properties: {
    /** 最多抓取多少个不同网址的原文正文 */
    fetchBodyBudget: { type: "integer", minimum: 0, maximum: 12 },
    requestTimeoutMs: { type: "integer", minimum: 3000, maximum: 60000 },
    /** 两次检索之间的间隔，降低触发限流的概率 */
    gapMs: { type: "integer", minimum: 0, maximum: 5000 },
  },
  additionalProperties: false,
};

const BODY_TEXT_LIMIT = 20_000;

export default {
  id: "trace.web.search",
  version: "1.0.0",
  name: "联网检索与原文取证",
  description:
    "调用腾讯云元宝搜索 SearchPro 执行多轮真实检索，并抓取原文正文；逐条记录请求、响应状态、耗时与错误。",
  inputProtocol: TRACE_VERSION,
  outputProtocol: TRACE_VERSION,
  inputSchema: traceBundleSchema,
  outputSchema: traceBundleSchema,
  configSchema,
  defaultConfig: { fetchBodyBudget: 6, requestTimeoutMs: 20000, gapMs: 350 },
  permissions: ["knowledge:search", "data:external", "evidence:write"],
  effects: ["external_data"],
  kind: "tool",
  idempotent: true,
  assets: [],
  async execute(input: any, config: any, ctx) {
    const searchConfig = searchConfiguration();
    const facts = (input.case?.facts || []) as { id: string; text: string; queries: string[] }[];
    if (!facts.length) throw new ExecutionError("FACTS_REQUIRED", "没有待核查事实，无法检索。");
    if (!searchConfig.available)
      throw new ExecutionError(
        searchConfig.code || "SEARCH_NOT_CONFIGURED",
        searchConfig.reason,
      );

    const plan = facts.flatMap((fact) => fact.queries.map((query) => ({ factId: fact.id, query })));
    assertTraceScope(String(input.case?.question || input.text || ""));
    for (const fact of facts) assertTraceScope(fact.text, input.case?.question);
    for (const item of plan) assertTraceScope(item.query, input.case?.question);
    ctx.evidence("search.plan", {
      provider: searchConfig.provider,
      endpointHost: searchConfig.endpointHost,
      consent: { search: input.case?.consent?.search === true },
      plan,
    });

    const attempts = [];
    for (const [index, item] of plan.entries()) {
      ctx.signal.throwIfAborted();
      // 公网受控：每次真实检索前先占预算（单次调查上限 + 全站每日上限）。
      // 超额直接抛出可理解错误，不静默跳过检索。
      ctx.signal.throwIfAborted();
      const attempt = await traceSearch(ctx.runId, item.query, {
        scopeContext: input.case?.question,
        signal: ctx.signal,
        timeoutMs: Number(config.requestTimeoutMs) || searchConfig.timeoutMs,
      });
      attempts.push(attempt);
      ctx.evidence("search.call", {
        factId: item.factId,
        query: item.query,
        provider: attempt.provider,
        endpoint: attempt.endpoint,
        requestId: attempt.requestId,
        httpStatus: attempt.httpStatus,
        attempts: attempt.attempts,
        durationMs: attempt.durationMs,
        resultCount: attempt.resultCount,
        error: attempt.error,
        topUrls: attempt.pages.slice(0, 3).map((p) => p.url),
      });
      if (attempt.error?.code === "SEARCH_LIMIT_PER_RUN" || attempt.error?.code === "SEARCH_BUDGET_EXHAUSTED") break;
      if (index < plan.length - 1) await sleep(Number(config.gapMs) || 0, undefined, { signal: ctx.signal });
    }

    // 合并去重：同一网址在同一事实下只保留一条，避免同页多次命中被当作多条证据
    const pageMap = new Map<string, any>();
    for (const attempt of attempts)
      for (const page of attempt.pages) if (!pageMap.has(page.id)) pageMap.set(page.id, page);
    const pages = [...pageMap.values()].sort((a, b) => b.score - a.score);

    // 原文取证：按得分排序，同一网址只抓一次，串行执行并限制总预算
    const bodyTexts: Record<string, { ok: boolean; text: string; reprintMarkers: string[] }> = {};
    const bodies: any[] = [];
    const budget = Math.max(0, Number(config.fetchBodyBudget) || 0);
    const targets = pages.slice(0, budget);
    for (const [index, page] of targets.entries()) {
      ctx.signal.throwIfAborted();
      const fetched = await fetchSource(page.url, { signal: ctx.signal });
      bodyTexts[page.id] = {
        ok: fetched.ok,
        text: fetched.text.slice(0, BODY_TEXT_LIMIT),
        reprintMarkers: fetched.reprintMarkers,
      };
      bodies.push({
        pageId: page.id,
        url: page.url,
        ok: fetched.ok,
        httpStatus: fetched.httpStatus,
        contentType: fetched.contentType,
        bytes: fetched.bytes,
        textLength: fetched.text.length,
        reprintMarkers: fetched.reprintMarkers,
        error: fetched.error,
        durationMs: fetched.durationMs,
      });
      ctx.evidence("source.fetch", {
        pageId: page.id,
        url: page.url,
        ok: fetched.ok,
        httpStatus: fetched.httpStatus,
        bytes: fetched.bytes,
        textLength: fetched.text.length,
        reprintMarkers: fetched.reprintMarkers,
        error: fetched.error,
        durationMs: fetched.durationMs,
      });
      if (index < targets.length - 1) await sleep(150, undefined, { signal: ctx.signal });
    }

    const search = summarizeSearch(searchConfig, attempts);
    const documents = [
      ...(input.documents || []).filter((d: any) => d.id === "case-question"),
      ...pages.map((page) => ({
        id: page.id,
        text: page.passage,
        source: page.url,
        scope: "web",
      })),
    ];
    return {
      ...input,
      search,
      searches: attempts,
      pages,
      bodies,
      bodyTexts,
      documents,
      checks: [
        ...(input.checks || []).filter((c: any) => c.name !== "联网检索"),
        {
          name: "联网检索",
          passed: search.failedQueries === 0 && search.succeededQueries > 0,
          status: search.succeededQueries > 0 ? ("passed" as const) : ("not_evaluated" as const),
          detail: `元宝搜索 ${search.succeededQueries}/${search.totalQueries} 条检索式返回网页；失败 ${search.failedQueries} 条，无结果 ${search.emptyQueries} 条，限流 ${search.rateLimitedQueries} 条；累计 ${search.totalDurationMs}ms。原文抓取 ${bodies.filter((b) => b.ok).length}/${bodies.length} 个网址成功。`,
        },
      ],
    };
  },
} satisfies CapabilityDefinition;
