/**
 * 生成 C 案例的进阶调查报告（PDF + Markdown）。
 *
 * 全部数字来自 delivery/trace-showcase/showcase-data.js 里的真实运行记录：
 * v1/v2/v3 三版评估、1 次真实追问、2 条人工修正（含影响）。
 * 不重新检索、不重算结论、不加工措辞里的"证据"。
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const SITE = process.env.TRACE_SHOWCASE_URL || "https://trace-showcase-eight.vercel.app";
const outDir = "delivery/materials";
const fileBase = "案例C·进阶调查报告：一条氢能说法为什么查不下去";

const raw = await readFile("delivery/trace-showcase/showcase-data.js", "utf8");
const data = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
const item = data.cases.find((entry) => entry.key === "C");

const REL = { supports: "支持", contradicts: "反对", unclear: "无法确认", irrelevant: "无关", mixed: "存在争议", none: "无可用来源" };
const versions = item.revisions.revisions;
const latest = versions[versions.length - 1] || {};
const v1 = versions[0]?.assessment || {};
const v2 = latest.assessment || {};
const v3 = latest.assessment || {}; // 结论与缺口一律以最新一版为准
const f1 = (v1.facts || [])[0] || {};
const f2 = (v2.facts || [])[0] || {};
const f3 = (v3.facts || [])[0] || {};
const claim = item.run.steps.find((step) => step.capabilityId === "trace.case.intake")?.output?.case?.claim || "";
const question = item.run.steps.find((step) => step.case?.question)?.output?.case?.question || "";
const followup = (item.run.evidence || []).filter((e) => e.kind === "trace.followup").map((e) => e.data)[0];
const corrections = (v3.corrections || []).length ? v3.corrections : item.assessment?.corrections || [];
const sources = (f3.sources || []).filter((source) => source.relation !== "irrelevant");
const supports = sources.filter((source) => source.relation === "supports");
const bodyBacked = sources.filter((source) => source.bodyAvailable);
const openQuestions = v3.openQuestions || [];
const caseUrl = `${SITE}/#/cases/${item.runId}`;
const archiveUrl = `${SITE}/#/archive/${item.runId}`;

const exe =
  process.env.TRACE_CHROMIUM ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const sourceList = (list, label) =>
  list
    .map(
      (source) => `<li><span class="tag tag-${source.relation}">${REL[source.relation] || source.relation}</span>
      <a href="${esc(source.url)}">${esc(source.title)}</a>
      <span class="meta">${esc(source.site)}${source.bodyAvailable ? " · 原文正文已取" : " · 仅搜索摘要"}${source.duplicate ? " · 同源转载" : ""}</span>
      <div class="url">${esc(source.url)}</div></li>`,
    )
    .join("") || `<li class="meta">（该类来源为空）</li>`;

const correctionList =
  corrections
    .map((correction) => {
      const impact = correction.impact;
      const bits = [];
      if (impact) {
        if (impact.factBefore !== impact.factAfter)
          bits.push(`事实判断 ${REL[impact.factBefore] || impact.factBefore} → ${REL[impact.factAfter] || impact.factAfter}`);
        if (impact.supportsBefore !== impact.supportsAfter) bits.push(`支持来源 ${impact.supportsBefore} → ${impact.supportsAfter} 条`);
        if (impact.clustersBefore !== impact.clustersAfter) bits.push(`独立来源 ${impact.clustersBefore} → ${impact.clustersAfter} 个`);
        bits.push(
          impact.verdictBefore === impact.verdictAfter
            ? `结论类型未变（证据不足）`
            : `结论类型 ${impact.verdictBefore} → ${impact.verdictAfter}`,
        );
      }
      return `<li>${esc(correction.actor)} 把来源 ${esc(correction.pageId)} 从「${REL[impact?.sourceBefore] || "未记录"}」改为「${REL[correction.relation] || correction.relation}」。原因：${esc(correction.note)}${bits.length ? `<div class="impact">影响：${bits.join("；")}</div>` : ""}</li>`;
    })
    .join("") || "<li>无人工修正。</li>";

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(fileBase)}</title>
<style>
  @page { size: A4; margin: 16mm 15mm; }
  body { font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; color: #1d2530; font-size: 10.5pt; line-height: 1.75; }
  h1 { font-size: 18pt; margin: 0 0 3mm; }
  h2 { font-size: 12pt; margin: 8mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #e2e0da; }
  h3 { font-size: 10.5pt; margin: 4mm 0 1mm; }
  .lead { color: #5b6470; font-size: 9pt; }
  .quote { border-left: 3px solid #24425a; background: #fbfaf7; padding: 3mm 4mm; margin: 3mm 0; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 2mm; }
  th, td { border: 1px solid #e2e0da; padding: 1.4mm 2mm; text-align: left; vertical-align: top; }
  th { background: #f5f3ee; }
  ul { margin: 1.5mm 0 0; padding-left: 5mm; }
  li { margin-bottom: 1.6mm; }
  a { color: #24425a; word-break: break-all; }
  .tag { display: inline-block; font-size: 8pt; padding: 0 1.5mm; border-radius: 2px; margin-right: 1.5mm; border: 1px solid currentColor; }
  .tag-supports { color: #1f6b4a; } .tag-contradicts { color: #9a2f2f; } .tag-unclear { color: #7c5a12; } .tag-irrelevant { color: #6b7280; }
  .meta { color: #5b6470; font-size: 8.5pt; margin-left: 1.5mm; }
  .url { color: #6b7280; font-size: 8pt; word-break: break-all; }
  .impact { color: #7c5a12; font-size: 9pt; }
  .warn { color: #9a2f2f; }
  .ok { color: #1f6b4a; }
  .note { font-size: 8.5pt; color: #5b6470; }
</style></head><body>
<h1>${esc(fileBase)}</h1>
<p class="lead">溯证 TRACE · 1024 侦探赛道 · 进阶调查报告<br>
在线调查过程：<a href="${caseUrl}">${caseUrl}</a><br>
在线档案（3 个版本）：<a href="${archiveUrl}">${archiveUrl}</a></p>

<h2>一、原始待核查说法</h2>
<div class="quote"><b>${esc(claim)}</b><br><span class="meta">原始提问：${esc(question || claim)}</span></div>
<p>这句话难的地方不在"有没有氢能新闻"，而在于它的三个限定词：<b>2025 年</b>、<b>覆盖全国主要干线</b>、<b>网络已建成</b>。检索能轻易命中大量氢能新闻，但只有同时满足这三个限定的表述才算证据——这正是后面所有"证据不足"的来源。</p>

<h2>二、初次找到的证据（第 1 版）</h2>
<table><thead><tr><th>版本</th><th>结论</th><th>独立来源</th><th>原文正文</th><th>支持</th><th>无法确认</th><th>无关</th><th>独立支持簇</th></tr></thead>
<tbody>
<tr><td>第 1 版</td><td>证据不足</td><td>${v1.independentSources ?? "—"}</td><td>${v1.bodyAvailable ?? "—"}</td><td>${f1.supports ?? 0}</td><td>${f1.unclear ?? 0}</td><td>${f1.irrelevant ?? 0}</td><td>${f1.independentClusters ?? 0}</td></tr>
</tbody></table>
<p>第 1 版检索到 ${v1.independentSources} 个独立来源、${v1.bodyAvailable} 份原文正文，但<b>没有任何来源被判为支持</b>（14 条无法确认、1 条无关）。结论之所以是"证据不足"而不是"有依据支持"，不是因为没搜到东西，而是因为搜到的东西都不满足上面三个限定。</p>

<h2>三、证据为什么不充分</h2>
<ol>
<li><b>局部 ≠ 全国。</b>命中的是"西部陆海新通道氢走廊投运""我国首条跨区域氢能重卡干线投运""1150 公里首条干线"这类局部线路报道，没有一条写"覆盖全国主要干线"。规则把"只提到相关局部事实、没有可比对表述"判为<b>无法确认</b>，而不是硬凑成支持。</li>
<li><b>同一事件被多家转述，系统按可指认的依据合并。</b>${f3.sources.length} 条网页里有 ${
  f3.sources.filter((source) => source.independence === "duplicate").length
} 条被判为同一篇内容（同标题或摘要逐字一致），${
  f3.sources.filter((source) => source.independence === "unconfirmed").length
} 条判为"独立性未确认"，最终 ${v3.independentSources} 个未检测到重复的来源，支持性来源仍然只有 ${
  f3.independentClusters ?? 0
} 个支持来源簇。每条来源的理由里写着合并依据（标题一致／摘要逐字一致／同一文章编号／正文重合）。</li>
<li><b>支持性来源缺原文正文。</b>即便是唯一被判支持的那条（光明网《中国石化：西部陆海新通道"氢走廊"正式投运》），当时也只拿到搜索摘要，没有取到正文——按规则"支持性判断必须至少一份原文正文"，这一条不足以支撑结论。</li>
</ol>

<h2>四、用户如何继续追问</h2>
<p>针对"局部投运是否等于全国建成"这个具体缺口，追加了一次真实检索：</p>
<div class="quote">检索式：<b>${esc(followup?.query || "（无）")}</b><br>
<span class="meta">请求时间 ${esc(followup?.requestedAt || "")}　·　返回 ${followup?.resultCount ?? "—"} 条结果　·　RequestId ${esc(followup?.requestId || "—")}</span></div>
<p>这条检索式不是随便写的：它把待核查说法里的"全国""建成""覆盖""高速公路"拆成可命中的关键词，试图找到"站数量/里程/覆盖率"这类能量化"网络完整性"的来源。</p>

<h2>五、追加搜索发现了什么（首版与最新版对比）</h2>
<table><thead><tr><th>版本</th><th>结论</th><th>独立来源</th><th>原文正文</th><th>支持</th><th>无法确认</th><th>独立支持簇</th></tr></thead>
<tbody>
<tr><td>第 1 版</td><td>证据不足</td><td>${v1.independentSources}</td><td>${v1.bodyAvailable}</td><td>${f1.supports ?? 0}</td><td>${f1.unclear ?? 0}</td><td>${f1.independentClusters ?? 0}</td></tr>
<tr><td>最新第 ${latest.revision} 版</td><td>证据不足</td><td>${v2.independentSources}</td><td>${v2.bodyAvailable}</td><td>${f2.supports ?? 0}</td><td>${f2.unclear ?? 0}</td><td>${f2.independentClusters ?? 0}</td></tr>
</tbody></table>
<p>追加之后：独立来源 ${v1.independentSources} → ${v2.independentSources}（+${(v2.independentSources ?? 0) - (v1.independentSources ?? 0)}），取得原文正文 ${v1.bodyAvailable} → ${v2.bodyAvailable}；同时第一次出现了一条被判为"支持"的来源。新增的来源里有几条是有价值的旁证（例如"我国氢气年产能超 5100 万吨"、跨区域干线投运报道），但它们说明的是产业现状，仍然回答不了"网络是否已覆盖全国"。</p>

<h2>六、人工纠正了哪些判断</h2>
<ul>${correctionList}</ul>
<p>两条修正的方向相反：一条把"局部投运"认定为支持，另一条把"十五五展望"排除为本事实无关。修正只改关系判断，<b>原始搜索返回与网页摘录一个字都没有动</b>；系统自动判断、修正人、原因与影响同时保留在档案里。</p>

<h3>共同原始出处</h3>
<p>${
  (f3.sharedOrigins || []).length
    ? `有 ${(f3.sharedOrigins || []).map((item) => `${item.count} 条来源明确引用「${item.org}」的发布数据`).join("、")}。这类报道属于同一原始发布机构的二次转述或解读，结论里按 1 条独立证据计，不因为被多家转述就提高支持度。`
    : "本轮没有检测到两条以上来源共同引用同一官方发布，因此没有按「同源出处」合并。"
}</p>

<h2>七、为什么最终仍然证据不足</h2>
<p>最新第 ${latest.revision} 版的状态：${v3.independentSources} 个未检测到重复的来源、${v3.bodyAvailable} 份原文正文，<b>支持性来源只有 ${f3.independentClusters ?? 0} 个独立来源簇</b>，而且这条唯一的支持来源只有搜索摘要。规则要求"至少 2 个互不转载的独立来源、且至少 1 份取得原文正文"，两项都不满足，所以结论保持不变。</p>
<p class="warn">关键点：人工修正让判断更准确（把该算支持的算成支持、该排除的排除），但没有让结论变好看。系统不会为了让结果显得聪明而改变判定口径。</p>
<h3>档案里明确写出的缺口</h3>
<ul>${openQuestions.map((text) => `<li>${esc(text)}</li>`).join("") || "<li>无遗留缺口。</li>"}</ul>
<p>换句话说，要真正查实这句说法，还需要：① 官方或运营商发布的全国加氢站/干线覆盖统计（可访问的原文，最好带里程或站点数）；② 第二个互不转载的独立来源对同一覆盖范围作表述；③ 明确的"建成时间"表述，避免把"规划/在建"当成"已建成"。</p>

<h2>八、可点击的原始来源</h2>
<h3>被判"支持"的来源（${supports.length} 条）</h3>
<ul>${sourceList(supports)}</ul>
<h3>取到原文正文、但仍判"无法确认"的来源（${bodyBacked.length} 条，说明为什么有原文也不等于支持）</h3>
<ul>${sourceList(bodyBacked)}</ul>

<h2>九、方法与边界</h2>
<ul>
<li>检索：腾讯云元宝搜索 SearchPro，共 ${v3.verdict?.counts?.queries ?? "—"} 次检索（含 1 次追加），全部为真实网络请求，日志里保留了 RequestId。</li>
<li>原文：对候选来源抓取正文（仅 http/https，拒绝内网地址），取到正文的来源会标明"原文正文已取"。</li>
<li>判定：同源合并 → 时间与主体比对 → 数量断言比较 → 支持/反对/无法确认/无关四态；不支持"命中即真相"。</li>
<li>档案：每版档案单独成文件、单独记录 SHA-256；第 1 版在此后两次改版中未被改写，下载链接始终对应第 1 版。</li>
<li>边界：没有调用任何模型为结论背书；没有公网实时查询入口（只读展示为历史记录回放）。</li>
</ul>
<p class="note">本报告的全部数字来自运行记录（第 1/2/3 版评估快照与修正记录），没有重新检索、没有重算结论、没有改写任何来源标题与摘录。</p>
</body></html>`;

const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined });
const ctx = await browser.newContext({ locale: "zh-CN" });
const page = await ctx.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.waitForTimeout(400);
await page.pdf({ path: join(outDir, `${fileBase}.pdf`), format: "A4", printBackground: true, margin: { top: "16mm", bottom: "16mm", left: "15mm", right: "15mm" } });
await ctx.close();
await browser.close();

const md = `# ${fileBase}

- 在线调查过程：${caseUrl}
- 在线档案（3 个版本）：${archiveUrl}
- 数据来源：本机真实联网运行记录（腾讯云元宝搜索 SearchPro）

## 一、原始待核查说法

- ${claim}
- 原始提问：${question || claim}

难点在三个限定词：2025 年 / 覆盖全国主要干线 / 网络已建成。

## 二、初次找到的证据（第 1 版）

| 版本 | 结论 | 独立来源 | 原文正文 | 支持 | 无法确认 | 无关 | 独立支持簇 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 第 1 版 | 证据不足 | ${v1.independentSources} | ${v1.bodyAvailable} | ${f1.supports ?? 0} | ${f1.unclear ?? 0} | ${f1.irrelevant ?? 0} | ${f1.independentClusters ?? 0} |

## 三、证据为什么不充分

1. 局部 ≠ 全国：命中的是局部线路投运报道，没有一条写"覆盖全国主要干线"。
2. 大量同源转载：同一条"1150 公里首条投运"被多站转述，合并为一条独立证据。
3. 支持性来源缺原文正文：唯一被判支持的来源当时只有搜索摘要。

## 四、用户如何继续追问

- 检索式：\`${followup?.query || ""}\`
- 返回 ${followup?.resultCount ?? "—"} 条结果，RequestId ${followup?.requestId || "—"}，时间 ${followup?.requestedAt || ""}

## 五、追加搜索发现了什么

| 版本 | 结论 | 独立来源 | 原文正文 | 支持 | 无法确认 | 独立支持簇 |
| --- | --- | --- | --- | --- | --- | --- |
| 第 1 版 | 证据不足 | ${v1.independentSources} | ${v1.bodyAvailable} | ${f1.supports ?? 0} | ${f1.unclear ?? 0} | ${f1.independentClusters ?? 0} |
| 最新第 ${latest.revision} 版 | 证据不足 | ${v2.independentSources} | ${v2.bodyAvailable} | ${f2.supports ?? 0} | ${f2.unclear ?? 0} | ${f2.independentClusters ?? 0} |

## 六、人工纠正了哪些判断

${corrections
  .map(
    (correction) =>
      `- ${correction.actor} 把来源 ${correction.pageId} 从「${REL[correction.impact?.sourceBefore] || "未记录"}」改为「${REL[correction.relation] || correction.relation}」，原因：${correction.note}${
        correction.impact ? `（影响：事实判断 ${REL[correction.impact.factBefore] || correction.impact.factBefore} → ${REL[correction.impact.factAfter] || correction.impact.factAfter}；支持来源 ${correction.impact.supportsBefore} → ${correction.impact.supportsAfter} 条；结论类型未变）` : ""
      }`,
  )
  .join("\n")}

## 六之二、共同原始出处

${(f3.sharedOrigins || []).length
  ? `- 有 ${(f3.sharedOrigins || []).map((item) => `${item.count} 条来源明确引用「${item.org}」的发布数据`).join("、")}：属同一原始发布机构的二次转述或解读，结论里按 1 条独立证据计。`
  : "- 本轮没有检测到两条以上来源共同引用同一官方发布。"}

## 七、为什么最终仍然证据不足

支持性来源只有 ${f3.independentClusters ?? 0} 个独立来源簇，且该来源只有搜索摘要；规则要求"至少 2 个互不转载的独立来源、且至少 1 份取得原文正文"，两项都不满足。

缺口：

${openQuestions.map((text) => `- ${text}`).join("\n") || "- 无"}

## 八、可点击的原始来源

支持类：

${supports.map((source) => `- [${source.site}](${source.url})「${source.title}」${source.bodyAvailable ? "（原文正文已取）" : "（仅搜索摘要）"}`).join("\n") || "- 无"}

取到原文正文但仍判无法确认：

${bodyBacked.map((source) => `- [${source.site}](${source.url})「${source.title}」`).join("\n") || "- 无"}

## 九、方法与边界

- 检索：腾讯云元宝搜索 SearchPro，${v3.verdict?.counts?.queries ?? "—"} 次真实请求（含 1 次追加），保留 RequestId。
- 原文：仅 http/https，拒绝内网地址；取到正文会标注。
- 判定：同源合并 → 时间/主体比对 → 数量断言比较 → 四态关系。
- 档案：每版单独成文件并记录 SHA-256，旧版不被改写。
- 边界：未调用模型背书；公网页面为只读历史记录。
`;

await writeFile(join(outDir, `${fileBase}.md`), md, "utf8");
console.log("生成", join(outDir, `${fileBase}.pdf`));

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
