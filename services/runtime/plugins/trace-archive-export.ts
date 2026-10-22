/**
 * trace.archive.export —— 可下载的调查档案。
 *
 * 只有在人工确认节点通过后才会执行（requiresApproval + approvalScope: delivery），
 * 生成 Markdown 档案与结构化 JSON，两者都写入 SHA-256 与字节数，可下载复查。
 *
 * 档案里写什么、不写什么是有意为之：
 *  - 写：结论类型、逐条事实判断、每条来源的支持/反对理由、原文是否可访问、检索请求状态；
 *  - 不写：任何无法复核的推断、任何「AI 已验证」的表述。
 */
import { ExecutionError, type CapabilityDefinition } from "../src/contracts.ts";
import { outcomeLabel } from "../adapters/trace/analyze.ts";
import { publicBundleSchema } from "../adapters/trace/bundle.ts";

const configSchema = { type: "object", additionalProperties: false };

const relationLabel: Record<string, string> = {
  supports: "支持",
  contradicts: "反对",
  unclear: "无法判断",
  mixed: "存在争议",
  none: "无可用来源",
};

export default {
  id: "trace.archive.export",
  version: "1.0.0",
  name: "调查档案导出",
  description:
    "人工确认后生成可下载的调查档案（Markdown 与结构化 JSON），包含结论、逐条证据、来源网址与检索记录。",
  inputProtocol: "document.bundle.v1",
  outputProtocol: "document.bundle.v1",
  inputSchema: publicBundleSchema,
  outputSchema: publicBundleSchema,
  configSchema,
  defaultConfig: {},
  permissions: ["file:write"],
  effects: ["local_file"],
  kind: "tool",
  requiresApproval: true,
  approvalScope: "delivery",
  idempotent: true,
  assets: [],
  async execute(input: any, _config, ctx) {
    const assessment = input.assessment;
    if (!assessment?.verdict) {
      throw new ExecutionError(
        "ASSESSMENT_MISSING",
        "缺少证据核验结果，不能生成调查档案。",
      );
    }
    const { verdict, facts } = assessment as {
      verdict: any;
      facts: any[];
      independentSources: number;
      bodyAvailable: number;
    };
    const generatedAt = new Date().toISOString();
    const caseInfo = input.case || {};
    const search = input.search || {};
    const receiptPath = `/v1/runs/${ctx.runId}/receipt`;

    const lines: string[] = [
      `# 调查档案：${caseInfo.claim || caseInfo.question || input.filename}`,
      ``,
      `- 结论类型：**${outcomeLabel(verdict.outcome)}**（把握程度：${verdict.confidence === "medium" ? "中" : verdict.confidence === "high" ? "高" : "低"}）`,
      `- 结论：${verdict.statement}`,
      `- 结论理由：`,
      ...verdict.reasons.map((r: string) => `  - ${r}`),
      ``,
      `## 一、调查对象`,
      ``,
      `- 原始问题：${caseInfo.question || "（未记录）"}`,
      `- 待核查说法：${caseInfo.claim || "（与原始问题相同）"}`,
      `- 事实拆解：${caseInfo.mode === "manual" ? "人工确认（未使用 AI 拆解）" : caseInfo.mode}`,
      `- 拆解说明：${caseInfo.modeNote || "（无）"}`,
      `- 立案时间：${caseInfo.createdAt || "（未记录）"}`,
      ``,
      `## 二、逐条事实判断`,
      ``,
      ...facts.flatMap((fact: any, index: number) => [
        `### ${index + 1}. ${fact.fact}`,
        ``,
        `- 判断：${relationLabel[fact.relation] || fact.relation}`,
        `- 独立来源簇：${fact.independentClusters} 个（其中取得原文正文 ${fact.bodyBackedClusters} 个）`,
        `- 命中来源条数：支持 ${fact.supports} 条、反对 ${fact.contradicts} 条`,
        `- 判断理由：`,
        ...fact.reasons.map((r: string) => `  - ${r}`),
        ``,
        `#### 该事实的来源明细`,
        ``,
        ...fact.sources.map((source: any, i: number) =>
          [
            `${i + 1}. [${source.title}](${source.url})`,
            `   - 关系：${relationLabel[source.relation] || source.relation}；关键词重合度 ${(source.relevance * 100).toFixed(0)}%；来源簇 ${source.clusterId}${source.duplicate ? "（与同簇来源内容雷同，不计入独立证据）" : ""}`,
            `   - 站点：${source.site}；标注发布时间：${source.date || "未提供"}`,
            `   - 时效：${source.dateStatus === "in_range" ? "在适用时间范围内" : source.dateStatus === "out_of_range" ? "在适用时间范围之外" : "无法确认"}（${source.dateNote}）`,
            `   - 原文：${source.bodyAvailable ? "已取得正文" : "未取得正文，仅有搜索摘要"}；出处判定：${source.originality === "original_candidate" ? "疑似原始出处" : source.originality === "reprint" ? "转载/二次传播" : "无法判定"}`,
            `   - 摘要摘录：${source.excerpt.slice(0, 400)}`,
            ...(source.bodyExcerpt ? [`   - 原文摘录：${source.bodyExcerpt.slice(0, 400)}`] : []),
            `   - 判定依据：${source.reasons.join(" ")}`,
          ].join("\n"),
        ),
        ``,
      ]),
      `## 三、检索与取证记录`,
      ``,
      `- 检索服务：腾讯云元宝搜索 SearchPro（${search.endpointHost || "未记录"}）`,
      `- 检索式：${search.totalQueries} 条，成功返回 ${search.succeededQueries} 条，无结果 ${search.emptyQueries} 条，失败 ${search.failedQueries} 条，限流 ${search.rateLimitedQueries} 条`,
      `- 检索总耗时：${search.totalDurationMs}ms；原文抓取成功 ${(input.bodies || []).filter((b: any) => b.ok).length}/${(input.bodies || []).length}`,
      ``,
      `| # | 检索式 | RequestId | HTTP | 结果数 | 耗时 | 尝试 | 状态 |`,
      `|---|---|---|---|---|---|---|---|`,
      ...(input.searches || []).map((attempt: any, index: number) =>
        `| ${index + 1} | ${escapeCell(attempt.query)} | ${attempt.requestId || "—"} | ${attempt.httpStatus ?? "—"} | ${attempt.resultCount} | ${attempt.durationMs}ms | ${attempt.attempts} | ${attempt.error ? `${attempt.error.code}：${escapeCell(attempt.error.message)}` : "正常"} |`,
      ),
      ``,
      `### 原文抓取记录`,
      ``,
      ...(input.bodies || []).map(
        (body: any) =>
          `- ${body.url} → HTTP ${body.httpStatus ?? "—"}，${body.bytes} 字节，正文 ${body.textLength} 字，${body.ok ? "成功" : `失败（${body.error?.code}：${body.error?.message}）`}${body.reprintMarkers?.length ? `，含转载标记：${body.reprintMarkers.join("、")}` : ""}`,
      ),
      ``,
      `## 四、本档案的边界`,
      ``,
      `- 事实与检索式由人工确认，系统未执行 AI 事实拆解，也未调用任何模型对结论背书。`,
      `- 结论只基于本档案列出的公开来源；未列出的来源不构成本次结论的依据。`,
      `- 检索命中不等于事实为真：支持性判断要求多个独立来源，且至少一个来源取得原文正文；只有摘要时明确标注。`,
      `- 内容雷同的同源/转载页面已合并计数。若要反驳结论，请直接打开上列网址复核原文。`,
      `- 本文件在导出步骤生成；运行的最终状态以 ${receiptPath} 为准。`,
      ``,
      `导出时间：${generatedAt}；运行：${ctx.runId}。`,
    ];

    await ctx.artifact("调查档案.md", lines.join("\n"), "text/markdown; charset=utf-8");
    await ctx.artifact(
      "调查档案.json",
      JSON.stringify(
        {
          archiveKind: "trace-investigation-archive",
          runId: ctx.runId,
          generatedAt,
          finalStatusSource: receiptPath,
          case: caseInfo,
          verdict,
          facts,
          search,
          searches: input.searches || [],
          bodies: input.bodies || [],
          sources: (input.pages || []).map((page: any) => ({
            id: page.id,
            title: page.title,
            url: page.url,
            site: page.site,
            date: page.date,
            score: page.score,
            excerpt: page.passage,
          })),
          checks: input.checks || [],
          execution: input.execution || null,
          boundary:
            "事实与检索式由人工确认；结论仅基于本档案列出的公开来源；检索命中不等于事实为真。",
        },
        null,
        2,
      ),
      "application/json; charset=utf-8",
    );
    return input;
  },
} satisfies CapabilityDefinition;

function escapeCell(value: unknown) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);
}
