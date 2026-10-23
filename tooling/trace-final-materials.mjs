/** Package completed investigation records for submission. No search/model requests. */
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { evidenceWording, sourceMaterial } from "../apps/trace/src/presentation.ts";

const root = "delivery/materials";
const site = "https://trace-showcase-eight.vercel.app";
const raw = await readFile("delivery/trace-showcase/showcase-data.js", "utf8");
const data = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
const titles = {
  A: "案例A·原始证据调查：个人信息保护法施行日期",
  B: "案例B·多来源交叉核查：2024年新能源汽车产量",
  C: "案例C·证据不足与继续追问：全国氢能重卡加氢网络",
  D: "案例D·模型辅助复核：民法典施行日期",
};
const outcome = { supported: "有依据支持", contradicted: "存在反证", disputed: "存在争议", outdated: "信息过期或原文不足", insufficient: "证据不足" };
const relation = { supports: "支持", contradicts: "反对", unclear: "无法确认", irrelevant: "无关", none: "无可用来源", mixed: "存在争议" };
await mkdir(join(root, "shots"), { recursive: true });
const boundary = "本材料为已完成真实调查的历史记录说明，不是此刻重新搜索或调用模型。事实拆解由人工完成，来源独立性未经证明。页面和说明校正旧系统措辞，不改写原始证据、原始模型返回和旧档案。原始档案保留当时文字，不应把“未检测到重复”理解为已证明相互独立。";
const links = (item) => ({ process: `${site}/#/cases/${item.runId}`, archive: `${site}/#/archive/${item.runId}` });
const sourceList = (sources) => sources.flatMap((s) => [
  `- [${s.title}](${s.url})`,
  `  ${s.site} · ${s.date || "发布时间未知"} · ${sourceMaterial(s)} · 规则关系：${relation[s.relation] || s.relation}`,
  `  摘录：${(s.bodyExcerpt || s.excerpt || "").slice(0, 260)}`,
]);

