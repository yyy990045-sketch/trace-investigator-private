/**
 * 线索调查的运行期支持：追加检索、补充线索、以及对整条线索的重新比对。
 *
 * 这里只碰线索调查（case.mode === "clue"）：
 *  - 继续追查：用真实元宝搜索再查一轮，把新网页并进同一条调查；
 *  - 补充线索：把用户回答记成一条线索，并围绕当前最接近的候选再查一次；
 *  - 重新比对：把全部网页与全部线索重新跑一遍候选判断（结论会随证据变化）。
 */
import type { FastifyInstance } from "fastify";
import { ExecutionError } from "./contracts.ts";
import { id, now } from "./util.ts";
import type { Store } from "./store.ts";
import { searchConfiguration, searchPro, type WebPage } from "../adapters/trace/searchpro.ts";
import { fetchSource } from "../adapters/trace/fetch-source.ts";
import {
  detectTargetKind,
  evaluateCandidates,
  extractCandidates,
  type BodyLike,
  type Candidate,
  type ClueItem,
  type ClueDecision,
  type PageLike,
} from "../adapters/trace/clues.ts";

const CLUE_SEARCH_KIND = "trace.clue.search";
const CLUE_ANSWER_KIND = "trace.clue.answer";

export interface ClueAssessment {
  mode: "clue";
  targetKind: "screen_work" | "book" | "person" | "unknown";
  clues: ClueItem[];
  candidates: Candidate[];
  relations: Candidate[];
  decision: ClueDecision;
  pageCount: number;
  bodyAvailable: number;
  followupCount: number;
  answerCount: number;
}

function clueRun(store: Store, runId: string) {
  const run = store.run(runId);
  if (!run) throw new ExecutionError("RUN_NOT_FOUND", "调查记录不存在。");
  // 取最后一个带案件线索的步骤输出：候选发现步骤里的 pages 已经是「检索 + 原文」的合并结果。
  const bundle = ([...run.steps]
    .sort((a, b) => Number(a.position) - Number(b.position))
    .filter((step) => step.output && (step.output as any)?.case?.clues?.length)
    .pop()?.output || null) as any;
  if (!bundle?.case?.clues?.length) throw new ExecutionError("NOT_CLUE_RUN", "这不是一次线索调查。");
  return { run, bundle };
}

/** 把初始检索、追加检索与补充线索合并成当前的线索与网页集合。 */
export function clueState(store: Store, runId: string) {
  const { run, bundle } = clueRun(store, runId);
  const pages = new Map<string, PageLike>();
  const bodies = new Map<string, BodyLike>();
  for (const page of bundle.pages || []) pages.set(page.id, page as PageLike);
  for (const [pageId, body] of Object.entries((bundle.bodyTexts || {}) as Record<string, any>))
    bodies.set(pageId, { ok: body?.ok === true, text: String(body?.text || "") });

  const rounds: any[] = [];
  for (const item of run.evidence) {
    if (item.kind !== CLUE_SEARCH_KIND && item.kind !== "trace.followup") continue;
    rounds.push(item.data);
    for (const page of (item.data as any).pages || []) pages.set(page.id, page as PageLike);
    for (const body of (item.data as any).bodies || [])
      bodies.set(body.pageId, { ok: body.ok === true, text: String(body.text || "") });
  }

  const answers = run.evidence.filter((item) => item.kind === CLUE_ANSWER_KIND).map((item) => item.data as any);
  const baseClues = (bundle.case.clues as ClueItem[]).filter((clue) => clue?.text);
  const extraClues: ClueItem[] = answers.map((answer, index) => ({
    id: `clue-user-${index + 1}`,
    text: String(answer.text || ""),
    terms: [String(answer.text || "")].filter((term) => term.length >= 2),
    kind: "other" as const,
    addedByUser: true,
  })).filter((clue) => clue.terms.length);
  const clues = [...baseClues, ...extraClues];
  return { run, bundle, pages: [...pages.values()], bodies, clues, answers, rounds };
}

export function clueAssessment(store: Store, runId: string): ClueAssessment {
  const { bundle, pages, bodies, clues, rounds, answers } = clueState(store, runId);
  const raw = extractCandidates(pages, bodies, [...new Set(clues.flatMap((clue) => clue.terms || []))]);
  const targetKind = detectTargetKind(String(bundle.case?.question || bundle.case?.goal || ""));
  const { candidates, relations, decision } = evaluateCandidates(raw, clues, pages, bodies, targetKind);
  return {
    mode: "clue",
    targetKind,
    clues,
    candidates,
    relations,
    decision,
    pageCount: pages.length,
    bodyAvailable: [...bodies.values()].filter((body) => body.ok).length,
    followupCount: rounds.length,
    answerCount: answers.length,
  };
}

