/**
 * 生成三份可直接提交的真实查询材料（每个案例一个独立 PDF + Markdown）。
 *
 * 数据来源：delivery/trace-showcase/showcase-data.js（由本机真实运行记录导出）。
 * 截图：对公网只读展示站点现场截取，保证材料里的图与线上页面一致。
 *
 * 用法：node tooling/trace-case-sheets.mjs
 * 产物：delivery/materials/案例A-….pdf / 案例B-….pdf / 案例C-….pdf（同名 .md 便于粘贴）
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const SITE = process.env.TRACE_SHOWCASE_URL || "https://trace-showcase-eight.vercel.app";
const outDir = "delivery/materials";
const shotsDir = join(outDir, "shots");
await mkdir(shotsDir, { recursive: true });

const raw = await readFile("delivery/trace-showcase/showcase-data.js", "utf8");
const data = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));

const REL = { supports: "支持", contradicts: "反对", unclear: "无法确认", irrelevant: "无关", mixed: "存在争议", none: "无可用来源" };
const OUTCOME = { supported: "有依据支持", contradicted: "存在反证", disputed: "存在争议", outdated: "信息过期或原文不足", insufficient: "证据不足" };
const CONF = { low: "低", medium: "中", high: "高" };

const TITLES = {
  A: "案例A·原始证据调查：个人信息保护法施行日期",
  B: "案例B·多来源交叉核查：2024年新能源汽车产量",
  C: "案例C·证据不足与继续追问：全国氢能重卡加氢网络",
};
const CATEGORY = {
  A: "有明确原始证据",
  B: "需要跨来源核查",
  C: "补充调查后仍然证据不足",
};
const ONE_LINER = {
  A: "官方原文与全文转载都写明「自 2021 年 11 月 1 日起施行」，内容雷同的转载被合并成同一独立来源，结论落在可点击的原始网址上。",
  B: "政府网、统计局、央广网、中国经济网给出同年同口径的产量数字，多个互不转载的来源共同支持「超过 1200 万辆」；同期出现的「汽车总产销 3100 万辆」属于另一个指标，没有被拿来当新能源产量的证据。",
  C: "能查到的都是「某条干线/某个走廊投运」的局部新闻且多为转载，没有任何来源直接说「已建成覆盖全国的网络」；追加一次真实检索、两次人工修正之后，结论依然是证据不足，并写明还缺什么。",
};

const exe =
  process.env.TRACE_CHROMIUM ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined });

async function shoot(name, hashPath) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 2, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(`${SITE}/${hashPath}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const path = join(shotsDir, `${name}.png`);
  await page.screenshot({ path });
  await ctx.close();
  return path;
}

function topSources(caseData, limit = 5) {
  const facts = caseData.assessment?.facts || [];
  const sources = facts.flatMap((fact) => fact.sources || []);
  const ranked = [...sources]
    .filter((source) => source.relation !== "irrelevant")
    .sort(
      (a, b) =>
        Number(b.bodyAvailable) - Number(a.bodyAvailable) ||
        Number(a.duplicate) - Number(b.duplicate) ||
        (b.relevance || 0) - (a.relevance || 0),
    );
  const seen = new Set();
  const picked = [];
  for (const source of ranked) {
    if (seen.has(source.clusterId)) continue;
    seen.add(source.clusterId);
    picked.push(source);
    if (picked.length >= limit) break;
  }
  return picked;
}

const pages = [];
for (const item of data.cases) {
  const assessment = item.assessment || {};
  const verdict = assessment.verdict || {};
  const facts = assessment.facts || [];
  const claim = (item.run?.steps || []).find((step) => step.capabilityId === "trace.case.intake")?.output?.case?.claim || "";
  const question = (item.run?.steps || []).find((step) => step.capabilityId === "trace.case.intake")?.output?.case?.question || "";
  const sources = topSources(item);
  const corrections = assessment.corrections || [];
  const versions = (item.revisions?.revisions || []).map((revision) => ({
    revision: revision.revision,
    at: revision.at,
    actor: revision.actor,
    files: (revision.artifacts || []).map((artifact) => artifact.filename),
  }));
  const caseUrl = `${SITE}/#/cases/${item.runId}`;
  const archiveUrl = `${SITE}/#/archive/${item.runId}`;

  const caseShot = await shoot(`${item.key}-case`, `#/cases/${item.runId}`);
  const archiveShot = await shoot(`${item.key}-archive`, `#/archive/${item.runId}`);

  const factsRows = facts
    .map(
      (fact) => `<tr>
        <td>${escapeHtml(fact.fact)}</td>
        <td>${REL[fact.relation] || fact.relation}</td>
        <td>${fact.supports}</td>
        <td>${fact.contradicts}</td>
        <td>${fact.unclear ?? 0}</td>
        <td>${fact.independentClusters}</td>
        <td>${fact.bodyBackedClusters}</td>
      </tr>`,
    )
    .join("");

  const sourceItems = sources
    .map(
      (source) => `<li>
        <span class="tag tag-${source.relation}">${REL[source.relation] || source.relation}</span>
        <a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a>
        <span class="meta">${escapeHtml(source.site)}${source.bodyAvailable ? " · 原文正文已取" : " · 仅搜索摘要"}${source.duplicate ? " · 同源转载（已合并计数）" : ""}</span>
        <div class="url">${escapeHtml(source.url)}</div>
      </li>`,
    )
    .join("");

  const correctionItems = corrections.length
    ? corrections
        .map((item) => {
          const impact = item.impact;
          const bits = [];
          if (impact) {
            if (impact.factBefore !== impact.factAfter)
              bits.push(`事实判断 ${REL[impact.factBefore] || impact.factBefore} → ${REL[impact.factAfter] || impact.factAfter}`);
            if (impact.supportsBefore !== impact.supportsAfter) bits.push(`支持来源 ${impact.supportsBefore} → ${impact.supportsAfter} 条`);
            if (impact.clustersBefore !== impact.clustersAfter) bits.push(`独立来源 ${impact.clustersBefore} → ${impact.clustersAfter} 个`);
            bits.push(
              impact.verdictBefore === impact.verdictAfter
                ? `结论类型未变（${OUTCOME[impact.verdictBefore] || impact.verdictBefore}）`
                : `结论类型 ${OUTCOME[impact.verdictBefore]} → ${OUTCOME[impact.verdictAfter]}`,
            );
          }
          return `<li>来源 ${escapeHtml(item.pageId)} 被 ${escapeHtml(item.actor)} 修正为「${REL[item.relation] || item.relation}」${
            impact ? `（系统原判「${REL[impact.sourceBefore] || impact.sourceBefore}」）` : ""
          }：${escapeHtml(item.note)}${bits.length ? `<div class="impact">影响：${bits.join("；")}</div>` : ""}</li>`;
        })
        .join("")
    : `<li>本次调查没有人工修正，全部关系由规则判断。</li>`;

  const versionItems = versions.length
    ? versions
        .map((version) => `<li>第 ${version.revision} 版 · ${formatDate(version.at)} · ${escapeHtml(version.actor)}（${version.files.join("、")}）</li>`)
        .join("")
    : "<li>本次调查尚无版本记录。</li>";

  const openQuestions = (assessment.openQuestions || []).length
    ? (assessment.openQuestions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "<li>本次结论没有遗留缺口。</li>";

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(TITLES[item.key])}</title>
  <style>
    @page { size: A4; margin: 16mm 14mm; }
    body { font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; color: #1d2530; font-size: 10.5pt; line-height: 1.7; }
    h1 { font-size: 17pt; margin: 0 0 4mm; }
    h2 { font-size: 12pt; margin: 7mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #e2e0da; }
    .lead { color: #5b6470; font-size: 9.5pt; }
    .verdict { border: 1px solid #d8d5cd; border-left: 4px solid #24425a; border-radius: 3px; padding: 3mm 4mm; background: #fbfaf7; margin: 3mm 0; }
    .verdict b { font-size: 12pt; }
    .counts { color: #5b6470; font-size: 9pt; margin-top: 1.5mm; }
    table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 2mm; }
    th, td { border: 1px solid #e2e0da; padding: 1.4mm 2mm; text-align: left; vertical-align: top; }
    th { background: #f5f3ee; font-weight: 600; }
    ul { margin: 1.5mm 0 0; padding-left: 5mm; }
    li { margin-bottom: 1.6mm; }
    a { color: #24425a; word-break: break-all; }
    .tag { display: inline-block; font-size: 8pt; padding: 0 1.5mm; border-radius: 2px; margin-right: 1.5mm; border: 1px solid currentColor; }
    .tag-supports { color: #1f6b4a; } .tag-contradicts { color: #9a2f2f; } .tag-unclear { color: #7c5a12; } .tag-irrelevant { color: #6b7280; }
    .meta { color: #5b6470; font-size: 8.5pt; margin-left: 1.5mm; }
    .url { color: #6b7280; font-size: 8pt; word-break: break-all; }
    .impact { color: #7c5a12; font-size: 9pt; }
    img { width: 100%; border: 1px solid #e2e0da; border-radius: 3px; margin-top: 2mm; }
    .note { font-size: 8.5pt; color: #5b6470; }
    .kv { font-size: 9.5pt; }
    .kv b { display: inline-block; min-width: 22mm; color: #1d2530; }
    .break { page-break-before: always; }
  </style></head><body>
  <h1>${escapeHtml(TITLES[item.key])}</h1>
  <p class="lead">溯证 TRACE · 1024 侦探赛道 · 真实联网调查材料（历史记录，非实时查询）<br>
  在线页面：<a href="${caseUrl}">${caseUrl}</a>　·　档案页：<a href="${archiveUrl}">${archiveUrl}</a></p>

  <h2>一、原始问题</h2>
  <p class="kv"><b>提问</b>${escapeHtml(question || claim)}<br><b>待核查说法</b>${escapeHtml(claim)}</p>

  <h2>二、最终结论</h2>
  <div class="verdict">
    <b>${OUTCOME[verdict.outcome] || verdict.outcome}</b>（把握程度：${CONF[verdict.confidence] || verdict.confidence}）<br>
    ${escapeHtml(verdict.statement || "")}
    <div class="counts">独立来源 ${verdict.counts?.independentSources ?? "—"} 个 · 取得原文正文 ${verdict.counts?.bodyAvailable ?? "—"} 份 · 命中网页 ${verdict.counts?.pages ?? "—"} 个 · 检索 ${verdict.counts?.queries ?? "—"} 次</div>
  </div>

  <h2>三、一句话调查说明</h2>
  <p>${escapeHtml(ONE_LINER[item.key])}</p>

  <h2>四、逐条事实与证据计数</h2>
  <table><thead><tr><th>待核查事实</th><th>判断</th><th>支持</th><th>反对</th><th>无法确认</th><th>独立来源</th><th>含原文</th></tr></thead>
  <tbody>${factsRows}</tbody></table>

  <h2>五、真实来源（可直接点开核对）</h2>
  <ul>${sourceItems}</ul>

  <h2>六、人工修正记录</h2>
  <ul>${correctionItems}</ul>

  <h2>七、尚未解决的问题</h2>
  <ul>${openQuestions}</ul>

  <h2>八、调查档案版本</h2>
  <ul>${versionItems}</ul>
  <p class="note">每个版本的档案文件在档案页可逐个下载；旧版本一经生成即固定，后续追问不会改写它。</p>

  <div class="break"></div>
  <h2>九、页面截图（截自上面的公网地址）</h2>
  <p class="note">调查过程页：${caseUrl}</p>
  <img src="file://${caseShot}" alt="调查过程页">
  <p class="note">调查档案页：${archiveUrl}</p>
  <img src="file://${archiveShot}" alt="调查档案页">

  <p class="note" style="margin-top:6mm">说明：本材料来自真实联网运行记录（腾讯云元宝搜索 SearchPro + 网页原文抓取）。公网页面是只读展示，不提供实时检索；需要自己提问请在本机运行 Runtime。所有结论都能点回来源，证据不足时页面明确保留不确定性。</p>
  </body></html>`;

  pages.push({ key: item.key, html, file: TITLES[item.key], item, claim, question, verdict, sources, corrections, versions, caseUrl, archiveUrl });
}

const ctx = await browser.newContext({ locale: "zh-CN" });
const page = await ctx.newPage();
for (const entry of pages) {
  await page.setContent(entry.html, { waitUntil: "load" });
  await page.waitForTimeout(400);
  const pdfPath = join(outDir, `${entry.file}.pdf`);
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" } });
  await writeFile(join(outDir, `${entry.file}.md`), markdown(entry), "utf8");
  console.log("生成", pdfPath);
}
await ctx.close();
await browser.close();

function markdown(entry) {
  const { item, claim, question, verdict, sources, corrections, caseUrl, archiveUrl } = entry;
  const facts = item.assessment?.facts || [];
  const lines = [
    `# ${TITLES[item.key]}`,
    "",
    `- 类别：${CATEGORY[item.key]}`,
    `- 在线页面（只读展示，历史记录）：${caseUrl}`,
    `- 调查档案页：${archiveUrl}`,
    "",
    "## 一、原始问题",
    "",
    `- 提问：${question || claim}`,
    `- 待核查说法：${claim}`,
    "",
    "## 二、最终结论",
    "",
    `- 结论类型：**${OUTCOME[verdict.outcome] || verdict.outcome}**（把握程度：${CONF[verdict.confidence] || verdict.confidence}）`,
    `- 结论：${verdict.statement || ""}`,
    `- 计数：独立来源 ${verdict.counts?.independentSources ?? "—"} 个 · 原文正文 ${verdict.counts?.bodyAvailable ?? "—"} 份 · 命中网页 ${verdict.counts?.pages ?? "—"} 个 · 检索 ${verdict.counts?.queries ?? "—"} 次`,
    "",
    "## 三、一句话调查说明",
    "",
    ONE_LINER[item.key],
    "",
    "## 四、逐条事实与证据计数",
    "",
    "| 待核查事实 | 判断 | 支持 | 反对 | 无法确认 | 独立来源 | 含原文 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...facts.map(
      (fact) =>
        `| ${fact.fact} | ${REL[fact.relation] || fact.relation} | ${fact.supports} | ${fact.contradicts} | ${fact.unclear ?? 0} | ${fact.independentClusters} | ${fact.bodyBackedClusters} |`,
    ),
    "",
    "## 五、真实来源（可直接点开核对）",
    "",
    ...sources.map(
      (source) =>
        `- [${REL[source.relation] || source.relation} · ${source.site}](${source.url})「${source.title}」${source.bodyAvailable ? "（原文正文已取）" : "（仅搜索摘要）"}`,
    ),
    "",
    "## 六、人工修正记录",
    "",
    ...(corrections.length
      ? corrections.map((item2) => {
          const impact = item2.impact;
          const bits = [];
          if (impact) {
            if (impact.factBefore !== impact.factAfter)
              bits.push(`事实判断 ${REL[impact.factBefore] || impact.factBefore} → ${REL[impact.factAfter] || impact.factAfter}`);
            if (impact.supportsBefore !== impact.supportsAfter) bits.push(`支持来源 ${impact.supportsBefore} → ${impact.supportsAfter} 条`);
            if (impact.clustersBefore !== impact.clustersAfter) bits.push(`独立来源 ${impact.clustersBefore} → ${impact.clustersAfter} 个`);
            bits.push(
              impact.verdictBefore === impact.verdictAfter
                ? `结论类型未变（${OUTCOME[impact.verdictBefore] || impact.verdictBefore}）`
                : `结论类型 ${OUTCOME[impact.verdictBefore]} → ${OUTCOME[impact.verdictAfter]}`,
            );
          }
          return `- ${item2.actor} 将来源 ${item2.pageId} 修正为「${REL[item2.relation] || item2.relation}」${impact ? `（系统原判「${REL[impact.sourceBefore] || impact.sourceBefore}」）` : ""}：${item2.note}${bits.length ? `　影响：${bits.join("；")}` : ""}`;
        })
      : ["- 本次调查没有人工修正，全部关系由规则判断。"]),
    "",
    "## 七、尚未解决的问题",
    "",
    ...((item.assessment?.openQuestions || []).length
      ? item.assessment.openQuestions.map((text) => `- ${text}`)
      : ["- 本次结论没有遗留缺口。"]),
    "",
    "## 八、调查档案版本",
    "",
    ...(entry.versions.length
      ? entry.versions.map((version) => `- 第 ${version.revision} 版 · ${formatDate(version.at)} · ${version.actor}（${version.files.join("、")}）`)
      : ["- 本次调查尚无版本记录。"]),
    "",
    "## 九、页面截图",
    "",
    `- 调查过程页截图：\`delivery/materials/shots/${item.key}-case.png\``,
    `- 调查档案页截图：\`delivery/materials/shots/${item.key}-archive.png\``,
    "",
    "> 说明：本材料来自真实联网运行记录（腾讯云元宝搜索 SearchPro + 网页原文抓取）。公网页面是只读展示，不提供实时检索；需要自己提问请在本机运行 Runtime。",
    "",
  ];
  return lines.join("\n");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
