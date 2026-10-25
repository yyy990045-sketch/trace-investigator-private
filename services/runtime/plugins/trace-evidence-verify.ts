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
import { versionAssessment } from "../adapters/trace/assessment-version.ts";
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
} from "../src/lookup-answer.ts";
import {
  aggregateCase,
  assessFact,
  buildStatement,
  groupSources,
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

    // 同源判定只依据可指认的证据（同网址/同文章编号/同标题同日/正文高度重合），
    // 相似但证据不足的页面留作「独立性未确认」，不并簇也不计入独立证据。
    const grouping = groupSources(pages, new Map(
      pages.map((page) => [
        page.id,
        {
          ok: bodyTexts[page.id]?.ok === true,
          text: bodyTexts[page.id]?.text || "",
          reprintMarkers: bodyTexts[page.id]?.reprintMarkers || [],
        },
      ]),
    ));
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
    const assessments = facts.map((fact) =>
      assessFact({ fact, pages, bodies, clusterOf, duplicatePages, grouping }),
    );
    // 兼容契约字段 independentSources：这里只计未检测到重复且无待确认线索的簇，并未证明独立。
    const independentSources = new Set(
      pages
        .filter((page) => !duplicatePages.has(page.id) && !grouping.unconfirmed.has(page.id))
        .map((page) => clusterOf.get(page.id)),
    ).size;
    const bodyAvailable = bodies.size
      ? [...bodies.values()].filter((body) => body.ok).length
      : 0;
    // 只有正文里真的找到对应表述的，才算"取得关键原文"
    const keySentenceSources = new Set(
      assessments.flatMap((fact) => fact.sources).filter((source) => source.bodyStatus === "evidence_sentence").map((source) => source.pageId),
    ).size;
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
        unconfirmedSources: f.unconfirmedSources || 0,
        unconfirmedClusters: f.unconfirmedClusters || 0,
      })),
      duplicatePages: [...duplicatePages],
      unconfirmedPages: [...grouping.unconfirmed],
      keySentenceSources,
      clusterBasis: Object.fromEntries(grouping.clusterBasis),
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

    // 「问价值」类问题（多少/公布了吗/什么时候）：结论可能是证据不足，
    // 但用户真正要的是「官方到底怎么说」。这里只把材料里真实出现的、
    // 带数字或日期的句子按来源权威度列出来，并明确标注「这不是结论」。
    const claimText = String(input.case?.claim || input.case?.question || "");
    const lookupQuestion = isLookupQuestion(claimText);
    // 与 buildAssessment 用同一个收集函数：两条读取路径不能给出不同的直接答案。
    const lookup = lookupQuestion ? collectLookupEvidence(pages, bodies) : [];
    const sourcedLookupAnswer = lookupQuestion ? findSourcedLookupAnswer(claimText, lookup) : null;
    // 实体型问句（谁 / 叫什么名字 / 在哪里）：答案同样必须绑在真实原句上。
    const entityParts = !lookupQuestion && isEntityQuestion(claimText) ? entityQuestionParts(claimText) : null;
    const entityEvidence = entityParts ? collectEntityEvidence(pages, bodies, entityParts) : [];
    const sourcedEntityAnswer = entityParts ? findSourcedEntityAnswer(claimText, entityEvidence) : null;

    // 问句本身不是断言，但如果原句里读到了答案，就不能继续笼统说「证据不足」：
    // 升级为「答了一部分」，并保留「未独立核实」的限制。
    const finalVerdict =
      sourcedEntityAnswer && verdict.outcome === "insufficient"
        ? {
            ...verdict,
            outcome: "partial" as const,
            headline: "已找到来源中的对应答案，仍需人工核对。",
            reasons: [
              ...(verdict.reasons || []).filter((reason: string) => !/改写成陈述句/.test(reason)),
              `原句给出「${sourcedEntityAnswer.value}」，但这只是该来源的表述，不等同于已核实的唯一答案。`,
            ],
          }
        : verdict;

    return {
      ...input,
      documents: [
        ...(input.documents || []).filter((d: any) => d.id === "case-question"),
        ...evidenceDocuments,
      ],
      claims,
      assessment: versionAssessment({
        facts: assessments,
        verdict: {
          ...finalVerdict,
          statement: sourcedLookupAnswer && finalVerdict.outcome !== "supported" && finalVerdict.outcome !== "contradicted"
            ? lookupStatement(sourcedLookupAnswer)
            : sourcedEntityAnswer
              ? entityStatement(sourcedEntityAnswer)
              : statement,
        },
        independentSources,
        bodyAvailable,
        clusters,
        openQuestions: missing,
        // 实体型问句：把找到的答案、原句与限制放在同一处；没找到就如实空着。
        ...(entityParts && entityEvidence.length
          ? {
              lookup: {
                note: sourcedEntityAnswer
                  ? "已找到与所问对象直接对应的原句。答案是来源自己写的，不等同于已核实的唯一答案。"
                  : "找到了相关原句，但没有能直接回答这个问题的表述（或多处说法互相冲突），因此不给出答案。",
                ...(sourcedEntityAnswer ? { answer: sourcedEntityAnswer } : {}),
                items: entityEvidence,
              },
            }
          : {}),
        // 查询型问题的「材料里查到什么」：不是结论，不能替代结论。
        ...(lookup.length
          ? {
              lookup: {
                note: sourcedLookupAnswer
                  ? "已找到与所问指标直接对应的数值。数值是来源中的原文记录，不等同于独立核实官方发布或统计口径。"
                  : "只找到可能相关的公开材料，目前没有与所问指标直接对应、且时间条件一致的数值，不能自行推断答案。",
                ...(sourcedLookupAnswer ? { answer: sourcedLookupAnswer } : {}),
                items: lookup,
              },
            }
          : {}),
        // 历史经验匹配：只展示检查提示，不参与上面的支持/反证计数与结论。
        experiences: Array.isArray(input.case?.experienceHints) ? input.case.experienceHints : [],
      }),
      checks: [
        ...(input.checks || []).filter(
          (c: any) => !["独立来源", "原文依据", "同源转载", "结论完备性"].includes(c.name),
        ),
        {
          name: "同源转载",
          passed: true,
          detail: `检索到 ${pages.length} 条网页，${duplicatePages.size} 条有依据判为重复并合并；${independentSources} 个来源簇未检测到重复。未触发合并不代表已排除同源转载。`,
        },
        {
          name: "未检测到重复的来源簇",
          passed: independentSources >= 2,
          status: independentSources >= 2 ? ("passed" as const) : ("not_evaluated" as const),
          detail:
            independentSources >= 2
              ? `有 ${independentSources} 个来源簇未检测到重复；这项检查不证明来源独立。`
              : `只有 ${independentSources} 个来源簇未检测到重复，材料不足以确认事实。`,
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
