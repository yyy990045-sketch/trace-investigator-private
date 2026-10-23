import { ExecutionError, bundleSchema, emptyConfig, type CapabilityDefinition } from "../src/contracts.ts";

// This step prepares evidence only. The shared model.verify performs and audits inference.
export default {
  id: "trace.model.context",
  version: "1.0.0",
  name: "准备模型复核证据",
  description: "从本次调查中选择有界原文摘录与搜索摘要，明确标注资料类型、时间和事实范围。",
  inputProtocol: "document.bundle.v1",
  outputProtocol: "document.bundle.v1",
  inputSchema: bundleSchema,
  outputSchema: bundleSchema,
  configSchema: emptyConfig,
  defaultConfig: {},
  permissions: ["document:read", "evidence:write"],
  effects: ["none"],
  kind: "tool",
  idempotent: true,
  assets: [],
  async execute(input: any, _config, ctx) {
    const pages = Array.isArray(input.pages) ? input.pages : [];
    const facts = input.case?.facts || [];
    const assessments = input.assessment?.facts || [];
    // Round-robin facts so the first fact cannot consume the entire evidence budget.
    const selected = new Map<string, any>();
    for (let index = 0; index < 18; index++) {
      for (const fact of assessments) {
        for (const relation of ["supports", "contradicts", "unclear"]) {
          const source = fact.sources?.filter((item: any) => item.relation === relation)
            .sort((a: any, b: any) => Number(b.bodyAvailable) - Number(a.bodyAvailable))[index];
          if (source && selected.size < 18) selected.set(`${fact.factId}:${source.pageId}`, { ...source, factId: fact.factId });
        }
      }
    }
    const citations = [...selected.values()].flatMap((source) => {
      const page = pages.find((item: any) => item.id === source.pageId);
      if (!page) return [];
      try { if (!["http:", "https:"].includes(new URL(page.url).protocol)) return []; }
      catch { return []; }
      const excerpt = source.bodyAvailable && source.bodyExcerpt ? source.bodyExcerpt : page.passage;
      if (!excerpt?.trim()) return [];
      return [{
        id: `${source.factId}:${page.id}`,
        documentId: page.id,
        source: page.url,
        score: Number.isFinite(source.relevance) ? source.relevance : 0,
        excerpt: `对应事实：${source.factId}；${source.bodyAvailable && source.bodyExcerpt ? "由检索链接取得的正文摘录（非全文，最终跳转地址未记录，原始出处待人工核对）" : "仅搜索摘要，未取得此段原文"}；发布时间：${page.date || "未知"}；来源独立性：${source.independence || "未知"}；${source.citedOrigin ? `引用机构：${source.citedOrigin.org}；` : ""}\n${String(excerpt).slice(0, 1000)}`,
      }];
    });
    if (!citations.length)
      throw new ExecutionError("MODEL_EVIDENCE_REQUIRED", "没有可供模型复核的真实证据摘录，请补充检索。未发起模型调用。");
    const claims = [{ key: "investigation-goal", value: `原始问题：${input.case?.question || ""}；完整待核查说法：${input.case?.claim || ""}。这是待调查目标，不能把其中前提当成事实。`, source: "case-question" }, ...facts.map((fact: any) => ({
      key: `fact:${fact.id}`,
      value: `${fact.text}${fact.timeScope ? `；适用时间：${fact.timeScope}` : ""}${fact.subjectScope ? `；主体或地区：${fact.subjectScope}` : ""}`,
      source: "case-question",
    }))];
    ctx.evidence("trace.model.context", {
      citationIds: citations.map((citation) => citation.id),
      claimIds: claims.map((claim: any) => claim.key),
      preparedAt: new Date().toISOString(),
      note: "仅准备本次证据。是否真实调用模型以model_calls和model.verify状态为准。",
    });
    return { ...input, citations, claims, case: { ...input.case,
      modeNote: "事实与检索式由人工确认，本步骤未执行AI事实拆解；后续模型步骤单独复核语义。" } };
  },
} satisfies CapabilityDefinition;
