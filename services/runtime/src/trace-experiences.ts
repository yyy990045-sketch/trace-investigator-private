/**
 * trace-experiences —— 调查纠错经验的沉淀、确认、匹配与使用记录。
 *
 * 复用现有结构，不新建知识库：
 *  - 条目仍是 experiences 表的一行（kind = trace_lesson），结构化字段存 trace_payload 列；
 *  - 使用效果存 experience_usage 表，按（经验 × 调查）唯一；
 *  - 匹配只在「本次说法 + 已确认经验」之间做规则判断，只产出检查提示，
 *    绝不产出结论，也不改写任何来源关系。
 */
import type { FastifyInstance } from "fastify";
import { ExecutionError } from "./contracts.ts";
import { id, now } from "./util.ts";
import type { Store } from "./store.ts";

export const TRACE_EXPERIENCE_KIND = "trace_lesson";
export const MATCH_EVIDENCE_KIND = "trace.experience.match";

export type TriggerKind = "date_role" | "quantity_strict" | "scope_partial";
export type ExperienceStatus = "pending" | "confirmed" | "disabled";

export const triggerLabel: Record<TriggerKind, string> = {
  date_role: "日期角色混淆（通过/公布日 vs 施行/生效日）",
  quantity_strict: "近似数字被当成严格门槛",
  scope_partial: "局部投运被当成全国建成",
};

export interface ExperienceEvidence {
  runId: string;
  url: string;
  title: string;
  relation: string;
  quote: string;
  date: string;
}

export interface ExperiencePayload {
  kind: TriggerKind;
  sourceClaim: string;
  sourceFacts: string[];
  sourceRunIds: string[];
  sourceProjectIds: string[];
  wrongJudgment: string;
  correctedJudgment: string;
  handling: string;
  limits: string;
  checkPoints: string[];
  evidence: ExperienceEvidence[];
  version: number;
  status: ExperienceStatus;
  history: { at: string; action: string; actor: string; note?: string }[];
}

export interface ExperienceHint {
  experienceId: string;
  title: string;
  kind: TriggerKind;
  kindLabel: string;
  sourceClaim: string;
  sourceRunIds: string[];
  sourceProjectIds: string[];
  wrongJudgment: string;
  correctedJudgment: string;
  handling: string;
  limits: string;
  checkPoints: string[];
  matchReasons: string[];
  evidence: ExperienceEvidence[];
  version: number;
}