for (const item of data.cases) {
  const bundle = item.run.steps.find((step) => step.capabilityId === "trace.evidence.verify")?.output || {};
  const caseInfo = bundle.case || {};
  const a = item.assessment || {};
  const verdict = a.verdict || {};
  const facts = a.facts || [];
  const sources = [...new Map(facts.flatMap((f) => f.sources).map((s) => [s.pageId, s])).values()];
  const ranked = [...sources].filter((s) => s.relation !== "irrelevant").sort((a, b) => Number(b.bodyAvailable) - Number(a.bodyAvailable));
  const model = item.run.steps.find((step) => step.capabilityId === "model.verify" && step.status === "completed");
  const call = item.run.modelCalls?.find((c) => c.status === "completed");
  const verification = model?.output?.verification;
  const urls = links(item);
  const lines = [
    `# ${titles[item.key]}`, "", "溯证 TRACE · 1024侦探赛道 · 2026-10-23材料整合版", "",
    `- [调查过程](${urls.process})`, `- [调查档案](${urls.archive})`, `- 运行：${item.runId}`, "",
    "## 原始问题", "", caseInfo.question || caseInfo.claim, "", `待核查说法：${caseInfo.claim}`, "",
    "## 规则判断与依据", "", `**${outcome[verdict.outcome] || "未形成结论"}**`, "", evidenceWording(verdict.statement || ""), "",
    `检索 ${verdict.counts?.queries ?? 0} 次，命中 ${verdict.counts?.pages ?? 0} 条网页，取得 ${a.bodyAvailable ?? 0} 份网页正文；${a.independentSources ?? 0} 个来源簇未检测到重复。这些数量不代表已经证明来源独立。`, "",
    ...facts.flatMap((f) => [`- ${f.fact}：规则关系“${relation[f.relation]}”；支持${f.supports}、反对${f.contradicts}、无法确认${f.unclear || 0}、无关${f.irrelevant || 0}。`]), "",
    "## 调查说明", "",
    item.key === "C" ? "初始材料多为局部线路或氢走廊投运报道。追加全国覆盖检索并保留人工修正后，结论仍为证据不足。把局部投运标为支持的人工记录保留原样，但它不能证明全国网络已建成。" :
    item.key === "B" ? "比较同一年份的产量、销量与统计口径，来源若共同转引原机构发布的数据，不把网站数量当成多份独立证明。本案例没有被保留为相反关系的来源，不宣称真实冲突裁决已验收。" :
    item.key === "A" ? "围绕施行日期查找网页原文，保留规则原判、人工修正与版本记录。网页正文与搜索摘要分开标注，原始出处仍可逐条打开复核。" :
    "真实元宝搜索后，将问题、人工确认事实及真实摘录交给DeepSeek辅助复核。规则、模型意见和人工确认分别记录，不以规则通过替代模型返回。", "",
    "## 元宝搜索请求记录", "",
    ...(bundle.searches || []).map((s) => `- ${s.query}：HTTP ${s.httpStatus ?? "未知"}，返回${s.resultCount}条，耗时${s.durationMs}ms；RequestId ${s.requestId || "未记录"}。`),
    ...(item.run.evidence || []).filter((e) => e.kind === "trace.followup").map((e) => `- 追加：${e.data.query}；HTTP ${e.data.httpStatus}，返回${e.data.resultCount}条；RequestId ${e.data.requestId}。`), "",
    "## 来源与关键摘录", "", ...sourceList(ranked.slice(0, 5)), "",
    "## DeepSeek辅助语义复核", "",
    verification ? `真实调用：${call?.model || "以运行记录为准"}，${call?.durationMs ?? "未记录"}ms；实际返回${verification.citations.length}条引用。搜索与模型请求分别记录。` : "本案例未调用模型。不能用D案例的成功替代本案例的语义核验。", "",
    ...(verification ? ["以下为模型原始返回，未经改写：", "", verification.summary, "", "### 模型实际引用", "", ...verification.citations.flatMap((id) => {
      const c = model.output.citations.find((c) => c.id === id);
      return c ? [`- [${sources.find((s) => s.url === c.source)?.title || id}](${c.source})`, `  提供给模型的摘录：${c.excerpt}`] : [];
    })] : []), "",
    "## 人工确认与交付", "",
    ...item.run.approvals.filter((p) => p.status === "approved").map((p) => `- ${p.decidedAt}：${p.actor}。${p.actor?.includes("Codex") ? "本地验收，非用户本人签署。" : "填写值不是身份认证。"}`),
    `- 已交付${item.revisions.revisions.length}版；原始档案在在线档案页按版本下载。`,
    ...(a.corrections || []).map((c) => `- 人工修正：${c.actor}改为“${relation[c.relation]}”，原因：${c.note}。原始判断与证据保留。`), "",
    "## 缺口与功能限制", "",
    ...(a.openQuestions?.length ? a.openQuestions.map((q) => `- ${evidenceWording(q)}`) : ["- 规则未列出额外缺口，原始出处和来源依赖仍需人工核对。"]),
    "- 模型失败、超时、Schema异常和取消尚未逐项通过真实DeepSeek调用验收。事实拆解仍人工，追问或修正后不自动沿用旧模型意见。", "", boundary, "",
    "## 页面截图", "", `![调查过程](shots/${item.key}-case.png)`, "", `![调查档案](shots/${item.key}-archive.png)`, "",
  ];
  await writeDocument(titles[item.key], lines.join("\n"));
}

