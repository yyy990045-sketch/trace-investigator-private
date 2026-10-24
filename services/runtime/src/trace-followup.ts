/**
 * TRACE 调查端点：追问、人工纠正、结论重算与版本化交付。
 *
 * 为什么放在引擎之外：通用引擎的执行链是一次性的线性步骤，而调查是
 * 「有结论之后还要继续查、还要纠正、还要出新版本」的产品。这里只做引擎之外的事：
 *  1. 追加真实检索并把结果并入同一条 run 的证据表；
 *  2. 记录人工对证据关系的纠正（不改原始搜索返回与摘录）；
 *  3. 用同一套规则重算结论（自动判断 + 人工修正），生成新的评估记录；
 *  4. 重新确认时写新版本档案，旧版本文件与旧结论原样保留。
 *
 * 不伪造任何执行：检索走元宝搜索适配器，原文走抓取适配器，判定走同一套规则。
 * 所有追加都写入 evidence 与 run 事件链，可复查。
 */
import type { FastifyInstance } from "fastify";
import { ExecutionError } from "./contracts.ts";
import { hash, id, now } from "./util.ts";
import type { Store } from "./store.ts";
import type { Engine } from "./engine.ts";
import { searchConfiguration, searchPro, type WebPage } from "../adapters/trace/searchpro.ts";
import { fetchSource } from "../adapters/trace/fetch-source.ts";
import { renderArchive } from "../adapters/trace/archive.ts";
import {
  aggregateCase,
  applyCorrections,
  assessFact,
  buildStatement,
  groupSources,
  openQuestions,
  outcomeLabel,
  summarizeClusters,
  type AnalysablePage,
  type CorrectionRecord,
} from "../adapters/trace/analyze.ts";

const FOLLOWUP_KIND = "trace.followup";
const REASSESS_KIND = "trace.reassessment";
const CORRECTION_KIND = "trace.correction";
const REVISION_KIND = "trace.revision";
const MAX_FOLLOWUP_PAGES = 5;
const MAX_FOLLOWUP_BODIES = 3;
const RELATIONS = ["supports", "contradicts", "unclear", "irrelevant"] as const;

type Relation = (typeof RELATIONS)[number];

interface RevisionRecord {
  revision: number;
  at: string;
  actor: string;
  artifacts: { id: string; filename: string; bytes: number; sha256: string }[];
  assessment: any;
  followupCount: number;
  correctionCount: number;
  changes: string[];
  derived?: boolean;
}

