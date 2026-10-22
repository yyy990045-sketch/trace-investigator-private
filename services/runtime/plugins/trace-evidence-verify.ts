/**
 * trace.evidence.verify —— 证据核验与保守结论。
 *
 * 这一步把「检索命中」变成「可复查的判断」：
 *  - 同源/转载聚类，避免同一内容被当成多个独立证据；
 *  - 逐条来源给出支持/反对/无法判断/无关 + 理由；
 *  - 逐条事实汇总独立来源数与原文依据数；
 *  - 只有同时满足「≥2 个独立来源」且「至少一个取得原文正文」才给出有依据支持，
 *    否则明确输出证据不足，并列出还缺什么证据。
 */
import { type CapabilityDefinition } from "../src/contracts.ts";
import {
  aggregateCase,
  assessFact,
  buildStatement,
  clusterSources,
  openQuestions,
  outcomeLabel,
  summarizeClusters,
  type AnalysablePage,
} from "../adapters/trace/analyze.ts";
import {
  TRACE_VERSION,
  publicBundleSchema,
  traceBundleSchema,
} from "../adapters/trace/bundle.ts";

const configSchema = { type: "object", additionalProperties: false };

export default {
  id: "trace.evidence.verify",
  version: "1.0.0",
  name: "证据核验与结论",
  description:
    "对检索结果做同源合并、时间与主体比对、支持/反对判定，输出带理由的保守结论；证据不足时拒绝下结论。",
  inputProtocol: TRACE_VERSION,
  outputProtocol: "document.bundle.v1",
  inputSchema: traceBundleSchema,
  outputSchema: publicBundleSchema,
  configSchema,
  defaultConfig: {},
  permissions: ["evidence:write", "document:validate"],
  effects: ["none"],
  kind: "tool",
  idempotent: true,
  assets: [],
  async execute(input: any, _config, ctx) {
    const pages = (input.pages || []) as AnalysablePage[];
    const bodyTexts = (input.bodyTexts || {}) as Record<
      string,
      { ok: boolean; text: string; reprintMarkers: string[] }
    >;
    const facts = (input.case?.facts || []) as any[];

    const clusterOf = clusterSources(pages);
    // 同一簇内只保留「有原文且得分最高」的一条为主来源，其余标记为重复，避免重复计数
    const groups = new Map<string, AnalysablePage[]>();
    for (const page of pages) {
      const key = clusterOf.get(page.id) || "cluster-0";
      groups.set(key, [...(groups.get(key) || []), page]);
    }
    const duplicatePages = new Set<string>();
    for (const [, group] of groups) {
      const ranked = [...group].sort(
        (a, b) =>
          Number(bodyTexts[b.id]?.ok === true) - Number(bodyTexts[a.id]?.ok === true) || (b.score || 0) - (a.score || 0),
      );
      for (const page of ranked.slice(1)) duplicatePages.add(page.id);
    }

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
    const assessments = facts.map((fact) =>
      assessFact({ fact, pages, bodies, clusterOf, duplicatePages }),
    );
    const independentSources = new Set(
      pages.filter((page) => !duplicatePages.has(page.id)).map((page) => clusterOf.get(page.id)),
    ).size;
    const bodyAvailable = bodies.size
      ? [...bodies.values()].filter((body) => body.ok).length
      : 0;
    const search = input.search || {};
    const verdict = aggregateCase({
      facts: assessments,
      searchSummary: {
        total: Number(search.totalQueries) || 0,
        failed: Number(search.failedQueries) || 0,
        empty: Number(search.emptyQueries) || 0,
      },
      pageCount: pages.length,
      bodyCount: bodyAvailable,
      independentSourceCount: independentSources,
      searchedOk: search.available === true && Number(search.totalQueries) > 0,
    });

    const statement = buildStatement(input.case?.claim || input.case?.question || "", verdict);
    ctx.evidence("trace.verdict", {
      outcome: verdict.outcome,
      label: outcomeLabel(verdict.outcome),
      confidence: verdict.confidence,
      counts: verdict.counts,
      reasons: verdict.reasons,
      facts: assessments.map((f) => ({
        factId: f.factId,
        relation: f.relation,
        independentClusters: f.independentClusters,
        bodyBackedClusters: f.bodyBackedClusters,
      })),
      duplicatePages: [...duplicatePages],
      independentSources,
      bodyAvailable,
    });

    const evidenceDocuments = pages.map((page) => ({
      id: page.id,
      text: page.passage,
      source: page.url,
      scope: "web",
    }));
    const claims = facts.map((fact) => {
      const assessment = assessments.find((a) => a.factId === fact.id);
      const best =
        assessment?.sources.find((s) => s.relation === "supports" && !s.duplicate) ||
        assessment?.sources.find((s) => s.relation === "contradicts" && !s.duplicate) ||
        assessment?.sources[0];
      return { key: fact.id, value: fact.text, source: best?.pageId || "case-question" };
    });
    // 同源/转载分组：让界面能直接说「这几篇其实是同一个原始出处」。
    const clusters = summarizeClusters(
      [...new Map(assessments.flatMap((item) => item.sources).map((source) => [source.pageId, source])).values()],
      bodies,
      pages,
    );
    // 还缺什么证据：证据不足时给用户可执行的下一步，而不是一句结论了事。
    const missing = openQuestions(assessments);

    return {
      ...input,
      documents: [
        ...(input.documents || []).filter((d: any) => d.id === "case-question"),
        ...evidenceDocuments,
      ],
      claims,
      assessment: {
        facts: assessments,
        verdict: { ...verdict, statement },
        independentSources,
        bodyAvailable,
        clusters,
        openQuestions: missing,
      },
      checks: [
        ...(input.checks || []).filter(
          (c: any) => !["独立来源", "原文依据", "同源转载", "结论完备性"].includes(c.name),
        ),
        {
          name: "同源转载",
          passed: true,
          detail: `检索到 ${pages.length} 条网页，按内容雷同与同站关系合并为 ${independentSources} 个独立来源簇，${duplicatePages.size} 条被判为重复来源（不计入独立证据）。`,
        },
        {
          name: "独立来源",
          passed: independentSources >= 2,
          status: independentSources >= 2 ? ("passed" as const) : ("not_evaluated" as const),
          detail:
            independentSources >= 2
              ? `存在 ${independentSources} 个相互独立的来源簇。`
              : `只有 ${independentSources} 个独立来源簇，单一来源不足以确认事实。`,
        },
        {
          name: "原文依据",
          passed: bodyAvailable > 0,
          status: bodyAvailable > 0 ? ("passed" as const) : ("not_evaluated" as const),
          detail:
            bodyAvailable > 0
              ? `${bodyAvailable} 个来源取得了原文正文，可用于复核摘要是否被截断或改写。`
              : "没有任何来源取得原文正文，本案例只有搜索摘要。",
        },
        {
          name: "结论完备性",
          passed: verdict.outcome !== "insufficient",
          status: verdict.outcome === "insufficient" ? ("not_evaluated" as const) : ("passed" as const),
          detail: `结论文本：${outcomeLabel(verdict.outcome)}。${verdict.reasons.join(" ")}`,
        },
      ],
    };
  },
} satisfies CapabilityDefinition;