const c = data.cases.find((item) => item.key === "C");
const revisions = c.revisions.revisions;
const latest = revisions.at(-1);
const urls = links(c);
const followups = c.run.evidence.filter((e) => e.kind === "trace.followup");
await writeDocument("案例C·进阶调查报告：一条氢能说法为什么查不下去", [
  "# 案例C·进阶调查报告：一条氢能说法为什么查不下去", "", "2026-10-23 · 同版材料，历史记录回放", "",
  `- [调查过程](${urls.process})`, `- [在线档案：${revisions.length}个版本](${urls.archive})`, "",
  "## 调查目标与关键范围", "", "核查2025年中国是否已建成覆盖全国的氢能长途重卡加氢网络。年份、全国覆盖与已建成必须同时得到支持；某条干线或某个走廊投运无法证明完整主张。", "",
  "## 多步调查与版本变化", "",
  "| 版本 | 规则结论 | 未检测到重复的簇 | 网页正文 | 追加检索 | 人工修正 |",
  "| --- | --- | --- | --- | --- | --- |",
  ...revisions.map((r) => `| ${r.revision} | ${outcome[r.verdict?.outcome] || "记录"} | ${r.assessment?.independentSources ?? "未记录"} | ${r.assessment?.bodyAvailable ?? "未记录"} | ${r.followupCount} | ${r.correctionCount} |`), "",
  "计数是对应版本的规则记录；归并口径曾经调整，数量减少不能直接理解为证据消失，更不代表来源独立性已被证明。旧档案没有改写。", "",
  "## 实际追加检索", "", ...followups.map((e) => `- ${e.data.query}；返回${e.data.resultCount}条，RequestId ${e.data.requestId}。`), "",
  "## 人工修正保留与适用边界", "",
  ...(latest.assessment?.corrections || []).map((r) => `- ${r.actor}：改为“${relation[r.relation]}”，原因“${r.note}”。`),
  "其中对局部氢走廊投运的支持判断，是历史人工记录；它不能扩大成全国覆盖的证据。保留这条记录是为了复查人工判断，不宣称修正必然更准确。", "",
  "## 最新结论与仍缺什么", "", `第${latest.revision}版：${outcome[latest.verdict.outcome]}。`, "",
  ...(latest.assessment.openQuestions || []).map((q) => `- ${evidenceWording(q)}`), "",
  "需要与全国覆盖范围、建成时间直接对应的可访问原始资料；共同转引同一发布机构的报道不得简单重复计数。", "",
  "## 真实来源", "", ...sourceList(latest.assessment.facts.flatMap((f) => f.sources).filter((s) => s.relation !== "irrelevant").slice(0, 6)), "",
  "## 方法边界", "", "本C案例没有模型调用，DeepSeek能力展示在独立D案例中。", "", boundary, "",
  "## 当前页面", "", "![C档案](shots/C-archive.png)", "",
].join("\n"));
await copyFile("docs/2026-10-23-trace-final-submission.md", join(root, "投稿简介与功能限制.md"));
console.log("生成A/B/C/D与C进阶报告的Markdown/HTML；PDF由Ego打印同一HTML，截图来自本轮实际页面。");

async function writeDocument(title, markdown) {
  await writeFile(join(root, title + ".md"), markdown);
  const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const inline = (s) => esc(s).replace(/!\[([^\]]*)\]\((shots\/[^)]+)\)/g,'<img alt="$1" src="$2">').replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<a href="$2">$1</a>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  let table = false;
  const body = markdown.split("\n").map((line) => {
    if (line.startsWith("|")) {
      if (/^\|[\s:|\-]+\|$/.test(line)) return "";
      const open = table ? "" : "<table>"; table = true;
      return open + "<tr>" + line.slice(1,-1).split("|").map((c)=>`<td>${inline(c.trim())}</td>`).join("") + "</tr>";
    }
    const close = table ? "</table>" : ""; table = false;
    const heading = line.match(/^(#{1,3}) (.+)$/);
    if (heading) return close+`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
    return close + (line ? `<p>${inline(line)}</p>` : "");
  }).join("\n") + (table ? "</table>" : "");
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page{size:A4;margin:16mm 15mm}body{font-family:"PingFang SC",sans-serif;font-size:10pt;line-height:1.65;color:#202a34;max-width:760px;margin:24px auto}h1{font-size:21pt;line-height:1.35;color:#17577f}h2{font-size:13pt;margin-top:22pt;border-bottom:1px solid #ddd;padding-bottom:5pt;break-after:avoid}h3{font-size:11pt;break-after:avoid}p{margin:7pt 0;overflow-wrap:anywhere}a{color:#17577f;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:9pt}td{border:1px solid #ddd;padding:5pt}tr:first-child{background:#f2f5f7;font-weight:bold}tr{break-inside:avoid}img{width:100%;border:1px solid #ddd;break-inside:avoid}h2:last-of-type{break-before:auto}
  </style><body>${body}</body></html>`;
  await writeFile(join(root, title + ".html"), html);
}