function traceRun(store: Store, runId: string) {
  const run = store.run(runId);
  if (!run) throw new ExecutionError("RUN_NOT_FOUND", "调查记录不存在。");
  if (!run.assembly.some((step) => String(step.capabilityId).startsWith("trace.")))
    throw new ExecutionError("NOT_TRACE_RUN", "这不是一次调查记录。");
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

function baseBundle(run: ReturnType<typeof traceRun>) {
  const step =
    run.steps.find((item) => item.capabilityId === "trace.evidence.verify" && item.output) ||
    run.steps.find((item) => item.capabilityId === "trace.web.search" && item.output);
  const bundle = step?.output as any;
  if (!bundle?.case?.facts?.length)
    throw new ExecutionError("NO_BASELINE", "这次调查还没有可重算的检索结果。");
  return bundle;
}

function followupsOf(run: ReturnType<typeof traceRun>) {
  return run.evidence.filter((item) => item.kind === FOLLOWUP_KIND).map((item) => item.data as any);
}

function correctionsOf(run: ReturnType<typeof traceRun>): (CorrectionRecord & { autoRelation?: string })[] {
  return run.evidence
    .filter((item) => item.kind === CORRECTION_KIND)
    .map((item) => item.data as CorrectionRecord & { autoRelation?: string });
}

/**
 * 合并原始检索、追问结果与人工修正，重算整份评估。
 * corrections 可覆盖：写入前试算（extra）与历史重放（useCorrections）都用这一条路径，
 * 保证「试算」「落库后」「补算影响」三处的口径完全一致。
 */
export function buildAssessment(
  run: ReturnType<typeof traceRun>,
  option: { extra?: CorrectionRecord[]; useCorrections?: CorrectionRecord[] } = {},
) {
  const bundle = baseBundle(run);
  const followups = followupsOf(run);
  const corrections = option.useCorrections ?? [...correctionsOf(run), ...(option.extra || [])];

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
  const grouping = groupSources(
    pages,
    new Map(
      pages.map((page) => [
        page.id,
        {
          ok: bodyTexts[page.id]?.ok === true,
          text: bodyTexts[page.id]?.text || "",
          reprintMarkers: bodyTexts[page.id]?.reprintMarkers || [],
        },
      ]),
    ),
  );
  const clusterOf = grouping.clusterOf;
  const duplicatePages = new Set(grouping.duplicateOf.keys());
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
    applyCorrections(assessFact({ fact, pages, bodies, clusterOf, duplicatePages, grouping }), corrections),
  );
  const independentSources = new Set(
    pages
      .filter((page) => !duplicatePages.has(page.id) && !grouping.unconfirmed.has(page.id))
      .map((page) => clusterOf.get(page.id)),
  ).size;
  const bodyAvailable = [...bodies.values()].filter((body) => body.ok).length;
  const keySentenceSources = new Set(
    assessments.flatMap((fact) => fact.sources).filter((source) => source.bodyStatus === "evidence_sentence").map((source) => source.pageId),
  ).size;
  const search = bundle.search || {};
  const claim = bundle.case?.claim || bundle.case?.question || "";
  const aggregated = aggregateCase({
    facts: assessments,
    searchSummary: {
      total: (Number(search.totalQueries) || 0) + followups.filter((item) => item.searchExecuted !== false).length,
      failed: Number(search.failedQueries) || 0,
      empty: Number(search.emptyQueries) || 0,
    },
    pageCount: pages.length,
    bodyCount: bodyAvailable,
    independentSourceCount: independentSources,
    searchedOk: true,
  });
  // 与首版档案同一句结论，避免不同版本之间结论文本不可比对。
  const verdict = { ...aggregated, statement: buildStatement(claim, aggregated) };
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
    correctionCount: corrections.length,
    pageCount: pages.length,
    corrections,
    unconfirmedPages: [...grouping.unconfirmed],
    clusterBasis: Object.fromEntries(grouping.clusterBasis),
    keySentenceSources,
  };
  return { bundle, assessment };
}

/**
 * 已交付版本：从证据表读。
 * 老记录（改版前交付、没有版本证据）用首版交付的产物合成一条，避免历史调查没有版本可看；
 * 若已存在第 2 版及以后的记录，但首版文件仍在，也补一条首版，保证版本链从 1 开始。
 */
function revisionsOf(run: ReturnType<typeof traceRun>): RevisionRecord[] {
  const stored = run.evidence
    .filter((item) => item.kind === REVISION_KIND)
    .map((item) => item.data as RevisionRecord)
    .sort((a, b) => a.revision - b.revision);
  const verify = run.steps.find((step) => step.capabilityId === "trace.evidence.verify");
  const exportStep = run.steps.find((step) => step.capabilityId === "trace.archive.export");

  if (stored.length) {
    const known = new Set(stored.flatMap((item) => item.artifacts.map((artifact) => artifact.filename)));
    const legacy = run.artifacts.filter((artifact) => !known.has(artifact.filename));
    if (stored[0].revision > 1 && legacy.length)
      return [
        {
          revision: 1,
          at: exportStep?.finishedAt || legacy[0].createdAt || run.updatedAt,
          actor: "首次交付（人工确认节点）",
          artifacts: legacy.map((artifact) => ({
            id: artifact.id,
            filename: artifact.filename,
            bytes: artifact.bytes,
            sha256: artifact.sha256,
          })),
          assessment: (verify?.output as any)?.assessment || null,
          followupCount: 0,
          correctionCount: 0,
          changes: [],
          derived: true,
        },
        ...stored,
      ];
    return stored;
  }
  if (!run.artifacts.length) return [];
  return [
    {
      revision: 1,
      at: exportStep?.finishedAt || run.updatedAt,
      actor: "首次交付（人工确认节点）",
      artifacts: run.artifacts.map((artifact) => ({
        id: artifact.id,
        filename: artifact.filename,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
      })),
      assessment: (verify?.output as any)?.assessment || null,
      followupCount: 0,
      correctionCount: 0,
      changes: [],
      derived: true,
    },
  ];
}

const RELATION_TEXT: Record<string, string> = {
  supports: "支持",
  contradicts: "反对",
  unclear: "无法确认",
  irrelevant: "无关",
  mixed: "存在争议",
  none: "无可用来源",
};

