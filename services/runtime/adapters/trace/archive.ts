/**
 * 调查档案渲染器。
 *
 * 单一来源：首次交付（trace.archive.export 插件）与「确认后再次追问产生的
 * 新版本」（/trace/redeliver）都用这里生成档案，避免两套文案与两套判定口径。
 *
 * 档案里写什么、不写什么是有意为之：
 *  - 写：版本号、结论类型、逐条事实判断、每条来源的支持/反对理由、原文是否可访问、
 *        哪些判断是人工修正、检索请求状态；
 *  - 不写：任何无法复核的推断、任何「AI 已验证」的表述。
 */
import { outcomeLabel } from "./analyze.ts";

export interface ArchiveSource {
  url: string;
  site: string;
  title: string;
  date: string;
  relation: string;
  relevance: number;
  excerpt: string;
  bodyAvailable: boolean;
  bodyExcerpt: string | null;
  originality: string;
  reprintMarkers: string[];
  clusterId: string;
  duplicate: boolean;
  dateStatus: string;
  dateNote: string;
  reasons: string[];
  /** 人工修正后保留的自动判断 */
  autoRelation?: string;
  manualCorrection?: { relation: string; note: string; actor: string; at: string } | null;
}

export interface ArchiveFact {
  factId: string;
  fact: string;
  relation: string;
  independentClusters: number;
  bodyBackedClusters: number;
  supports: number;
  contradicts: number;
  unclear?: number;
  irrelevant?: number;
  outOfRangeSupports: number;
  reasons: string[];
  sources: ArchiveSource[];
}

export interface ArchiveInput {
  runId: string;
  bundle: any;
  assessment: {
    facts: ArchiveFact[];
    verdict: any;
    independentSources: number;
    bodyAvailable: number;
    openQuestions?: string[];
    corrections?: {
      pageId: string;
      factId: string;
      relation: string;
      note: string;
      actor: string;
      at: string;
      impact?: {
        sourceBefore: string;
        sourceAfter: string;
        factBefore: string;
        factAfter: string;
        supportsBefore: number;
        supportsAfter: number;
        clustersBefore: number;
        clustersAfter: number;
        verdictBefore: string;
        verdictAfter: string;
      };
    }[];
  };
  /** 交付版本号：1 为首版，之后每次重新确认 +1 */
  revision: number;
  generatedAt: string;
  actor: string;
  /** 本版本相对上一版本的变化说明（首版为空） */
  changes?: string[];
}

const relationLabel: Record<string, string> = {
  supports: "支持",
  contradicts: "反对",
  unclear: "无法确认",
  irrelevant: "无关",
  mixed: "存在争议",
  none: "无可用来源",
};

function escapeCell(value: unknown) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);
}

export function archiveFilenames(revision: number) {
  const suffix = revision <= 1 ? "" : `-v${revision}`;
  return { markdown: `调查档案${suffix}.md`, json: `调查档案${suffix}.json` };
}

