/**
 * trace.case.intake —— 调查立案。
 *
 * 只做三件事：
 *  1. 把用户提交的原始问题、待核查说法、人工确认的事实与检索式规范化；
 *  2. 记录「事实拆解 = 人工确认」这一事实状态（模型未配置时绝不声称 AI 已拆解）；
 *  3. 把公共 document.bundle 需要的字段先放好（原始问题作为非证据文档）。
 * 不联网、不产生任何来源。
 */
import { ExecutionError, type CapabilityDefinition } from "../src/contracts.ts";
import { searchConfiguration } from "../adapters/trace/searchpro.ts";
import {
  TRACE_VERSION,
  emptySearchStatus,
  traceBundleSchema,
  traceInputSchema,
  emptyTraceConfig,
} from "../adapters/trace/bundle.ts";
import { deriveClaims, planFactQueries } from "../src/query-plan.ts";
import { assertTraceInputScope } from "../adapters/trace/scope.ts";

const MANUAL_NOTE =
  "事实与检索式由人工确认输入（模型未配置或未启用）。系统未执行 AI 事实拆解，界面不标注为 AI 已完成拆解。";

export default {
  id: "trace.case.intake",
  version: "1.0.0",
  name: "调查立案",
  description:
    "规范化原始问题与人工确认的待核查事实、检索式；记录拆解模式与本次外发授权，不联网取证。",
  inputProtocol: "source.upload.v1",
  outputProtocol: TRACE_VERSION,
  inputSchema: traceInputSchema,
  outputSchema: traceBundleSchema,
  configSchema: emptyTraceConfig,
  defaultConfig: {},
  permissions: ["document:read"],
  effects: ["none"],
  kind: "tool",
  idempotent: true,
  assets: [],
  async execute(input: any, _config, ctx) {
    assertTraceInputScope(input);
    const payload = (input.payload || {}) as any;
    const question = String(payload.question ?? input.text ?? "").trim();
    if (question.length < 2)
      throw new ExecutionError("QUESTION_REQUIRED", "请填写需要调查的问题，至少 2 个字。");
    if (question.length > 500)
      throw new ExecutionError("QUESTION_TOO_LONG", "问题最多 500 字，请拆成更具体的说法。");

    const claim = String(payload.claim ?? "").trim() || question;
    if (claim.length > 500) throw new ExecutionError("CLAIM_TOO_LONG", "待核查说法最多 500 字。");

    const rawFacts = Array.isArray(payload.facts) ? payload.facts : [];
    if (!rawFacts.length)
      throw new ExecutionError(
        "FACTS_REQUIRED",
        "至少需要一条可核查事实。当前为人工拆解模式：请把想核查的说法写成一句可判断真假的事实，并为它填写检索式。",
      );
    if (rawFacts.length > 6) throw new ExecutionError("TOO_MANY_FACTS", "一次最多核查 6 条事实。");

    // 只提交一句问句时，先把问句改写成可核查的说法（问句几乎不可能在网页里逐字出现，
    // 直接当事实会让所有来源都被判成「无法确认」）。改写依据随案件记录一起展示。
    const originalFacts = rawFacts;
    let claimRewrite: { note: string } | null = null;
    let effectiveFacts = originalFacts;
    if (originalFacts.length === 1) {
      const single = String(originalFacts[0]?.text ?? "").trim();
      const provided = (Array.isArray(originalFacts[0]?.queries) ? originalFacts[0].queries : [])
        .map((q: unknown) => String(q ?? "").trim())
        .filter(Boolean);
      const derived = deriveClaims(single);
      if (derived.claims.length > 1 || derived.claims[0] !== single) {
        claimRewrite = { note: derived.note };
        effectiveFacts = derived.claims.map((claim, index) => ({
          id: `fact-${index + 1}`,
          text: claim,
          queries: [claim],
        }));
      } else if (provided.length) {
        effectiveFacts = [{ ...originalFacts[0] }];
      }
    }

    const seen = new Set<string>();
    const facts = effectiveFacts.map((fact: any, index: number) => {
      const text = String(fact?.text ?? "").trim();
      if (text.length < 2 || text.length > 400)
        throw new ExecutionError("FACT_INVALID", `第 ${index + 1} 条事实需要 2 到 400 字。`);
      if (seen.has(text)) throw new ExecutionError("FACT_DUPLICATE", "存在重复事实：" + text);
      seen.add(text);
      const queries = (Array.isArray(fact?.queries) ? fact.queries : [])
        .map((q: unknown) => String(q ?? "").trim())
        .filter((q: string) => q.length > 0);
      if (!queries.length) throw new ExecutionError("QUERY_REQUIRED", `第 ${index + 1} 条事实没有检索式。`);
      if (queries.some((q: string) => q.length > 120))
        throw new ExecutionError("QUERY_TOO_LONG", "单条检索式最多 120 字。");
      // 检索式太少时按规则补足（多组数值 → 每个数值单独查），
      // 让「输入一句话」也能拿到各自的出处；不改判定逻辑。
      const planned = planFactQueries(text, queries);
      return {
        id: String(fact?.id ?? "") || `fact-${index + 1}`,
        text,
        queries: planned.queries.slice(0, 6),
        queryPlan: { source: planned.source, note: planned.note },
        ...(fact?.timeScope ? { timeScope: String(fact.timeScope).slice(0, 60) } : {}),
        ...(fact?.subjectScope ? { subjectScope: String(fact.subjectScope).slice(0, 60) } : {}),
      };
    });

    // 历史经验只作为检查提示随案件带下去：命中的是历史错误的形态，不是本次事实的证据。
    const experienceMatch = (payload.experienceMatch || null) as any;
    const experienceHints = Array.isArray(experienceMatch?.hints) ? experienceMatch.hints : [];
    const config = searchConfiguration();
    const bundle = {
      filename: input.filename,
      text: question,
      modelConsent: input.modelConsent === true,
      dataConsent: input.dataConsent === true,
      traceVersion: TRACE_VERSION,
      case: {
        question,
        claim,
        facts,
        mode: "manual" as const,
        modeNote: MANUAL_NOTE,
        consent: { search: input.dataConsent === true, model: input.modelConsent === true },
        createdAt: new Date().toISOString(),
        ...(claimRewrite ? { claimRewrite } : {}),
        ...(experienceHints.length ? { experienceHints } : {}),
      },
      search: emptySearchStatus(config),
      searches: [],
      pages: [],
      bodies: [],
      documents: [
        {
          id: "case-question",
          text: question + (claim !== question ? `\n待核查说法：${claim}` : ""),
          source: "用户在本机提交的调查问题（不是外部证据）",
          scope: "case-input",
        },
      ],
      claims: facts.map((f: any) => ({ key: f.id, value: f.text, source: "case-question" })),
      checks: [
        {
          name: "事实拆解",
          passed: false,
          status: "not_evaluated" as const,
          detail: MANUAL_NOTE,
        },
        {
          name: "联网检索",
          passed: false,
          status: "not_evaluated" as const,
          detail: config.available
            ? "检索能力已配置，等待执行。"
            : `检索不可用（${config.code}）：${config.reason}`,
        },
      ],
    };
    if (experienceMatch?.detected)
      ctx.evidence("trace.experience.match", {
        detected: experienceMatch.detected,
        hints: experienceHints,
        note:
          experienceHints.length
            ? "匹配到已确认的历史调查经验，只作为检查提示；本次结论仍只依据本次真实来源。"
            : "本次说法命中了历史错误的高发形态，但没有已确认的相关经验可用。",
      });
    ctx.evidence("trace.case.opened", {
      question,
      claim,
      mode: "manual",
      facts: facts.map((f: any) => ({ id: f.id, text: f.text, queries: f.queries })),
      searchAvailable: config.available,
      searchReason: config.reason,
    });
    return bundle;
  },
} satisfies CapabilityDefinition;
