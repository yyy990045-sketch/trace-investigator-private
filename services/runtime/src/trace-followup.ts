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
import { searchConfiguration, type WebPage } from "../adapters/trace/searchpro.ts";
import { traceSearch } from "./trace-search.ts";
import { assertTraceScope, assertTraceInputScope } from "../adapters/trace/scope.ts";
import { assessmentChanged, versionAssessment, TRACE_RULES_VERSION } from "../adapters/trace/assessment-version.ts";
import { publicMode, sessionOfRequest } from "./public-guard.ts";
import {
  collectEntityEvidence,
  collectLookupEvidence,
  entityQuestionParts,
  entityStatement,
  findSourcedEntityAnswer,
  findSourcedLookupAnswer,
  isEntityQuestion,
  isLookupQuestion,
  lookupStatement,
} from "./lookup-answer.ts";
import { parseClaim } from "../adapters/trace/claim-semantics.ts";
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
function computeAssessment(
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
  // 查询型问题已经拿到带来源的数值时，结论句必须把数值写出来，而不是只说「证据不足」。
  const lookupBlock = (() => {
    if (!isLookupQuestion(claim)) {
      // 实体型问句：与首次核验用同一套抽取，刷新或补查后答案不能丢。
      const parts = isEntityQuestion(claim) ? entityQuestionParts(claim) : null;
      if (!parts) return {};
      const evidence = collectEntityEvidence(pages, bodies, parts);
      if (!evidence.length) return {};
      const answer = findSourcedEntityAnswer(claim, evidence);
      return {
        answer,
        block: {
          note: answer
            ? "已找到与所问对象直接对应的原句；答案是来源自己写的，不等同于已核实的唯一答案。"
            : "找到了相关原句，但没有能直接回答这个问题的表述（或多处说法互相冲突），因此不给出答案。",
          items: evidence,
          ...(answer ? { answer } : {}),
        },
      };
    }
    const evidence = collectLookupEvidence(pages, bodies);
    if (!evidence.length) return {};
    const answer = findSourcedLookupAnswer(claim, evidence);
    return {
      answer,
      block: {
        note: "以下是从已取得材料中摘出的、与本问题相关的原始表述（含数字或日期）；它们不构成本次结论，来源与时间以页面为准。",
        items: evidence,
        ...(answer ? { answer } : {}),
      },
    };
  })() as { answer?: ReturnType<typeof findSourcedLookupAnswer> | null; block?: Record<string, unknown> };
  const aggregatedOrAnswered =
    lookupBlock.answer &&
    (lookupBlock.answer as { kind?: string }).kind === "entity" &&
    aggregated.outcome === "insufficient"
      ? {
          ...aggregated,
          outcome: "partial" as const,
          headline: "已找到来源中的对应答案，仍需人工核对。",
          reasons: [
            ...(aggregated.reasons || []).filter((reason: string) => !/改写成陈述句/.test(reason)),
            `原句给出「${(lookupBlock.answer as { value: string }).value}」，但这只是该来源的表述，不等同于已核实的唯一答案。`,
          ],
        }
      : aggregated;
  const verdict = {
    ...aggregatedOrAnswered,
    statement:
      lookupBlock.answer && aggregatedOrAnswered.outcome !== "supported" && aggregatedOrAnswered.outcome !== "contradicted"
        ? "kind" in (lookupBlock.answer as object) && (lookupBlock.answer as { kind?: string }).kind === "entity"
          ? entityStatement(lookupBlock.answer as Parameters<typeof entityStatement>[0])
          : lookupStatement(lookupBlock.answer)
        : buildStatement(claim, aggregatedOrAnswered),
  };
  const assessment = versionAssessment({
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
    // 查询型问题的「直接答案」也在这里重算：补查后、刷新后都必须还在，
    // 且与首次核验用同一个收集函数，避免两条路径给出不同数字。
    ...(lookupBlock.block ? { lookup: lookupBlock.block } : {}),
    unconfirmedPages: [...grouping.unconfirmed],
    clusterBasis: Object.fromEntries(grouping.clusterBasis),
    keySentenceSources,
  });
  return { bundle, assessment };
}

