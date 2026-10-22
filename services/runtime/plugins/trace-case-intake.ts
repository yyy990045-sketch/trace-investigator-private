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

    const seen = new Set<string>();
    const facts = rawFacts.map((fact: any, index: number) => {
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
      return {
        id: String(fact?.id ?? "") || `fact-${index + 1}`,
        text,
        queries: [...new Set(queries)].slice(0, 6),
        ...(fact?.timeScope ? { timeScope: String(fact.timeScope).slice(0, 60) } : {}),
        ...(fact?.subjectScope ? { subjectScope: String(fact.subjectScope).slice(0, 60) } : {}),
      };
    });

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