function describeChanges(previous: any, current: any, context: { followups: number; corrections: number }) {
  const changes: string[] = [];
  if (!previous) return changes;
  const before = previous.verdict?.outcome;
  const after = current.verdict?.outcome;
  if (before && after && before !== after)
    changes.push(`结论由「${outcomeLabel(before)}」变为「${outcomeLabel(after)}」。`);
  const sourceDelta = (current.independentSources || 0) - (previous.independentSources || 0);
  if (sourceDelta)
    changes.push(
      `未检测到重复的来源由 ${previous.independentSources || 0} 个变为 ${current.independentSources || 0} 个（${
        sourceDelta > 0 ? "+" : ""
      }${sourceDelta}）。`,
    );
  const bodyDelta = (current.bodyAvailable || 0) - (previous.bodyAvailable || 0);
  if (bodyDelta)
    changes.push(
      `取得原文正文的来源由 ${previous.bodyAvailable || 0} 个变为 ${current.bodyAvailable || 0} 个。`,
    );

  const beforeFacts = new Map<string, any>(
    (previous.facts || []).map((fact: any) => [fact.factId, fact]),
  );
  for (const fact of current.facts || []) {
    const old = beforeFacts.get(fact.factId);
    if (!old) continue;
    const title = String(fact.fact || "").slice(0, 24);
    if (old.relation !== fact.relation)
      changes.push(
        `事实「${title}」的判断由「${RELATION_TEXT[old.relation] || old.relation}」变为「${
          RELATION_TEXT[fact.relation] || fact.relation
        }」。`,
      );
    if ((old.independentClusters || 0) !== (fact.independentClusters || 0))
      changes.push(
        `事实「${title}」的支持来源簇由 ${old.independentClusters || 0} 个变为 ${fact.independentClusters || 0} 个。`,
      );
    const unclearDelta = (fact.unclear || 0) - (old.unclear || 0);
    if (unclearDelta)
      changes.push(
        `事实「${title}」的无法确认来源由 ${old.unclear || 0} 条变为 ${fact.unclear || 0} 条。`,
      );
    const irrelevantDelta = (fact.irrelevant || 0) - (old.irrelevant || 0);
    if (irrelevantDelta)
      changes.push(
        `事实「${title}」的无关来源由 ${old.irrelevant || 0} 条变为 ${fact.irrelevant || 0} 条。`,
      );
  }
  if (context.followups) changes.push(`首版之后新增 ${context.followups} 次追加检索（真实检索）。`);
  if (context.corrections) changes.push(`首版之后采纳 ${context.corrections} 条人工修正。`);
  if (!changes.length) changes.push("与上一版相比，结论类型与来源统计都没有变化。");
  return changes;
}