/** Exact-content cache: edits, followups, corrections and rule changes invalidate it. */
const assessmentCache = new Map<string, ReturnType<typeof computeAssessment>>();
export function buildAssessment(run: ReturnType<typeof traceRun>, option: { extra?: CorrectionRecord[]; useCorrections?: CorrectionRecord[] } = {}) {
  if (option.extra || option.useCorrections) return computeAssessment(run, option);
  const key = hash({ rules: TRACE_RULES_VERSION, bundle: baseBundle(run), followups: followupsOf(run), corrections: correctionsOf(run) });
  const hit = assessmentCache.get(key);
  if (hit) return structuredClone(hit);
  const result = computeAssessment(run, option);
  if (assessmentCache.size >= 12) assessmentCache.delete(assessmentCache.keys().next().value!);
  assessmentCache.set(key, structuredClone(result));
  return result;
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
  if (!changes.length && assessmentChanged(previous, current)) changes.push("判定规则或关键证据绑定已变化；当前判断与上一版快照不同，旧档案不改写。");
  if (!changes.length) changes.push("与上一版相比，结论和关键证据没有变化。");
  return changes;
}

const revisionLocks = new Set<string>();

/** Shared by the owner-protected HTTP route and the explicit local maintenance command. */
export async function redeliverArchive(store: Store, engine: Engine, runId: string, requestedActor: string) {
  if (revisionLocks.has(runId)) throw new ExecutionError("REVISION_BUSY", "本次调查正在生成档案，请稍后再试。");
  revisionLocks.add(runId);
  try {
    const run = traceRun(store, runId);
    if (run.status !== "completed" && run.status !== "failed")
      throw new ExecutionError("RUN_NOT_READY", "这次调查还没有稳定到可以出档案的状态。");
    const actor = requestedActor.trim() || "本机操作者";
    const revisions = revisionsOf(run);
    const previous = revisions.pop();
    if (!previous)
      throw new ExecutionError("NO_BASELINE", "这次调查还没有可参照的首版交付记录。");
    const followups = followupsOf(run);
    const corrections = correctionsOf(run);
    const pendingFollowups = followups.filter((item) => (item.requestedAt || "") > previous.at);
    const pendingCorrections = corrections.filter((item) => item.at > previous.at);
    const { bundle, assessment } = buildAssessment(run);
    if (!assessmentChanged(previous.assessment, assessment))
      throw new ExecutionError("NO_CHANGES", "当前判断与最新档案内容一致，无需生成重复版本。");
    const revision = previous.revision + 1;
    const changes = describeChanges(previous.assessment, assessment, {
      followups: pendingFollowups.length,
      corrections: pendingCorrections.length,
    });
    if (!pendingFollowups.length && !pendingCorrections.length)
      changes.unshift("按更新后的证据判定规则重新计算；维护操作不代表新增人工事实背书，旧版档案不改写。");
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
  } finally {
    revisionLocks.delete(runId);
  }
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
      assertTraceInputScope(run.input || {});
      assertTraceScope(req.body.query, run.input?.text);
      const config = searchConfiguration();
      if (!config.available)
        throw new ExecutionError(config.code || "SEARCH_NOT_CONFIGURED", config.reason);

      if (req.body.sourceOnly && !req.body.sourceUrls?.length) throw new ExecutionError("SOURCE_REQUIRED", "请提供要取得原文的公开网址。");
      const attempt = req.body.sourceOnly ? null : await traceSearch(run.id, req.body.query, { scopeContext: run.input?.text });
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
        searchExecuted: (attempt?.attempts || 0) > 0,
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

  // ── 缺口驱动的自动补查：只在「会影响答案」的缺口上再查 ────────────
  app.post<{ Params: { id: string }; Body: { max?: number } }>(
    "/v1/runs/:id/trace/auto",
    async (req) => {
      const run = traceRun(store, req.params.id);
      if (!["completed", "failed", "waiting_approval"].includes(run.status))
        throw new ExecutionError("RUN_BUSY", "调查仍在执行中，请等当前步骤结束再自动补查。");
      if (run.input?.dataConsent !== true)
        throw new ExecutionError("DATA_CONSENT_REQUIRED", "本次调查未授权外发检索，无法自动补查。");
      assertTraceInputScope(run.input || {});
      const config = searchConfiguration();
      if (!config.available)
        throw new ExecutionError(config.code || "SEARCH_NOT_CONFIGURED", config.reason);

      // 总额限制按 run 持久化，页面刷新/重复进入也不会重新花两次搜索预算。
      // 手动追加保留原行为，自动追加只在本次调查中最多占用两次。
      const previousAuto = followupsOf(run).filter((item) => typeof item.autoReason === "string").length;
      const requested = Math.max(0, Math.min(Number(req.body?.max) || 2, 2));
      const budget = Math.max(0, Math.min(requested, 2 - previousAuto));
      const executed: {
        question: string;
        query: string;
        reason: string;
        resultCount: number;
        before: string;
        after: string;
        error: unknown;
      }[] = [];
      const tried = new Set<string>([
        ...followupsOf(run).map((item) => String(item.query || "").trim()),
        ...((baseBundle(run).searches || []) as { query?: string }[]).map((item) => String(item.query || "").trim()),
      ].filter(Boolean));
      let current = buildAssessment(run).assessment;
      /** 每一轮用最新所有事实，优先解决真正缺证据的部分；不能永远只追第一条断言。 */
      const askNext = (
        snapshot: typeof current,
      ): { query: string; reason: string; question: string; factId: string | null } | null => {
        const previous = followupsOf(store.run(run.id)!).filter((item) => typeof item.autoReason === "string");
        const facts = snapshot.facts || [];
        const open = facts.filter((item) =>
          item.relation === "none" || item.relation === "mixed" || item.bodyBackedClusters === 0,
        );
        const fact = [...(open.length ? open : facts)]
          .sort((a, b) =>
            previous.filter((item) => item.factId === a.factId).length -
            previous.filter((item) => item.factId === b.factId).length,
          )[0];
        if (!fact) return null;
        const claimText = String(fact.fact || run.input?.text || "");
        const semantics = parseClaim(claimText);
        const sources = ((fact as any)?.sources || []) as any[];
        const bodies = sources.filter((item) => item.bodyAvailable).length;
        const offered = (query: string, reason: string, question: string) =>
          query.trim().length >= 3 && !tried.has(query.trim())
            ? { query: query.trim().slice(0, 120), reason, question, factId: fact.factId || null }
            : null;
        // 1) 只有摘要：先把最强来源的原文取回来（有正文才谈得上核对）
        if (sources.length && bodies === 0) {
          const top = sources.find((item) => item.url);
          const site = String(top?.site || "").slice(0, 20);
          const choice = offered(
            [claimText.slice(0, 40), site, "原文"].filter(Boolean).join(" "),
            "所有来源都只有搜索摘要，没有原文正文，无法核对原句",
            "这一步能不能拿到原文？",
          );
          if (choice) return choice;
        }
        // 2) 型号 vs 系列：说法里点了具体型号时，确认是不是把型号停产当成整个系列
        if (semantics.subject && /(?:[A-Za-z]+\s?\d+|系列)/.test(semantics.subject)) {
          const choice = offered(
            `${semantics.subject} ${semantics.predicate || "停产"} 型号 区别`,
            `说法只提到「${semantics.subject}」，需要确认其他型号/整个系列是否也一样`,
            `是「${semantics.subject}」停产，还是整个系列停产？`,
          );
          if (choice) return choice;
        }
        // 3) 因果/研究类说法：必须找到研究本身的表述，而不是新闻报道的概括
        if (semantics.nature === "causation" || /(研究|科学依据|证明)/.test(claimText)) {
          const choice = offered(
            `${claimText.slice(0, 30)} 研究 结论 因果 相关`,
            "说法是因果/研究类，现有来源可能只给了相关性",
            "研究结论到底是相关，还是因果？",
          );
          if (choice) return choice;
        }
        // 4) 条件/时间对不上：来源只支持说法里的部分条件时，下一步去核对生效时间与适用条件，
        //    而不是继续堆同类新闻（「部分限制」被放进全面限制的结论里，正是因为没核对条件）。
        const conditional = sources.find((item) =>
          /时间|生效|发布|范围|个别|局部|部分情形|有条件|例外/.test(String(item.semantic?.reason || "")),
        );
        if (conditional) {
          const year = semantics.time[0] || "";
          const choice = offered(
            [claimText.slice(0, 30), year, "生效时间 适用条件 例外"].filter(Boolean).join(" "),
            `来源只支持说法中的部分条件：${String(conditional.semantic?.reason || "").slice(0, 60)}`,
            "这条规定什么时候生效、适用条件和例外是什么？",
          );
          if (choice) return choice;
        }
        // 5) 官方原始资料缺失：只在还没有官方来源时补查
        const hasOfficial = sources.some((item) => /\.gov|gov\.cn|官方/.test(String(item.url || "") + String(item.site || "")));
        if (!hasOfficial) {
          const choice = offered(
            `${claimText.slice(0, 36)} 官方 公告 声明`,
            "现有来源里没有官方原始页面，结论只能停在媒体层面",
            "官方有没有正式说法？",
          );
          if (choice) return choice;
        }
        return null;
      };

      for (let index = 0; index < budget; index++) {
        // 用最新评估决定下一步（不再用循环外拿到的旧事实）
        current = buildAssessment(store.run(run.id)!).assessment;
        const next = askNext(current);
        if (!next) break;
        tried.add(next.query);
        const attempt = await traceSearch(run.id, next.query, { scopeContext: run.input?.text });
        const pages = (attempt.pages || []).slice(0, MAX_FOLLOWUP_PAGES);
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
        const payload = {
          query: next.query,
          factId: next.factId,
          requestedAt: attempt.requestedAt || now(),
          requestId: attempt.requestId || null,
          httpStatus: attempt.httpStatus || null,
          attempts: attempt.attempts || 0,
          durationMs: attempt.durationMs || 0,
          resultCount: attempt.resultCount || 0,
          error: attempt.error || null,
          searchExecuted: attempt.attempts > 0,
          autoReason: next.reason,
          autoQuestion: next.question,
          pages: pages.map((page) => ({
            id: page.id,
            title: page.title,
            url: page.url,
            site: page.site,
            date: page.date,
            passage: page.passage,
          })),
          bodies: bodies.map((body) => ({ url: body.url, ok: body.ok, httpStatus: body.httpStatus, error: body.error })),
          bodiesText: bodies,
        };
        recordEvidence(store, run.id, FOLLOWUP_KIND, payload);
        const after = buildAssessment(store.run(run.id)!).assessment;
        executed.push({
          question: next.question,
          query: next.query,
          reason: next.reason,
          resultCount: payload.resultCount,
          before: String((current.verdict as any)?.outcome || ""),
          after: String((after.verdict as any)?.outcome || ""),
          error: attempt.error || null,
        });
        current = after;
        if (attempt.error) break;
        // 已经拿到明确结论就没有必要继续查
        if ((after.verdict as any)?.outcome === "supported" || (after.verdict as any)?.outcome === "contradicted") break;
      }
      // 首页摘要仍从 run.evidence 的最新重算记录读取；自动补查产生新结论时
      // 同步追加重算记录，避免结果页实时结论与首页历史摘要显示成两个答案。
      if (executed.length) {
        recordEvidence(store, run.id, REASSESS_KIND, {
          reason: "autonomous_followup",
          assessment: current,
          changes: executed.map((item) =>
            `自动追查「${item.question}」，结论 ${item.before} → ${item.after}`,
          ),
          at: now(),
        });
      }
      return { executed, assessment: current, searchedQueries: [...tried] };
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
    // 唯一当前结论：每次读取都用同一套 buildAssessment 现算（包含首次核验、追加检索、
    // 人工修正与重算）。以前这里优先返回「冻结的核验快照」，导致补查后
    // /trace/auto 已给出新结论、刷新页面又回到旧结论。
    const { assessment } = buildAssessment(run);
    const verify = run.steps.find((step) => step.capabilityId === "trace.evidence.verify");
    const latest = [...run.evidence].reverse().find((item) => item.kind === REASSESS_KIND);
    const followups = followupsOf(run);
    return {
      source: "live",
      at: now(),
      assessment,
      // 保留可追溯的时间点：首次核验、最后一次重算、追加检索次数
      verifySnapshotAt: verify?.finishedAt || null,
      reassessmentAt: latest?.createdAt || null,
      followupCount: followups.length,
      correctionCount: correctionsOf(run).length,
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
      dirty: assessmentChanged(delivered?.assessment, assessment),
      readOnly: publicMode() && store.get("SELECT owner FROM runs WHERE id=?", run.id)?.owner !== sessionOfRequest(req)?.id,
      pendingFollowups,
      pendingCorrections,
      pendingReassessments,
      current: assessment,
      changes:
        delivered && assessmentChanged(delivered.assessment, assessment)
          ? describeChanges(delivered.assessment, assessment as any, {
              followups: pendingFollowups,
              corrections: pendingCorrections,
            })
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
    async (req) => redeliverArchive(store, engine, req.params.id, req.body.actor),
  );
}