const DATE_CLAIM =
  /(《[^》]{2,40}》|[\u4e00-\u9fa5]{2,20}(法|条例|规定|办法|细则))[^。！？\n]{0,40}(自|从)?\s*(19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?\s*(起)?\s*(施行|生效|实施|执行)/;
const DATE_ROLE_WORDS = /施行|生效|实施|执行|废止/;
const SCALE_NUMBER = /(超过|逾|至少|不低于|不多于|不足|以上|以下)\s*[\d.]+|[\d.]+\s*(万|亿|千|百)?\s*(辆|台|套|吨|元|人|家|座|公里|千米|%|％)/;
const SCALE_STRICT = /超过|逾|至少|不低于|达到|不足|不多于|以上|以下/;
const SCOPE_WORDS = /全国|全国范围|均已|全面建成|全面覆盖|各地|普遍|全覆盖/;
const SCOPE_ACTIONS = /建成|覆盖|投运|投入使用|投入运营|运行|推广|铺开/;

/** 判断这段文字属于哪一类历史错误的高发形态；只用来挑检查提示，不判断真假。 */
export function detectTriggerKind(text: string): { kind: TriggerKind; reasons: string[] } | null {
  const value = String(text || "");
  if (DATE_CLAIM.test(value) || (DATE_ROLE_WORDS.test(value) && /(19|20)\d{2}\s*年\s*\d{1,2}\s*月/.test(value))) {
    return {
      kind: "date_role",
      reasons: [
        "本次说法把某个具体日期和「施行/生效」绑在一起",
        "历史案例里同一个日期其实是「通过/公布」时间，两个日期被混用",
      ],
    };
  }
  if (SCALE_STRICT.test(value) && SCALE_NUMBER.test(value)) {
    return {
      kind: "quantity_strict",
      reasons: [
        "本次说法用一个数字进行比较或设门槛",
        "历史案例里「左右/约」这类近似数被当成严格门槛已经满足",
      ],
    };
  }
  if (SCOPE_WORDS.test(value) && SCOPE_ACTIONS.test(value)) {
    return {
      kind: "scope_partial",
      reasons: [
        "本次说法包含全国/全面一类范围词，并声明已经建成或覆盖",
        "历史案例里只有局部示范项目投运，却被当成全国建成",
      ],
    };
  }
  return null;
}

const numberOr = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function payloadOf(row: any): ExperiencePayload | null {
  if (!row?.trace_payload) return null;
  try {
    const parsed = JSON.parse(row.trace_payload) as ExperiencePayload;
    return parsed?.kind ? parsed : null;
  } catch {
    return null;
  }
}

export function recordOf(row: any) {
  const payload = payloadOf(row);
  const base = {
    id: row.id as string,
    title: row.title as string,
    kind: row.kind as string,
    status: (payload?.status || "confirmed") as ExperienceStatus,
    version: payload?.version || 1,
    projectId: row.project_id || null,
    projectName: row.project_name || null,
    runId: row.run_id || null,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payload,
  };
  return base;
}

/** 已确认且属于调查经验的条目（匹配只在这些条目里找）。 */
export function confirmedTraceExperiences(store: Store) {
  const rows = store.all(
    "SELECT * FROM experiences WHERE kind=? ORDER BY updated_at DESC",
    TRACE_EXPERIENCE_KIND,
  );
  return rows
    .map(recordOf)
    .filter((record) => record.payload && record.status === "confirmed");
}

/**
 * 在新调查的事实分析前做匹配。
 * 只返回检查提示：命中的是历史错误的形态，不是本次事实的证明。
 */
export function matchExperiences(
  store: Store,
  claim: string,
  facts: string[],
): { detected: { kind: TriggerKind; reasons: string[] } | null; hints: ExperienceHint[] } {
  const text = [claim, ...facts].join(" \n ");
  const detected = detectTriggerKind(text);
  if (!detected) return { detected: null, hints: [] };
  const hints: ExperienceHint[] = [];
  for (const record of confirmedTraceExperiences(store)) {
    const payload = record.payload!;
    if (payload.kind !== detected.kind) continue;
    hints.push({
      experienceId: record.id,
      title: record.title,
      kind: payload.kind,
      kindLabel: triggerLabel[payload.kind],
      sourceClaim: payload.sourceClaim,
      sourceRunIds: payload.sourceRunIds || [],
      sourceProjectIds: payload.sourceProjectIds || [],
      wrongJudgment: payload.wrongJudgment,
      correctedJudgment: payload.correctedJudgment,
      handling: payload.handling,
      limits: payload.limits,
      checkPoints: payload.checkPoints || [],
      matchReasons: detected.reasons,
      evidence: (payload.evidence || []).slice(0, 3),
      version: payload.version || 1,
    });
  }
  return { detected, hints };
}

/** 读取一次调查的实际判断与证据，作为经验来源或使用结果（只用真实记录）。 */
function assessmentOf(store: Store, runId: string) {
  const run = store.run(runId);
  if (!run) throw new ExecutionError("RUN_NOT_FOUND", "调查记录不存在。");
  const revisions = run.evidence
    .filter((item) => item.kind === "trace.revision")
    .map((item) => item.data as any)
    .sort((a, b) => numberOr(a.revision) - numberOr(b.revision));
  const opened = run.evidence.find((item) => item.kind === "trace.case.opened")?.data as any;
  const step = run.steps.find((item) => item.capabilityId === "trace.evidence.verify" && item.output);
  const stored = revisions.length
    ? revisions[revisions.length - 1].assessment
    : (step?.output as any)?.assessment;
  const claim = String(opened?.claim || (step?.output as any)?.case?.claim || "").trim();
  const facts = (opened?.facts || (step?.output as any)?.case?.facts || []).map((fact: any) => String(fact.text || ""));
  return { run, claim, facts, assessment: stored, revisions };
}

function sourcesOf(assessment: any) {
  const sources: any[] = [];
  for (const fact of assessment?.facts || [])
    for (const source of fact.sources || []) sources.push({ ...source, factId: fact.factId });
  return sources;
}

function verdictLine(assessment: any) {
  const verdict = assessment?.verdict || {};
  const counts = verdict.counts || {};
  const label =
    verdict.outcome === "supported"
      ? "有依据支持"
      : verdict.outcome === "contradicted"
        ? "存在反证"
        : verdict.outcome === "disputed"
          ? "证据冲突"
          : verdict.outcome === "insufficient"
            ? "证据不足"
            : String(verdict.outcome || "未知结论");
  return `${label}（来源簇 ${numberOr(counts.independentSources)}、支持 ${numberOr((assessment?.facts || []).reduce((sum: number, f: any) => sum + numberOr(f.supports), 0))}、反证 ${numberOr((assessment?.facts || []).reduce((sum: number, f: any) => sum + numberOr(f.contradicts), 0))}）`;
}

function evidenceOf(runId: string, assessment: any, limit = 3): ExperienceEvidence[] {
  const sources = sourcesOf(assessment);
  const rank = (source: any) =>
    (source.relation === "contradicts" ? 0 : source.relation === "supports" ? 1 : 2) +
    (source.bodyStatus === "evidence_sentence" ? 0 : 0.5);
  return sources
    .filter((source) => (source.keySentence || source.bodyExcerpt || source.excerpt || "").trim())
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, limit)
    .map((source) => ({
      runId,
      url: String(source.url || ""),
      title: String(source.title || ""),
      relation: String(source.relation || ""),
      quote: String(source.keySentence || source.bodyExcerpt || source.excerpt || "").slice(0, 220),
      date: String(source.date || ""),
    }));
}