async function searchRound(store: Store, runId: string, query: string, reason: string, kind: string) {
  const run = store.run(runId)!;
  if (run.input?.dataConsent !== true)
    throw new ExecutionError("DATA_CONSENT_REQUIRED", "本次调查未授权外发检索。");
  const config = searchConfiguration();
  if (!config.available) throw new ExecutionError(config.code || "SEARCH_NOT_CONFIGURED", config.reason);
  const attempt = await searchPro(query);
  const pages = (attempt.pages || []).slice(0, 5);
  const bodies: any[] = [];
  for (const page of pages.slice(0, 3)) {
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
  const step = store.get(
    `SELECT id FROM steps WHERE run_id=? AND capability_id IN ('trace.clue.candidates','trace.web.search','trace.clue.intake') ORDER BY position LIMIT 1`,
    runId,
  );
  if (!step) throw new ExecutionError("STEP_NOT_FOUND", "调查记录缺少可挂载证据的步骤。");
  const data = {
    query,
    reason,
    requestedAt: attempt.requestedAt,
    requestId: attempt.requestId,
    httpStatus: attempt.httpStatus,
    attempts: attempt.attempts,
    durationMs: attempt.durationMs,
    resultCount: attempt.resultCount,
    error: attempt.error,
    pages: pages as WebPage[],
    bodies,
  };
  store.exec(
    "INSERT INTO evidence VALUES(?,?,?,?,?,?,?)",
    id("evidence"),
    runId,
    step.id,
    kind,
    id("hash"),
    JSON.stringify(data),
    now(),
  );
  store.event(runId, kind, { type: kind, query, at: now() });
  return data;
}

export function registerClueEndpoints(app: FastifyInstance, store: Store) {
  app.get<{ Params: { id: string } }>("/v1/runs/:id/trace/clue", async (req) =>
    clueAssessment(store, req.params.id),
  );

  /** 继续追查：用真实搜索再查一轮，然后重新比对候选。 */
  app.post<{ Params: { id: string }; Body: { query: string; reason?: string } }>(
    "/v1/runs/:id/trace/clue/search",
    {
      schema: {
        body: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 2, maxLength: 120 },
            reason: { type: "string", maxLength: 200 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const { run } = clueRun(store, req.params.id);
      if (!["completed", "failed"].includes(run.status))
        throw new ExecutionError("RUN_BUSY", "调查还在执行中，请稍后再追查。");
      const round = await searchRound(store, req.params.id, req.body.query, req.body.reason || "", CLUE_SEARCH_KIND);
      return {
        round: {
          query: round.query,
          requestId: round.requestId,
          httpStatus: round.httpStatus,
          durationMs: round.durationMs,
          resultCount: round.resultCount,
          error: round.error,
        },
        assessment: clueAssessment(store, req.params.id),
      };
    },
  );

  /** 补充线索：记下用户回答，并围绕当前最接近的候选再查一次。 */
  app.post<{ Params: { id: string }; Body: { text: string; actor?: string } }>(
    "/v1/runs/:id/trace/clue/answer",
    {
      schema: {
        body: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string", minLength: 2, maxLength: 120 },
            actor: { type: "string", maxLength: 80 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const { run } = clueRun(store, req.params.id);
      if (!["completed", "failed"].includes(run.status))
        throw new ExecutionError("RUN_BUSY", "调查还在执行中，请稍后再补充线索。");
      const before = clueAssessment(store, req.params.id);
      const top = before.candidates[0]?.name;
      const step = store.get(
        `SELECT id FROM steps WHERE run_id=? AND capability_id IN ('trace.clue.candidates','trace.web.search','trace.clue.intake') ORDER BY position LIMIT 1`,
        req.params.id,
      );
      if (step) {
        store.exec(
          "INSERT INTO evidence VALUES(?,?,?,?,?,?,?)",
          id("evidence"),
          req.params.id,
          step.id,
          CLUE_ANSWER_KIND,
          id("hash"),
          JSON.stringify({ text: req.body.text, actor: req.body.actor || "本机操作者", at: now(), relatedCandidate: top || null }),
          now(),
        );
        store.event(req.params.id, CLUE_ANSWER_KIND, { type: CLUE_ANSWER_KIND, text: req.body.text });
      }
      const query = [top, req.body.text].filter(Boolean).join(" ").slice(0, 120);
      const round = await searchRound(store, req.params.id, query, "根据你补充的线索继续追查", CLUE_SEARCH_KIND);
      return {
        answer: { text: req.body.text, relatedCandidate: top || null },
        round: { query: round.query, resultCount: round.resultCount, error: round.error },
        assessment: clueAssessment(store, req.params.id),
      };
    },
  );
}
