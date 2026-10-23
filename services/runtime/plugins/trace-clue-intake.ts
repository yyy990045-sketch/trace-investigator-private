/**
 * trace.clue.intake —— 线索立案。
 *
 * 用户只给一句模糊描述，这里负责：
 *  1. 让模型（不可用时用规则）把它拆成「调查目标 + 已知线索 + 初始检索式」；
 *  2. 明确记录这一轮到底会搜什么，供界面展示「系统生成了哪些检索词」；
 *  3. 只做规划，不产生任何答案、不联网、不引用任何来源。
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
import { planClueInvestigation } from "../src/clue-plan.ts";

export default {
  id: "trace.clue.intake",
  version: "1.0.0",
  name: "线索立案",
  description:
    "把用户的模糊描述拆成调查目标、已知线索与初始检索式；模型只做检索规划，不产出答案。",
  inputProtocol: "source.upload.v1",
  outputProtocol: TRACE_VERSION,
  inputSchema: traceInputSchema,
  outputSchema: traceBundleSchema,
  configSchema: emptyTraceConfig,
  defaultConfig: {},
  permissions: ["document:read", "model:invoke"],
  effects: ["none"],
  kind: "tool",
  idempotent: true,
  assets: [],
  async execute(input: any, _config, ctx) {
    const payload = (input.payload || {}) as any;
    const question = String(payload.question ?? input.text ?? "").trim();
    if (question.length < 4)
      throw new ExecutionError("QUESTION_REQUIRED", "至少用一句话说清你想找什么（4 个字以上）。");
    if (question.length > 500) throw new ExecutionError("QUESTION_TOO_LONG", "线索描述最多 500 字。");

    const consentSearch = input.dataConsent === true;
    const consentModel = input.modelConsent === true;
    const plan = consentModel
      ? await planClueInvestigation(question, ctx.signal)
      : {
          ...(await import("../src/clue-plan.ts")).planByRule(question),
          fallbackReason: "本次未授权模型参与，检索式按关键词规则拆分。",
        };
    const clues = plan.clues.map((clue, index) => ({ id: `clue-${index + 1}`, ...clue }));
    if (!clues.length) throw new ExecutionError("CLUES_REQUIRED", "没有从描述里识别出可用线索，请补充更具体的特征。");
    const queries = plan.queries.slice(0, 4);
    if (!queries.length) throw new ExecutionError("QUERY_REQUIRED", "没有生成可用检索式。");

    const config = searchConfiguration();
    const goal = plan.goal.slice(0, 200);
    const bundle = {
      filename: input.filename,
      text: question,
      modelConsent: consentModel,
      dataConsent: consentSearch,
      traceVersion: TRACE_VERSION,
      case: {
        question,
        claim: question,
        goal,
        clues,
        plan: {
          source: plan.source,
          ...(plan.model ? { model: plan.model } : {}),
          durationMs: plan.durationMs,
          ...(plan.fallbackReason ? { fallbackReason: plan.fallbackReason } : {}),
          queries,
        },
        // 一条「事实」承载调查目标与检索式，让后面的检索步骤原样复用。
        facts: [{ id: "fact-1", text: goal, queries }],
        mode: "clue" as const,
        modeNote:
          plan.source === "model"
            ? "线索与检索式由模型规划、用户在页面上可见；答案仍只来自真实检索结果。"
            : "线索与检索式按关键词规则拆分（未使用模型规划），答案仍只来自真实检索结果。",
        consent: { search: consentSearch, model: consentModel },
        createdAt: new Date().toISOString(),
      },
      search: emptySearchStatus(config),
      searches: [],
      pages: [],
      bodies: [],
      documents: [
        {
          id: "case-question",
          text: `${question}\n调查目标：${goal}`,
          source: "用户提交的线索（不是外部证据）",
          scope: "case-input",
        },
      ],
      claims: [{ key: "investigation-goal", value: goal, source: "case-question" }],
      checks: [
        {
          name: "线索识别",
          passed: true,
          status: "passed" as const,
          detail:
            plan.source === "model"
              ? `模型识别出 ${clues.length} 条线索、${queries.length} 条检索式（${plan.durationMs}ms）。`
              : `规则识别出 ${clues.length} 条线索、${queries.length} 条检索式。${plan.fallbackReason || ""}`,
        },
        {
          name: "联网检索",
          passed: false,
          status: "not_evaluated" as const,
          detail: config.available ? "元宝搜索已配置，等待执行。" : `检索不可用（${config.code}）：${config.reason}`,
        },
      ],
    };

    ctx.evidence("trace.clue.plan", {
      question,
      goal,
      clues,
      queries,
      source: plan.source,
      model: plan.model || null,
      durationMs: plan.durationMs,
      fallbackReason: plan.fallbackReason || null,
      // 模型原始输出保留给复查：里面只有规划，没有答案。
      raw: plan.raw || null,
      note: "模型只提出检索方向；它没有给出答案，也不会把猜测写进结论。",
    });
    ctx.evidence("trace.case.opened", {
      question,
      claim: question,
      mode: "clue",
      goal,
      clues: clues.map((clue) => ({ id: clue.id, text: clue.text, terms: clue.terms })),
      queries,
      searchAvailable: config.available,
      searchReason: config.reason,
    });
    return bundle;
  },
} satisfies CapabilityDefinition;
