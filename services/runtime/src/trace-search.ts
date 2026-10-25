import { searchPro, type SearchOptions, type SearchAttempt } from "../adapters/trace/searchpro.ts";
import { assertTraceScope } from "../adapters/trace/scope.ts";
import { guardReserveSearch } from "./public-guard.ts";

/** All TRACE searches use this boundary; retries reserve their own HTTP request. */
export async function traceSearch(runId: string, query: string, options: SearchOptions & { scopeContext?: string } = {}): Promise<SearchAttempt> {
  assertTraceScope(query, options.scopeContext);
  let sent = 0;
  const started = Date.now();
  try {
    return await searchPro(query, {
      ...options,
      beforeRequest: () => {
        options.beforeRequest?.();
        guardReserveSearch(runId);
        sent++;
      },
    });
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    if (!['SEARCH_LIMIT_PER_RUN', 'SEARCH_BUDGET_EXHAUSTED'].includes(failure.code || "")) throw error;
    return {
      provider: "tencent-wsa", query, endpoint: "api.wsa.cloud.tencent.com", requestId: null,
      httpStatus: null, durationMs: Date.now() - started, attempts: sent, resultCount: 0, pages: [],
      requestedAt: new Date(started).toISOString(),
      error: { code: failure.code as "SEARCH_LIMIT_PER_RUN" | "SEARCH_BUDGET_EXHAUSTED", message: failure.message || "搜索预算已用完，保留已有证据。", retryable: false },
    };
  }
}
