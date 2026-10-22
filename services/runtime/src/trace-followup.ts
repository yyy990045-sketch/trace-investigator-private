/**
 * TRACE 追问与重算端点。
 *
 * 为什么单独放在这里：调查是「有结论之后还要继续查」的产品，
 * 而通用引擎的执行链是一次性的线性步骤。这里只做两件引擎之外的事：
 *  1. 针对某条事实追加一次真实检索与原文抓取，写进同一个 run 的证据表；
 *  2. 把追加结果合并回原卷宗，重算判定与结论，作为新的评估记录。
 *
 * 不伪造任何执行：检索走元宝搜索适配器，原文走抓取适配器，
 * 判定走同一套规则；每次追加都写入 evidence 与 run 事件链。
 */
import type { FastifyInstance } from "fastify";
import { ExecutionError } from "./contracts.ts";
import { hash, id, now } from "./util.ts";
import type { Store } from "./store.ts";
import { searchConfiguration, searchPro } from "../adapters/trace/searchpro.ts";
import { fetchSource } from "../adapters/trace/fetch-source.ts";
import {
  aggregateCase,
  assessFact,
  clusterSources,
  openQuestions,
  summarizeClusters,
  type AnalysablePage,
} from "../adapters/trace/analyze.ts";

const FOLLOWUP_KIND = "trace.followup";
const REASSESS_KIND = "trace.reassessment";
const MAX_FOLLOWUP_PAGES = 5;
const MAX_FOLLOWUP_BODIES = 3;

function traceRun(store: Store, runId: string) {
  const run = store.run(runId);
  if (!run) throw new ExecutionError("RUN_NOT_FOUND", "调查记录不存在。");
  const isTrace = run.assembly.some((step) => String(step.capabilityId).startsWith("trace."));
  if (!isTrace) throw new ExecutionError("NOT_TRACE_RUN", "这不是一次调查记录。");
  return run;
}

function stepIdFor(store: Store, runId: string) {
  const row = store.get(
    `SELECT id FROM steps WHERE run_id=? AND capability_id IN ('trace.evidence.verify','trace.web.search','trace.case.intake') ORDER BY position LIMIT 1`,
    runId,
  );
  if (!row) throw new ExecutionError("STEP_NOT_FOUND", "调查记录缺少可挂载证据的步骤。");
  return row.id as string;
}

function recordEvidence(store: Store, runId: string, kind: string, data: unknown) {
  const stepId = stepIdFor(store, runId);
  store.exec(
    "INSERT INTO evidence VALUES(?,?,?,?,?,?,?)",
    id("evidence"),
    runId,
    stepId,
    kind,
    hash(data),
    JSON.stringify(data),
    now(),
  );
  store.event(runId, kind, { type: kind, recordedAt: now() });
}

