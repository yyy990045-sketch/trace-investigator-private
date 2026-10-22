/**
 * trace.facts.confirm —— 事实与检索式确认（人工编辑后的最后一道闸门）。
 *
 * 作用：
 *  - 校验每条事实都有可用检索式，合并重复检索式；
 *  - 控制检索预算（总检索式数量上限），超限时按事实顺序截断并明确记录；
 *  - 明确写入「人工确认」状态与检索配置快照，供界面展示真实状态。
 * 不联网、不改写事实文本。
 */
import { ExecutionError, emptyConfig, type CapabilityDefinition } from "../src/contracts.ts";
import { searchConfiguration } from "../adapters/trace/searchpro.ts";
import { TRACE_VERSION, emptySearchStatus, traceBundleSchema } from "../adapters/trace/bundle.ts";

const MAX_TOTAL_QUERIES = 12;

export default {
  id: "trace.facts.confirm",
  version: "1.0.0",
  name: "事实与检索式确认",
  description:
    "校验并合并人工确认的待核查事实与检索式，冻结本次检索预算与检索服务配置快照。",
  inputProtocol: TRACE_VERSION,
  outputProtocol: TRACE_VERSION,
  inputSchema: traceBundleSchema,
  outputSchema: traceBundleSchema,
  configSchema: emptyConfig,
  defaultConfig: {},
  permissions: ["document:validate"],
  effects: ["none"],
  kind: "tool",
  idempotent: true,
  assets: [],
  async execute(input: any, _config, ctx) {
    const facts = (input.case?.facts || []) as { id: string; text: string; queries: string[] }[];
    if (!facts.length) throw new ExecutionError("FACTS_REQUIRED", "至少需要一条待核查事实。");

    const used = new Set<string>();
    let budget = MAX_TOTAL_QUERIES;
    const trimmed: string[] = [];
    const confirmed = facts.map((fact) => {
      const queries = fact.queries
        .map((q) => q.trim())
        .filter((q) => q.length > 0 && !used.has(q));
      for (const q of queries) used.add(q);
      const allowed = queries.slice(0, Math.max(0, budget));
      budget -= allowed.length;
      if (allowed.length < queries.length) trimmed.push(fact.id);
      if (!allowed.length && queries.length)
        throw new ExecutionError(
          "QUERY_BUDGET_EXHAUSTED",
          `本次检索预算（${MAX_TOTAL_QUERIES} 条检索式）已用完，事实「${fact.text}」没有可用检索式。请减少事实数量。`,
        );
      if (!allowed.length)
        throw new ExecutionError("QUERY_REQUIRED", `事实「${fact.text}」没有可用检索式。`);
      return { ...fact, queries: allowed };
    });

    const config = searchConfiguration();
    ctx.evidence("trace.facts.confirmed", {
      mode: "manual",
      facts: confirmed.map((f) => ({ id: f.id, text: f.text, queries: f.queries })),
      totalQueries: confirmed.reduce((n, f) => n + f.queries.length, 0),
      trimmedFacts: trimmed,
      search: { available: config.available, code: config.code || null, reason: config.reason },
    });

    return {
      ...input,
      case: {
        ...input.case,
        facts: confirmed,
      },
      search: emptySearchStatus(config),
      checks: [
        ...(input.checks || []).filter((c: { name: string }) => c.name !== "事实拆解"),
        {
          name: "事实拆解",
          passed: true,
          status: "passed" as const,
          detail: `人工确认 ${confirmed.length} 条事实、${confirmed.reduce((n, f) => n + f.queries.length, 0)} 条检索式${
            trimmed.length ? `（受检索预算限制，${trimmed.length} 条事实被截断部分检索式）` : ""
          }。未使用 AI 拆解。`,
        },
      ],
    };
  },
} satisfies CapabilityDefinition;