export function registerTraceExperienceEndpoints(app: FastifyInstance, store: Store) {
  app.get<{ Querystring: { status?: string } }>("/v1/trace/experiences", async (req) => {
    const rows = store.all(
      "SELECT * FROM experiences WHERE kind=? ORDER BY updated_at DESC",
      TRACE_EXPERIENCE_KIND,
    );
    const records = rows.map(recordOf);
    const filtered = req.query.status
      ? records.filter((record) => record.status === req.query.status)
      : records;
    return {
      total: records.length,
      byStatus: {
        pending: records.filter((record) => record.status === "pending").length,
        confirmed: records.filter((record) => record.status === "confirmed").length,
        disabled: records.filter((record) => record.status === "disabled").length,
      },
      experiences: filtered,
    };
  });

  /** 从真实调查记录里沉淀一条经验：字段由记录自动带出，人只补处理方式与边界。 */
  app.post<{
    Body: {
      runIds: string[];
      kind: TriggerKind;
      title: string;
      handling: string;
      limits: string;
      checkPoints?: string[];
      actor: string;
    };
  }>("/v1/trace/experiences/extract", async (req, reply) => {
    reply.code(201);
    const body = req.body || ({} as any);
    const runIds = Array.isArray(body.runIds) ? body.runIds.filter(Boolean) : [];
    if (!runIds.length) throw new ExecutionError("RUNS_REQUIRED", "需要至少一次真实调查作为经验来源。");
    if (!["date_role", "quantity_strict", "scope_partial"].includes(String(body.kind)))
      throw new ExecutionError("KIND_INVALID", "经验类型必须是已登记的触发条件之一。");
    const actor = String(body.actor || "").trim();
    if (!actor) throw new ExecutionError("ACTOR_REQUIRED", "请填写确认人。");
    if (String(body.handling || "").trim().length < 4)
      throw new ExecutionError("HANDLING_REQUIRED", "请写清正确处理方式（至少 4 个字）。");
    if (String(body.limits || "").trim().length < 4)
      throw new ExecutionError("LIMITS_REQUIRED", "请写清适用范围与限制（至少 4 个字）。");

    const loaded = runIds.map((runId) => assessmentOf(store, runId));
    const first = loaded[0];
    const last = loaded[loaded.length - 1];
    // 同一份调查里的人工修正也能构成「before → after」，用真实修正记录表达。
    const corrections = last.run.evidence
      .filter((item) => item.kind === "trace.correction")
      .map((item) => item.data as any);
    const wrongJudgment = corrections.length
      ? `系统自动判断：${corrections
          .map((item: any) => `来源 ${String(item.pageId)} 判为「${String(item.impact?.sourceBefore || "supports")}」`)
          .join("；")}；整案结论 ${String(corrections[0]?.impact?.verdictBefore || "未知")}。`
      : `${verdictLine(first.assessment)}。${String(first.assessment?.verdict?.statement || "").slice(0, 160)}`;
    const correctedJudgment = corrections.length
      ? `人工修正后：${corrections
          .map((item: any) => `该来源改为「${String(item.relation)}」，理由：${String(item.note || "未填")}`)
          .join("；")}。`
      : `${verdictLine(last.assessment)}。${String(last.assessment?.verdict?.statement || "").slice(0, 160)}`;
    // 证据优先取反证，其次支持，保证既有「说对了什么」也有「哪里相反」。
    const relationRank = (relation: string) =>
      relation === "contradicts" ? 0 : relation === "supports" ? 1 : 2;
    // 同一个网址在旧判断里可能是「支持」、在现行判断里是「反证」，先去重排序再取，
    // 保证最终留下的关系与最新一次判断一致。
    const evidence = [...evidenceOf(first.run.id, first.assessment), ...evidenceOf(last.run.id, last.assessment)]
      .sort((a, b) => relationRank(a.relation) - relationRank(b.relation))
      .filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index)
      .slice(0, 3);

    const payload: ExperiencePayload = {
      kind: body.kind,
      sourceClaim: last.claim || first.claim,
      sourceFacts: last.facts.slice(0, 4),
      sourceRunIds: loaded.map((item) => item.run.id),
      sourceProjectIds: [...new Set(loaded.map((item) => item.run.projectId))],
      wrongJudgment,
      correctedJudgment,
      handling: String(body.handling).trim(),
      limits: String(body.limits).trim(),
      checkPoints: (Array.isArray(body.checkPoints) ? body.checkPoints : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 6),
      evidence,
      version: 1,
      status: "pending",
      history: [{ at: now(), action: "created", actor, note: "从真实调查记录生成，待人工确认后进入可复用集合。" }],
    };
    const experienceId = id("experience");
    const at = now();
    store.exec(
      "INSERT INTO experiences(id,title,kind,problem,resolution,project_id,project_name,run_id,capabilities,tags,source_feedback_id,verified_run_id,verified_project_name,verified_at,author,created_at,updated_at,trace_payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      experienceId,
      String(body.title || triggerLabel[body.kind]).slice(0, 120),
      TRACE_EXPERIENCE_KIND,
      payload.wrongJudgment,
      payload.handling,
      last.run.projectId,
      last.run.projectName,
      last.run.id,
      JSON.stringify(["trace.evidence.verify", "trace.model.context"]),
      JSON.stringify([payload.kind, "调查经验"]),
      null,
      null,
      null,
      null,
      actor,
      at,
      at,
      JSON.stringify(payload),
    );
    return { experience: recordOf(store.get("SELECT * FROM experiences WHERE id=?", experienceId)) };
  });

  /** 确认 / 停用 / 恢复：状态变化写进经验历史，不删除旧记录。 */
  app.post<{
    Params: { id: string };
    Body: { action: "confirm" | "disable" | "restore"; actor: string; note?: string };
  }>("/v1/trace/experiences/:id/status", async (req) => {
    const row = store.get("SELECT * FROM experiences WHERE id=?", req.params.id);
    if (!row) throw new ExecutionError("EXPERIENCE_NOT_FOUND", "经验不存在。");
    const payload = payloadOf(row);
    if (!payload) throw new ExecutionError("NOT_TRACE_EXPERIENCE", "这条经验不是调查经验。");
    const actor = String(req.body?.actor || "").trim();
    if (!actor) throw new ExecutionError("ACTOR_REQUIRED", "请填写操作人。");
    const action = String(req.body?.action || "");
    if (!["confirm", "disable", "restore"].includes(action))
      throw new ExecutionError("ACTION_INVALID", "只支持确认、停用和恢复。");
    const note = String(req.body?.note || "").trim();
    if (action === "disable" && note.length < 2)
      throw new ExecutionError("NOTE_REQUIRED", "停用经验需要写明原因，便于以后复查。");
    const next: ExperienceStatus = action === "disable" ? "disabled" : "confirmed";
    const nextPayload: ExperiencePayload = {
      ...payload,
      status: next,
      version: action === "confirm" && payload.status === "pending" ? payload.version : payload.version + 1,
      history: [
        ...(payload.history || []),
        { at: now(), action: action === "confirm" ? "confirmed" : action === "disable" ? "disabled" : "restored", actor, ...(note ? { note } : {}) },
      ],
    };
    store.exec(
      "UPDATE experiences SET trace_payload=?,updated_at=? WHERE id=?",
      JSON.stringify(nextPayload),
      now(),
      req.params.id,
    );
    return { experience: recordOf(store.get("SELECT * FROM experiences WHERE id=?", req.params.id)) };
  });

  /** 这次调查匹配到了哪些经验、用户怎么处理、经验是否真的起了作用。 */
  app.get<{ Params: { id: string } }>("/v1/runs/:id/trace/experiences", async (req) => {
    const run = store.run(req.params.id);
    if (!run) throw new ExecutionError("RUN_NOT_FOUND", "调查记录不存在。");
    const match = run.evidence.find((item) => item.kind === MATCH_EVIDENCE_KIND)?.data as any;
    const usage = store.all(
      "SELECT * FROM experience_usage WHERE run_id=? ORDER BY updated_at DESC",
      req.params.id,
    );
    return {
      hints: Array.isArray(match?.hints) ? match.hints : [],
      detected: match?.detected || null,
      usage: usage.map((row) => ({
        experienceId: row.experience_id as string,
        matched: row.matched === 1,
        shown: row.shown === 1,
        decision: row.decision as string | null,
        actualJudgment: row.actual_judgment as string | null,
        correctionHappened: row.correction_happened === 1,
        helped: row.helped as string,
        note: row.note as string | null,
        updatedAt: row.updated_at as string,
      })),
    };
  });

  app.post<{
    Params: { id: string };
    Body: {
      experienceId: string;
      decision: "accepted" | "ignored";
      shown?: boolean;
      note?: string;
    };
  }>("/v1/runs/:id/trace/experiences/usage", async (req) => {
    const run = store.run(req.params.id);
    if (!run) throw new ExecutionError("RUN_NOT_FOUND", "调查记录不存在。");
    const row = store.get("SELECT * FROM experiences WHERE id=?", req.body?.experienceId || "");
    if (!row) throw new ExecutionError("EXPERIENCE_NOT_FOUND", "经验不存在。");
    const decision = String(req.body?.decision || "");
    if (!["accepted", "ignored"].includes(decision))
      throw new ExecutionError("DECISION_INVALID", "只记录采纳或忽略。");
    const assessment = assessmentOf(store, req.params.id).assessment;
    const actualJudgment = String(assessment?.verdict?.outcome || "");
    const corrections = run.evidence.filter((item) => item.kind === "trace.correction").length;
    const at = now();
    const note = String(req.body?.note || "").trim();
    store.exec(
      `INSERT INTO experience_usage(id,experience_id,run_id,project_id,matched,shown,decision,actual_judgment,correction_happened,helped,note,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(experience_id,run_id) DO UPDATE SET shown=excluded.shown,decision=excluded.decision,actual_judgment=excluded.actual_judgment,correction_happened=excluded.correction_happened,note=excluded.note,updated_at=excluded.updated_at`,
      id("usage"),
      row.id,
      run.id,
      run.projectId,
      1,
      req.body?.shown === false ? 0 : 1,
      decision,
      actualJudgment,
      corrections > 0 ? 1 : 0,
      "unknown",
      note || "经验是否改善了结果无法证明，记为未知。",
      at,
      at,
    );
    return { ok: true };
  });

  /** 新调查立案前调用：把已确认经验匹配成检查提示。 */
  app.post<{ Body: { claim: string; facts?: string[] | { text: string }[] } }>(
    "/v1/trace/experiences/match",
    async (req) => {
      const facts = (Array.isArray(req.body?.facts) ? req.body.facts : []).map((fact: any) =>
        typeof fact === "string" ? fact : String(fact?.text || ""),
      );
      const { detected, hints } = matchExperiences(store, String(req.body?.claim || ""), facts);
      return { detected, hints };
    },
  );
}

/** 供 run 创建时使用：只返回注入上下文需要的最小字段。 */
export function hintForContext(hint: ExperienceHint) {
  return {
    experienceId: hint.experienceId,
    kind: hint.kind,
    kindLabel: hint.kindLabel,
    sourceClaim: hint.sourceClaim,
    wrongJudgment: hint.wrongJudgment,
    checkPoints: hint.checkPoints,
    limits: hint.limits,
    matchReasons: hint.matchReasons,
  };
}