export function registerTraceEndpoints(app: FastifyInstance, store: Store) {
  // 追加一次真实检索：结果并入同一个调查记录。
  app.post<{ Params: { id: string }; Body: { query: string; factId?: string } }>(
    "/v1/runs/:id/trace/followup",
    {
      schema: {
        body: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 2, maxLength: 120 },
            factId: { type: "string", maxLength: 40 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const run = traceRun(store, req.params.id);
      if (!["completed", "failed", "waiting_approval"].includes(run.status))
        throw new ExecutionError("RUN_BUSY", "调查仍在执行中，请等当前步骤结束再追加检索。");
      if (run.input?.dataConsent !== true)
        throw new ExecutionError("DATA_CONSENT_REQUIRED", "本次调查未授权外发检索，无法追加查询。");
      const config = searchConfiguration();
      if (!config.available)
        throw new ExecutionError(config.code || "SEARCH_NOT_CONFIGURED", config.reason);

      const attempt = await searchPro(req.body.query);
      const pages = attempt.pages.slice(0, MAX_FOLLOWUP_PAGES);
      const bodies: { pageId: string; url: string; ok: boolean; httpStatus: number | null; error: unknown; text: string; reprintMarkers: string[] }[] = [];
      for (const page of pages.slice(0, MAX_FOLLOWUP_BODIES)) {
        const fetched = await fetchSource(page.url);
        bodies.push({
          pageId: page.id,
          url: page.url,
          ok: fetched.ok,
          httpStatus: fetched.httpStatus,
          error: fetched.error,
          text: fetched.ok ? fetched.text.slice(0, 20_000) : "",
          reprintMarkers: fetched.reprintMarkers,
        });
      }
      const payload = {
        query: req.body.query,
        factId: req.body.factId || null,
        requestedAt: attempt.requestedAt,
        requestId: attempt.requestId,
        httpStatus: attempt.httpStatus,
        attempts: attempt.attempts,
        durationMs: attempt.durationMs,
        resultCount: attempt.resultCount,
        error: attempt.error,
        pages,
        bodies,
      };
      recordEvidence(store, run.id, FOLLOWUP_KIND, payload);
      return {
        query: payload.query,
        requestId: payload.requestId,
        httpStatus: payload.httpStatus,
        durationMs: payload.durationMs,
        resultCount: payload.resultCount,
        error: payload.error,
        pages: pages.map((page) => ({
          id: page.id,
          title: page.title,
          url: page.url,
          site: page.site,
          date: page.date,
          passage: page.passage,
        })),
        bodies: bodies.map((body) => ({ url: body.url, ok: body.ok, httpStatus: body.httpStatus, error: body.error })),
      };
    },
  );

  // 读取当前评估：优先最新重算结果，其次核验步骤输出。
  app.get<{ Params: { id: string } }>("/v1/runs/:id/trace/assessment", async (req) => {
    const run = traceRun(store, req.params.id);
    const latest = [...run.evidence].reverse().find((item) => item.kind === REASSESS_KIND);
    if (latest) return { source: "reassessment", at: latest.createdAt, assessment: (latest.data as any).assessment };
    const verify = run.steps.find((step) => step.capabilityId === "trace.evidence.verify");
    const assessment = (verify?.output as any)?.assessment || null;
    return { source: "verify-step", at: verify?.finishedAt || null, assessment };
  });

  // 把追加检索合并回卷宗并重算结论。
  app.post<{ Params: { id: string } }>("/v1/runs/:id/trace/reassess", async (req) => {
    const run = traceRun(store, req.params.id);
    const baseStep =
      run.steps.find((step) => step.capabilityId === "trace.evidence.verify" && step.output) ||
      run.steps.find((step) => step.capabilityId === "trace.web.search" && step.output);
    const bundle = baseStep?.output as any;
    if (!bundle?.case?.facts?.length)
      throw new ExecutionError("NO_BASELINE", "这次调查还没有可重算的检索结果。");

    const followups = run.evidence.filter((item) => item.kind === FOLLOWUP_KIND).map((item) => item.data as any);
    if (!followups.length) throw new ExecutionError("NO_FOLLOWUP", "还没有追加检索，无需重算。");

    const pageMap = new Map<string, AnalysablePage>();
    for (const page of bundle.pages || []) pageMap.set(page.id, page);
    const bodyTexts: Record<string, { ok: boolean; text: string; reprintMarkers: string[] }> = {
      ...(bundle.bodyTexts || {}),
    };
    for (const followup of followups) {
      for (const page of followup.pages || []) pageMap.set(page.id, page);
      for (const body of followup.bodies || [])
        bodyTexts[body.pageId] = { ok: body.ok, text: body.text || "", reprintMarkers: body.reprintMarkers || [] };
    }
    const pages = [...pageMap.values()];
    const clusterOf = clusterSources(pages);
    const groups = new Map<string, AnalysablePage[]>();
    for (const page of pages) {
      const key = clusterOf.get(page.id) || "cluster-0";
      groups.set(key, [...(groups.get(key) || []), page]);
    }
    const duplicatePages = new Set<string>();
    for (const [, group] of groups) {
      const ranked = [...group].sort(
        (a, b) =>
          Number(bodyTexts[b.id]?.ok === true) - Number(bodyTexts[a.id]?.ok === true) ||
          (b.score || 0) - (a.score || 0),
      );
      for (const page of ranked.slice(1)) duplicatePages.add(page.id);
    }
    const bodies = new Map(
      pages.map((page) => [
        page.id,
        {
          ok: bodyTexts[page.id]?.ok === true,
          text: bodyTexts[page.id]?.text || "",
          reprintMarkers: bodyTexts[page.id]?.reprintMarkers || [],
        },
      ]),
    );
    const assessments = (bundle.case.facts as any[]).map((fact) =>
      assessFact({ fact, pages, bodies, clusterOf, duplicatePages }),
    );
    const independentSources = new Set(
      pages.filter((page) => !duplicatePages.has(page.id)).map((page) => clusterOf.get(page.id)),
    ).size;
    const bodyAvailable = [...bodies.values()].filter((body) => body.ok).length;
    const search = bundle.search || {};
    const verdict = aggregateCase({
      facts: assessments,
      searchSummary: {
        total: (Number(search.totalQueries) || 0) + followups.length,
        failed: Number(search.failedQueries) || 0,
        empty: Number(search.emptyQueries) || 0,
      },
      pageCount: pages.length,
      bodyCount: bodyAvailable,
      independentSourceCount: independentSources,
      searchedOk: true,
    });
    const assessment = {
      facts: assessments,
      verdict,
      independentSources,
      bodyAvailable,
      clusters: summarizeClusters(
        [...new Map(assessments.flatMap((item) => item.sources).map((source) => [source.pageId, source])).values()],
        bodies,
        pages,
      ),
      openQuestions: openQuestions(assessments),
      followupCount: followups.length,
      pageCount: pages.length,
    };
    recordEvidence(store, run.id, REASSESS_KIND, { assessment, followupCount: followups.length });
    return { source: "reassessment", at: now(), assessment };
  });
}
