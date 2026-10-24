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
import { nextClueSearch } from "./clue-investigation.ts";
import { renderClueReport } from "../adapters/trace/clue-report.ts";
import { guardReserveSearch } from "./public-guard.ts";
import {
  detectTargetKind,
  evaluateCandidates,
  personClueTexts,
  extractCandidates,
  extractVariants,
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
  targetKind: "screen_work" | "book" | "person" | "other" | "unknown";
  clues: ClueItem[];
  /** 用户点名的人物类线索（主演/演员） */
  personClues?: string[];
  /** 用户描述的类型与现有候选不一致 */
  typeConflict?: { userType: string; candidateType: string; candidate: string; note: string };
  /** 同名不同版本（动画/真人/不同年份），带年份、形态与原句 */
  variants?: {
    label: string;
    year: string;
    form: string;
    quote: string;
    url: string;
    site: string;
    from: "body" | "excerpt";
  }[];
  /** 同名版本与用户说法的对应说明 */
  variantNote?: string;
  candidates: Candidate[];
  relations: Candidate[];
  /** 有向关系图（谁改编自谁、谁是谁的续集/翻拍/别名） */
  graph: {
    subject: string;
    relation: string;
    object: string;
    reason: string;
    status: "confirmed" | "conflicting" | "unconfirmed";
    evidence: { quote: string; url: string; site: string; from: "body" | "excerpt" }[];
    conflicts: { quote: string; url: string; site: string; from: "body" | "excerpt" }[];
  }[];
  /** 还没查清、会影响答案的关系疑点 */
  pending: { question: string; query: string; reason: string; subject: string; object: string }[];
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
  const { candidates, relations, graph, pending, decision } = evaluateCandidates(raw, clues, pages, bodies, targetKind, String(bundle.case?.question || ""));
  // 只有「会影响答案」的关系疑点才把结论退回不确定：
  // 也就是待查关系涉及的候选，线索命中数与头名只差 1 条以内。
  const best = candidates[0];
  const influential = pending.filter((item) => {
    if (!best) return false;
    const other = candidates.find(
      (candidate) => candidate.name === item.object || candidate.name === item.subject,
    );
    if (!other || other === best) return false;
    return other.matchedClues >= best.matchedClues - 1;
  });
  const finalDecision =
    influential.length && decision.state !== "insufficient"
      ? {
          ...decision,
          state: "ambiguous" as const,
          headline: `${decision.headline}；但还有 ${influential.length} 个候选的关系没查清`,
        }
      : {
          ...decision,
          // 与答案无关的关系疑点照实列出，但不影响「找到答案」的结论。
          ...(pending.length ? { openRelations: pending.map((item) => item.question) } : {}),
        };
  // 同名不同版本（动画/真人/不同年份）：把差别列出来，让「为什么选这个版本」可核对。
  const variants = best ? extractVariants(pages, bodies, best.name) : [];
  const wantedForm = /动画/.test(String(bundle.case?.question || ""))
    ? "动画"
    : /真人/.test(String(bundle.case?.question || ""))
      ? "真人"
      : "";
  return {
    mode: "clue",
    targetKind,
    clues,
    personClues: [...personClueTexts(String(bundle.case?.question || ""), clues)],
    ...(finalDecision.typeConflict ? { typeConflict: finalDecision.typeConflict } : {}),
    variants,
    ...(variants.length && wantedForm
      ? {
          variantNote: `同一个名字有 ${variants.length} 个版本；你提到的是「${wantedForm}」，对应 ${
            variants.filter((item) => item.form.includes(wantedForm)).map((item) => item.label).join("、") || "未找到对应版本"
          }`,
        }
      : {}),
    candidates,
    relations,
    graph,
    pending,
    decision: finalDecision,
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
  // 追加检索与初始检索使用相同预算，避免自动补查绕过公网额度限制。
  guardReserveSearch(runId);
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

  /**
   * 结果导出：线索调查没有「人工确认 → 版本冻结」那条链路，
   * 但她同样需要一个能保存下来的记录。这里按当前已保存状态渲染，
   * 与页面上的结论同源（同一个 clueAssessment），不是第二套档案。
   */
  app.get<{ Params: { id: string } }>("/v1/runs/:id/report.md", async (req, reply) => {
    const { run, bundle } = clueRun(store, req.params.id);
    if (run.status !== "completed")
      throw new ExecutionError("RUN_NOT_COMPLETED", "调查还没结束，暂时没有可保存的结果。");
    const clue = clueAssessment(store, req.params.id);
    const { rounds } = clueState(store, req.params.id);
    const report = renderClueReport({
      runId: req.params.id,
      question: String(bundle.case?.question || run.input?.text || ""),
      generatedAt: now(),
      clue,
      searches: rounds
        .filter((item: any) => item.kind !== "trace.followup")
        .map((item: any) => ({ query: String(item.query || ""), resultCount: item.resultCount })),
      followups: rounds
        .filter((item: any) => item.kind === "trace.followup")
        .map((item: any) => ({ query: String(item.query || ""), reason: item.reason })),
    });
    return reply
      .header("content-type", "text/markdown; charset=utf-8")
      .header("content-disposition", `attachment; filename="${report.markdownFilename}"`)
      .header("cache-control", "no-store")
      .send(report.markdown);
  });

  app.get<{ Params: { id: string } }>("/v1/runs/:id/report.json", async (req, reply) => {
    const { run, bundle } = clueRun(store, req.params.id);
    if (run.status !== "completed")
      throw new ExecutionError("RUN_NOT_COMPLETED", "调查还没结束，暂时没有可保存的结果。");
    const clue = clueAssessment(store, req.params.id);
    const { rounds } = clueState(store, req.params.id);
    const report = renderClueReport({
      runId: req.params.id,
      question: String(bundle.case?.question || run.input?.text || ""),
      generatedAt: now(),
      clue,
      searches: rounds
        .filter((item: any) => item.kind !== "trace.followup")
        .map((item: any) => ({ query: String(item.query || ""), resultCount: item.resultCount })),
      followups: rounds
        .filter((item: any) => item.kind === "trace.followup")
        .map((item: any) => ({ query: String(item.query || ""), reason: item.reason })),
    });
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="${report.jsonFilename}"`)
      .header("cache-control", "no-store")
      .send(report.json);
  });

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

  /**
   * 主动消歧：按「待解决的关系问题」发起真实检索，用新证据补关系，然后重新判断。
   * 每次只查当前最关键的 1-2 个问题；查不到就保持未确认，不猜。
   */
  app.post<{ Params: { id: string }; Body: { max?: number } }>(
    "/v1/runs/:id/trace/clue/auto",
    async (req) => {
      const { run } = clueRun(store, req.params.id);
      if (!["completed", "failed"].includes(run.status))
        throw new ExecutionError("RUN_BUSY", "调查还在执行中，请稍后再自动补查。");
      const before = clueAssessment(store, req.params.id);
      const roundsDone = before.followupCount;
      const budget = Math.max(0, Math.min(Number(req.body?.max) || 2, 2));
      const executed: { question: string; query: string; resultCount: number; error: unknown; kind: string; stateBefore: string; stateAfter: string }[] = [];
      let current = before;
      // 每轮根据刚取得的证据重新决策，不能一开始就把两轮固定查询一次性发出去。
      for (let index = 0; index < budget && roundsDone + index < 4; index++) {
        const state = clueState(store, req.params.id);
        const attempted = [
          ...((state.bundle.searches || []) as { query?: string }[]).map((item) => String(item.query || "")),
          ...state.rounds.map((item) => String(item.query || "")),
        ];
        const next = nextClueSearch(current, attempted);
        if (!next) break;
        const round = await searchRound(store, req.params.id, next.query, next.reason, CLUE_SEARCH_KIND);
        const afterRound = clueAssessment(store, req.params.id);
        const step = store.get(
          `SELECT id FROM steps WHERE run_id=? AND capability_id IN ('trace.clue.candidates','trace.web.search','trace.clue.intake') ORDER BY position LIMIT 1`,
          req.params.id,
        );
        // 调查“为什么查、查到了什么、有没有改变结论”均保留原始执行记录。
        if (step)
          store.exec(
            "INSERT INTO evidence VALUES(?,?,?,?,?,?,?)",
            id("evidence"),
            req.params.id,
            step.id,
            "trace.clue.question",
            id("hash"),
            JSON.stringify({
              ...next,
              at: now(),
              roundQuery: round.query,
              resultCount: round.resultCount,
              error: round.error,
              stateBefore: current.decision.state,
              stateAfter: afterRound.decision.state,
              pagesBefore: current.pageCount,
              pagesAfter: afterRound.pageCount,
            }),
            now(),
          );
        executed.push({
          question: next.question,
          query: round.query,
          resultCount: round.resultCount,
          error: round.error,
          kind: next.kind,
          stateBefore: current.decision.state,
          stateAfter: afterRound.decision.state,
        });
        current = afterRound;
        if (round.error) break;
      }
      const after = clueAssessment(store, req.params.id);
      // 把「这一轮结束时的候选关系与状态」写进记录，便于事后复查这次到底确认了什么。
      const step = store.get(
        `SELECT id FROM steps WHERE run_id=? AND capability_id IN ('trace.clue.candidates','trace.web.search','trace.clue.intake') ORDER BY position LIMIT 1`,
        req.params.id,
      );
      if (step)
        store.exec(
          "INSERT INTO evidence VALUES(?,?,?,?,?,?,?)",
          id("evidence"),
          req.params.id,
          step.id,
          "trace.clue.relations",
          id("hash"),
          JSON.stringify({
            at: now(),
            targetKind: after.targetKind,
            queries: executed.map((item) => ({ question: item.question, query: item.query, resultCount: item.resultCount })),
            candidates: after.candidates.map((item) => ({
              name: item.name,
              role: item.entity?.role || "unconfirmed",
              matchedClues: item.matchedClues,
              missingClues: item.missingClues,
            })),
            graph: after.graph,
            pending: after.pending,
            state: after.decision.state,
          }),
          now(),
        );
      return {
        executed,
        before: { state: before.decision.state, candidates: before.candidates.map((c) => c.name), pending: before.pending.length },
        after: {
          state: after.decision.state,
          candidates: after.candidates.map((c) => c.name),
          pending: after.pending.length,
          graph: after.graph,
        },
        assessment: after,
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