export function renderArchive(input: ArchiveInput) {
  const { runId, bundle, assessment, revision, generatedAt, actor, changes = [] } = input;
  const verdict = assessment.verdict || {};
  const facts = assessment.facts || [];
  const caseInfo = bundle?.case || {};
  const search = bundle?.search || {};
  const receiptPath = `/v1/runs/${runId}/receipt`;
  const files = archiveFilenames(revision);
  const corrections = (assessment.corrections || []).filter(Boolean);

  const lines: string[] = [
    `# 调查档案${revision > 1 ? `（第 ${revision} 版）` : ""}：${caseInfo.claim || caseInfo.question || "调查档案"}`,
    ``,
    `- 版本：第 ${revision} 版（交付时间 ${generatedAt}，确认人 ${actor}）`,
    `- 结论类型：**${outcomeLabel(verdict.outcome)}**（把握程度：${verdict.confidence === "medium" ? "中" : verdict.confidence === "high" ? "高" : "低"}）`,
    `- 结论：${verdict.statement || verdict.headline || "（本次未生成结论文本）"}`,
    `- 结论理由：`,
    ...(verdict.reasons || []).map((reason: string) => `  - ${reason}`),
    ``,
    ...(changes.length
      ? [`## 本版变化`, ``, ...changes.map((item) => `- ${item}`), ``]
      : []),
    `## 一、调查对象`,
    ``,
    `- 原始问题：${caseInfo.question || "（未记录）"}`,
    `- 待核查说法：${caseInfo.claim || "（与原始问题相同）"}`,
    `- 事实拆解：人工确认（未使用 AI 拆解）`,
    `- 立案时间：${caseInfo.createdAt || "（未记录）"}`,
    ``,
    `## 二、逐条事实判断`,
    ``,
    ...facts.flatMap((fact, index) => [
      `### ${index + 1}. ${fact.fact}`,
      ``,
      `- 判断：${relationLabel[fact.relation] || fact.relation}`,
      `- 独立来源簇：${fact.independentClusters} 个（其中取得原文正文 ${fact.bodyBackedClusters} 个）`,
      `- 命中来源条数：支持 ${fact.supports} 条、反对 ${fact.contradicts} 条、无法确认 ${fact.unclear ?? 0} 条、无关 ${fact.irrelevant ?? 0} 条`,
      `- 判断理由：`,
      ...(fact.reasons || []).map((reason: string) => `  - ${reason}`),
      ``,
      `#### 该事实的来源明细`,
      ``,
      ...(fact.sources || []).map((source, i) =>
        [
          `${i + 1}. [${source.title}](${source.url})`,
          `   - 关系：${relationLabel[source.relation] || source.relation}${
            source.manualCorrection
              ? `（人工修正；系统自动判断原为「${relationLabel[source.autoRelation || ""] || source.autoRelation}」，修正人 ${source.manualCorrection.actor}：${source.manualCorrection.note}）`
              : "（系统自动判断）"
          }；关键词重合度 ${Math.round((source.relevance || 0) * 100)}%；来源簇 ${source.clusterId}${
            source.duplicate ? "（与同簇来源内容雷同，不计入独立证据）" : ""
          }`,
          `   - 站点：${source.site}；标注发布时间：${source.date || "未提供"}`,
          `   - 时效：${source.dateStatus === "in_range" ? "在适用时间范围内" : source.dateStatus === "out_of_range" ? "在适用时间范围之外" : "无法确认"}（${source.dateNote}）`,
          `   - 原文：${source.bodyAvailable ? "已取得正文" : "未取得正文，仅有搜索摘要"}；出处判定：${
            source.originality === "original_candidate"
              ? "疑似原始出处"
              : source.originality === "reprint"
                ? "转载/二次传播"
                : "无法判定"
          }`,
          `   - 摘要摘录：${(source.excerpt || "").slice(0, 400)}`,
          ...(source.bodyExcerpt ? [`   - 原文摘录：${source.bodyExcerpt.slice(0, 400)}`] : []),
          `   - 判定依据：${(source.reasons || []).join(" ")}`,
        ].join("\n"),
      ),
      ``,
    ]),
    `## 三、尚未解决的问题`,
    ``,
    ...(assessment.openQuestions?.length
      ? assessment.openQuestions.map((item) => `- ${item}`)
      : ["- 无遗留缺口。"]),
    ``,
    `## 四、人工修正记录`,
    ``,
    ...(corrections.length
      ? corrections.map((item) => {
          const head = `- 来源 ${item.pageId}（事实 ${item.factId}）：系统判断「${
            relationLabel[item.impact?.sourceBefore || ""] || item.impact?.sourceBefore || "未记录"
          }」→ 人工修正为「${relationLabel[item.relation] || item.relation}」；原因：${item.note}；修正人：${item.actor}；时间：${item.at}`;
          if (!item.impact) return head;
          const rel = (value: string) => relationLabel[value] || value;
          const changed: string[] = [];
          if (item.impact.factBefore !== item.impact.factAfter)
            changed.push(`事实判断 ${rel(item.impact.factBefore)} → ${rel(item.impact.factAfter)}`);
          if (item.impact.supportsBefore !== item.impact.supportsAfter)
            changed.push(`支持来源 ${item.impact.supportsBefore} → ${item.impact.supportsAfter} 条`);
          if (item.impact.clustersBefore !== item.impact.clustersAfter)
            changed.push(`独立来源 ${item.impact.clustersBefore} → ${item.impact.clustersAfter} 个`);
          changed.push(
            item.impact.verdictBefore === item.impact.verdictAfter
              ? `结论类型未变（${relationLabel[item.impact.verdictBefore] || item.impact.verdictBefore}）`
              : `结论类型 ${rel(item.impact.verdictBefore)} → ${rel(item.impact.verdictAfter)}`,
          );
          return `${head}；对结论的影响（采纳时真实重算）：${changed.join("；")}`;
        })
      : ["- 本版没有人工修正，全部关系由系统规则判断。"]),
    ``,
    `## 五、检索与取证记录`,
    ``,
    `- 检索服务：腾讯云元宝搜索 SearchPro（${search.endpointHost || "未记录"}）`,
    `- 检索式：${search.totalQueries ?? 0} 条，成功返回 ${search.succeededQueries ?? 0} 条，无结果 ${search.emptyQueries ?? 0} 条，失败 ${search.failedQueries ?? 0} 条，限流 ${search.rateLimitedQueries ?? 0} 条`,
    ``,
    `| # | 检索式 | RequestId | HTTP | 结果数 | 耗时 | 尝试 | 状态 |`,
    `|---|---|---|---|---|---|---|---|`,
    ...((bundle?.searches || []) as any[]).map(
      (attempt, index) =>
        `| ${index + 1} | ${escapeCell(attempt.query)} | ${attempt.requestId || "—"} | ${attempt.httpStatus ?? "—"} | ${attempt.resultCount} | ${attempt.durationMs}ms | ${attempt.attempts} | ${
          attempt.error ? `${attempt.error.code}：${escapeCell(attempt.error.message)}` : "正常"
        } |`,
    ),
    ``,
    `## 六、本档案的边界`,
    ``,
    `- 事实与检索式由人工确认，系统未执行 AI 事实拆解，也未调用任何模型对结论背书。`,
    `- 证据关系默认由规则判断；带「人工修正」标记的条目以人工判断为准，系统自动判断同时保留在本档案中。`,
    `- 结论只基于本档案列出的公开来源；未列出的来源不构成本次结论的依据。`,
    `- 检索命中不等于事实为真：支持性判断要求多个独立来源，且至少一个来源取得原文正文；只有摘要时明确标注。`,
    `- 内容雷同的同源/转载页面已合并计数。若要反驳结论，请直接打开上列网址复核原文。`,
    `- 版本 ${revision} 的档案文件一经生成即固定；后续追问只会产生新版本，不会改写本文件。`,
    `- 本文件在导出步骤生成；运行的最终状态以 ${receiptPath} 为准。`,
    ``,
    `导出时间：${generatedAt}；运行：${runId}；版本：${revision}。`,
  ];

  const json = {
    archiveKind: "trace-investigation-archive",
    runId,
    revision,
    generatedAt,
    actor,
    changes,
    finalStatusSource: receiptPath,
    case: caseInfo,
    verdict,
    facts,
    openQuestions: assessment.openQuestions || [],
    corrections,
    search,
    searches: bundle?.searches || [],
    bodies: bundle?.bodies || [],
    sources: ((bundle?.pages || []) as any[]).map((page) => ({
      id: page.id,
      title: page.title,
      url: page.url,
      site: page.site,
      date: page.date,
      score: page.score,
      excerpt: page.passage,
    })),
    boundary:
      "事实与检索式由人工确认；证据关系默认由规则判断，人工修正单独标注并保留自动判断；结论仅基于本档案列出的公开来源；检索命中不等于事实为真。",
  };

  return {
    markdown: lines.join("\n"),
    json: JSON.stringify(json, null, 2),
    markdownFilename: files.markdown,
    jsonFilename: files.json,
  };
}