export function registerTraceEndpoints(app: FastifyInstance, store: Store, engine: Engine) {
  // ── 追加一次真实检索 ───────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { query: string; factId?: string; sourceUrls?: string[]; sourceOnly?: boolean } }>(
    "/v1/runs/:id/trace/followup",
    {
      schema: {
        body: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 2, maxLength: 120 },
            factId: { type: "string", maxLength: 40 },
            sourceUrls: { type: "array", maxItems: 2, uniqueItems: true, items: { type: "string", minLength: 8, maxLength: 2000 } },
            sourceOnly: { type: "boolean" },
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

      if (req.body.sourceOnly && !req.body.sourceUrls?.length) throw new ExecutionError("SOURCE_REQUIRED", "请提供要取得原文的公开网址。");
      const attempt = req.body.sourceOnly ? null : await searchPro(req.body.query);
      const pages = (attempt?.pages || []).slice(0, MAX_FOLLOWUP_PAGES);
      const bodies: {
        pageId: string;
        url: string;
        ok: boolean;
        httpStatus: number | null;
        error: unknown;
        text: string;
        reprintMarkers: string[];
      }[] = [];
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
      // An operator can supply original URLs alongside a real search. They are
      // recorded as supplied sources, never represented as search hits/snippets.
      const suppliedSources: { url: string; ok: boolean; httpStatus: number | null }[] = [];
      for (const url of req.body.sourceUrls || []) {
        if (!/^https?:\/\//i.test(url)) throw new ExecutionError("SOURCE_URL_INVALID", "原始来源仅支持http/https。");
        const fetched = await fetchSource(url, {timeoutMs:30000});
        const pageId = "page_" + hash(url).slice(0, 16);
        const page = {id:pageId,url,site:new URL(url).hostname,title:fetched.title || "操作者提供的原始来源",date:"",passage:"",score:0,sourceOrigin:"operator_url"} as WebPage & {sourceOrigin:string};
        if (!pages.some((item) => item.url === url)) pages.push(page);
        bodies.push({pageId,url,ok:fetched.ok,httpStatus:fetched.httpStatus,error:fetched.error,
          text:fetched.ok ? fetched.text.slice(0, 40_000) : "",reprintMarkers:fetched.reprintMarkers});
        suppliedSources.push({url,ok:fetched.ok,httpStatus:fetched.httpStatus});
      }
      const payload = {
        query: req.body.query,
        factId: req.body.factId || null,
        requestedAt: attempt?.requestedAt || now(),
        requestId: attempt?.requestId || null,
        httpStatus: attempt?.httpStatus || null,
        attempts: attempt?.attempts || 0,
        durationMs: attempt?.durationMs || 0,
        resultCount: attempt?.resultCount || 0,
        error: attempt?.error || null,
        searchExecuted: attempt !== null,
        pages,
        bodies,
        suppliedSources,
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

  // ── 人工纠正某条证据的关系 ─────────────────────────────────────
  app.post<{
    Params: { id: string };
    Body: { pageId: string; factId: string; relation: Relation; note: string; actor: string };
  }>(
    "/v1/runs/:id/trace/correction",
    {
      schema: {
        body: {
          type: "object",
          required: ["pageId", "factId", "relation", "note", "actor"],
          properties: {
            pageId: { type: "string", minLength: 1, maxLength: 60 },
            factId: { type: "string", minLength: 1, maxLength: 40 },
            relation: { enum: RELATIONS as unknown as string[] },
            note: { type: "string", minLength: 2, maxLength: 200 },
            actor: { type: "string", minLength: 1, maxLength: 80 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const run = traceRun(store, req.params.id);
      if (run.status === "running" || run.status === "queued")
        throw new ExecutionError("RUN_BUSY", "调查仍在执行中，请等当前步骤结束再修正判断。");
      const { bundle } = buildAssessment(run);
      const fact = (bundle.case.facts as any[]).find((item) => item.id === req.body.factId);
      if (!fact) throw new ExecutionError("FACT_NOT_FOUND", "这条事实不在本次调查里。");
      const pages = [
        ...((bundle.pages || []) as any[]),
        ...followupsOf(run).flatMap((item) => item.pages || []),
      ];
      if (!pages.some((page) => page.id === req.body.pageId))
        throw new ExecutionError("SOURCE_NOT_FOUND", "这条来源不在本次调查里。");
      if (!req.body.note.trim()) throw new ExecutionError("NOTE_REQUIRED", "请写一句修正原因，便于复查。");

      // 修正前后各算一次：影响是对比出来的，不是估的。
      // 先把「如果采纳这条修正」算出来，再一次性写入带影响的记录，证据行保持单条且摘要一致。
      const record = {
        pageId: req.body.pageId,
        factId: req.body.factId,
        relation: req.body.relation,
        note: req.body.note.trim(),
        actor: req.body.actor.trim() || "本机操作者",
        at: now(),
      };
      const before = buildAssessment(run).assessment;
      const after = buildAssessment(run, { extra: [record as CorrectionRecord] }).assessment;
      const factOf = (assessment: any) =>
        (assessment.facts as any[]).find((item) => item.factId === record.factId) || null;
      const sourceOf = (assessment: any) =>
        (factOf(assessment)?.sources as any[] | undefined)?.find((item) => item.pageId === record.pageId) || null;
      const impact = {
        sourceBefore: sourceOf(before)?.relation || "none",
        sourceAfter: sourceOf(after)?.relation || "none",
        factBefore: factOf(before)?.relation || "none",
        factAfter: factOf(after)?.relation || "none",
        supportsBefore: factOf(before)?.supports ?? 0,
        supportsAfter: factOf(after)?.supports ?? 0,
        clustersBefore: factOf(before)?.independentClusters ?? 0,
        clustersAfter: factOf(after)?.independentClusters ?? 0,
        verdictBefore: before.verdict?.outcome || "insufficient",
        verdictAfter: after.verdict?.outcome || "insufficient",
      };
      const recordWithImpact = { ...record, impact };
      recordEvidence(store, run.id, CORRECTION_KIND, recordWithImpact);
      return {
        correction: recordWithImpact,
        impact,
        correctionCount: correctionsOf(traceRun(store, run.id)).length,
        assessment: after,
      };
    },
  );

  // ── 读取当前评估 / 版本历史 ────────────────────────────────────
  app.get<{ Params: { id: string } }>("/v1/runs/:id/trace/assessment", async (req) => {
    const run = traceRun(store, req.params.id);
    const latest = [...run.evidence].reverse().find((item) => item.kind === REASSESS_KIND);
    if (latest)
      return { source: "reassessment", at: latest.createdAt, assessment: (latest.data as any).assessment };
    const verify = run.steps.find((step) => step.capabilityId === "trace.evidence.verify");
    return {
      source: "verify-step",
      at: verify?.finishedAt || null,
      assessment: (verify?.output as any)?.assessment || null,
    };
  });

  app.get<{ Params: { id: string } }>("/v1/runs/:id/trace/revisions", async (req) => {
    const run = traceRun(store, req.params.id);
    const revisions = revisionsOf(run);
    const delivered = revisions[revisions.length - 1] || null;
    const followups = followupsOf(run);
    const corrections = correctionsOf(run);
    const pendingFollowups = delivered
      ? followups.filter((item) => (item.requestedAt || "") > delivered.at).length
      : followups.length;
    const pendingCorrections = delivered ? corrections.filter((item) => item.at > delivered.at).length : corrections.length;
    const reassessments = run.evidence.filter((item) => item.kind === REASSESS_KIND);
    const pendingReassessments = delivered
      ? reassessments.filter((item) => item.createdAt > delivered.at).length
      : reassessments.length;
    // 调查还在进行时（核验步骤尚未产出）没有可展示的结论：
    // 明确回「尚未就绪」，而不是抛 400 让前端控制台报错。
    let assessment: ReturnType<typeof buildAssessment>["assessment"] | null = null;
    try {
      assessment = buildAssessment(run).assessment;
    } catch {
      assessment = null;
    }
    if (!assessment)
      return {
        deliveredRevision: delivered?.revision || 0,
        dirty: true,
        ready: false,
        pendingFollowups: 0,
        pendingCorrections: 0,
        pendingReassessments: 0,
        current: null,
        changes: [],
        revisions: revisions.map((item) => ({
          revision: item.revision,
          at: item.at,
          actor: item.actor,
          artifacts: item.artifacts,
          verdict: item.assessment?.verdict
            ? {
                outcome: item.assessment.verdict.outcome,
                headline: item.assessment.verdict.headline,
                counts: item.assessment.verdict.counts,
              }
            : null,
          followupCount: item.followupCount,
          correctionCount: item.correctionCount,
          changes: item.changes,
          assessment: item.assessment,
          derived: item.derived === true,
        })),
      };
    return {
      deliveredRevision: delivered?.revision || 0,
      ready: true,
      dirty: !delivered || pendingFollowups > 0 || pendingCorrections > 0 || pendingReassessments > 0,
      pendingFollowups,
      pendingCorrections,
      pendingReassessments,
      current: assessment,
      changes:
        delivered && (pendingFollowups > 0 || pendingCorrections > 0)
          ? describeChanges(delivered.assessment, assessment as any, {
              followups: pendingFollowups,
              corrections: pendingCorrections,
            })
          : delivered && pendingReassessments > 0
            ? describeChanges(delivered.assessment, assessment as any, { followups: 0, corrections: 0 })
            : [],
      revisions: revisions.map((item) => ({
        revision: item.revision,
        at: item.at,
        actor: item.actor,
        artifacts: item.artifacts,
        verdict: item.assessment?.verdict
          ? {
              outcome: item.assessment.verdict.outcome,
              headline: item.assessment.verdict.headline,
              counts: item.assessment.verdict.counts,
            }
          : null,
        followupCount: item.followupCount,
        correctionCount: item.correctionCount,
        changes: item.changes,
        assessment: item.assessment,
        derived: item.derived === true,
      })),
    };
  });

  // ── 重算结论（自动判断 + 人工修正 + 追加检索）──────────────────
  app.post<{ Params: { id: string }; Body: { force?: boolean; reason?: string } }>(
    "/v1/runs/:id/trace/reassess",
    async (req) => {
    const run = traceRun(store, req.params.id);
    const followups = followupsOf(run);
    const corrections = correctionsOf(run);
    // force：判定规则更新后对历史调查重算（例如同源识别口径变化），不需要先有追问或修正。
    if (!followups.length && !corrections.length && req.body?.force !== true)
      throw new ExecutionError("NO_FOLLOWUP", "还没有追加检索或人工修正，无需重算。");
    const { assessment } = buildAssessment(run);
    const delivered = revisionsOf(run).pop();
    const changes = delivered
      ? describeChanges(delivered.assessment, assessment, {
          followups: followups.filter((item) => (item.requestedAt || "") > delivered.at).length,
          corrections: corrections.filter((item) => item.at > delivered.at).length,
        })
      : [];
    recordEvidence(store, run.id, REASSESS_KIND, {
      assessment,
      followupCount: followups.length,
      correctionCount: corrections.length,
      changes,
      ...(req.body?.reason ? { reason: req.body.reason } : {}),
    });
    return { source: "reassessment", at: now(), assessment, changes };
    },
  );

  // ── 重新确认：把当前结论固化成新版本档案 ────────────────────────
  app.post<{ Params: { id: string }; Body: { actor: string } }>(
    "/v1/runs/:id/trace/redeliver",
    {
      schema: {
        body: {
          type: "object",
          required: ["actor"],
          properties: { actor: { type: "string", minLength: 1, maxLength: 80 } },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const run = traceRun(store, req.params.id);
      if (run.status !== "completed" && run.status !== "failed")
        throw new ExecutionError("RUN_NOT_READY", "这次调查还没有稳定到可以出档案的状态。");
      const actor = req.body.actor.trim() || "本机操作者";
      const revisions = revisionsOf(run);
      const previous = revisions.pop();
      if (!previous)
        throw new ExecutionError("NO_BASELINE", "这次调查还没有可参照的首版交付记录。");
      const followups = followupsOf(run);
      const corrections = correctionsOf(run);
      const pendingFollowups = followups.filter((item) => (item.requestedAt || "") > previous.at);
      const pendingCorrections = corrections.filter((item) => item.at > previous.at);
      const pendingReassessments = run.evidence.filter(
        (item) => item.kind === REASSESS_KIND && item.createdAt > previous.at,
      );
      if (!pendingFollowups.length && !pendingCorrections.length && !pendingReassessments.length)
        throw new ExecutionError("NO_CHANGES", "首版之后没有新的检索、修正或重算，不需要重新确认。");

      const { bundle, assessment } = buildAssessment(run);
      const revision = previous.revision + 1;
      const changes = describeChanges(previous.assessment, assessment, {
        followups: pendingFollowups.length,
        corrections: pendingCorrections.length,
      });
      if (!pendingFollowups.length && !pendingCorrections.length && pendingReassessments.length)
        changes.unshift("按更新后的证据判定规则重新计算并确认；具体原因见本次重算记录，旧版档案不改写。");
      const generatedAt = now();
      const rendered = renderArchive({
        runId: run.id,
        bundle,
        assessment,
        revision,
        generatedAt,
        actor,
        changes,
      });
      const stepId = stepIdFor(store, run.id);
      const markdown = await engine.writeArtifact(
        run.id,
        stepId,
        rendered.markdownFilename,
        rendered.markdown,
        "text/markdown; charset=utf-8",
        new AbortController().signal,
        { requireActive: false },
      );
      const json = await engine.writeArtifact(
        run.id,
        stepId,
        rendered.jsonFilename,
        rendered.json,
        "application/json; charset=utf-8",
        new AbortController().signal,
        { requireActive: false },
      );
      const record: RevisionRecord = {
        revision,
        at: generatedAt,
        actor,
        artifacts: [markdown, json].map((artifact) => ({
          id: artifact.id,
          filename: artifact.filename,
          bytes: artifact.bytes,
          sha256: artifact.sha256,
        })),
        assessment,
        followupCount: followups.length,
        correctionCount: corrections.length,
        changes,
      };
      recordEvidence(store, run.id, REVISION_KIND, record);
      return {
        revision: record.revision,
        at: record.at,
        actor: record.actor,
        artifacts: record.artifacts,
        changes,
        verdict: {
          outcome: assessment.verdict.outcome,
          headline: assessment.verdict.headline,
          counts: assessment.verdict.counts,
        },
      };
    },
  );
}
