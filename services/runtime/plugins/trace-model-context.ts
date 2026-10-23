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
        excerpt: (() => {
          const material =
            source.bodyStatus === "evidence_sentence"
              ? "key_body（已取得关键原文，正文里找到与该说法相关的原句）"
              : source.bodyStatus === "main_without_match"
                ? "body_no_match（抓到正文但没有找到涉及该说法的句子）"
                : source.bodyStatus === "boilerplate_only"
                  ? "boilerplate（正文基本是导航/样板，不能当原文）"
                  : source.bodyAvailable && source.bodyExcerpt
                    ? "excerpt_only（只有搜索摘要或正文摘录）"
                    : "excerpt_only（只有搜索摘要，未取得此段原文）";
          const provenance =
            source.originality === "original_candidate"
              ? "official_candidate（原始依据候选，出处仍待核对）"
              : source.originality === "reprint" || source.citedOrigin
                ? "reprint（转载或二次传播）"
                : "unknown（出处未判定）";
          const independence =
            source.independence === "duplicate"
              ? `duplicate（与其它来源同源：${source.duplicateOf?.basis || "内容重合"}）`
              : source.independence === "unconfirmed"
                ? "unconfirmed（有同源线索但无依据，独立性未确认）"
                : "unique（本次未检测到重复，不等于已证明独立）";
          const scope = source.scopeCompatible === false ? `范围差异：${source.scopeNote || "只覆盖局部/早期状态"}；` : "";
          return `对应事实：${source.factId}；资料类型：${material}；${provenance}；发布时间：${page.date || "未知"}；来源独立性：${independence}；${source.citedOrigin ? `引用机构：${source.citedOrigin.org}；` : ""}${scope}\n${String(excerpt).slice(0, 1000)}`;
        })(),
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
