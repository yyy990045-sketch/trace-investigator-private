import type { SourceAssessment } from "./api";

/** Historical wording is clarified at render time; frozen records and downloads stay intact. */
export function evidenceWording(text: string) {
  return text
    .replace(/已排除同源转载/g, "已执行同源检测，来源独立性仍待核对")
    .replace(/相互独立的来源簇/g, "未检测到重复的来源簇")
    .replace(/独立来源簇|独立来源/g, "未检测到重复的来源簇")
    .replace(/独立证据/g, "归并后的证据")
    .replace(/无遗留缺口/g, "规则未列出额外缺口，原始出处仍需核对");
}

export function sourceMaterial(source: Pick<SourceAssessment, "bodyAvailable" | "originality"> & Partial<Pick<SourceAssessment, "citedOrigin">>) {
  if (!source.bodyAvailable) return "仅搜索摘要 · 原文未取得";
  if (source.originality === "reprint" || source.citedOrigin) return "二次报道或转载 · 正文已取";
  return source.originality === "original_candidate"
    ? "原始依据候选 · 出处未证实"
    : "网页正文 · 出处未确认";
}

export function statisticalScopePair(sources: SourceAssessment[]) {
  const observations = sources.filter((source) => source.relation === "supports" || source.relation === "contradicts").flatMap((source) => source.quantityEvidence || [])
    .filter((item) => !item.approximate && item.subject === "新能源汽车" && item.metric === "产量" && item.year === "2024" && item.unit === "万辆");
  const nbs = observations.find((item) => item.statisticalSource === "国家统计局" && item.scope.includes("规模以上") && item.from === "body");
  const caam = observations.find((item) => item.statisticalSource === "中国汽车工业协会" && item.publisher === "工业和信息化部" && item.from === "body");
  return nbs && caam ? { nbs, caam } : null;
}

/** Self-contained, printable card. Values and verbatim quotes come from bound observations. */
export function statisticalCardHtml(question: string, pair: NonNullable<ReturnType<typeof statisticalScopePair>>) {
  const escape = (s: unknown) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const conclusion = (r: string) => r === "supports" ? "支持超过1300万辆" : r === "contradicts" ? "未超过1300万辆" : "无法确认";
  const side = (item: typeof pair.nbs) => `<article><h2>${escape(item.statisticalSource)}</h2><strong>${escape(item.value)}<small>${escape(item.unit)}</small></strong><h3>${conclusion(item.relation)}</h3><p>${escape(item.scope)}</p><blockquote>${escape(item.sentence)}</blockquote><p class="context">年份依据：${escape(item.context)}<br>发布机构：${escape(item.publisher)}</p><a href="${escape(item.url)}">打开原始来源</a><div class="url">${escape(item.url)}</div></article>`;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>新能源汽车产量·统计口径对照</title><style>
  @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{margin:0;background:#edece7;color:#182634;font-family:"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:1180px;margin:28px auto;background:#fffdf7;padding:38px;border-top:7px solid #1e5c73}.brand{color:#1e5c73;font-size:14px;letter-spacing:2px}h1{font-size:29px;line-height:1.35;margin:14px 0 10px}.lead{color:#59636b;font-size:15px;margin-bottom:24px}.compare{display:grid;grid-template-columns:minmax(0,1fr) 130px minmax(0,1fr);gap:16px;align-items:stretch}article{padding:22px;background:white;border:1px solid #d7dedf;border-radius:14px}h2{font-size:20px;margin:0}strong{display:block;font-size:51px;margin:15px 0;color:#155d6d}small{font-size:17px;padding-left:8px}h3{font-size:18px;margin:0 0 15px}p{font-size:14px;line-height:1.65}blockquote{font-size:14px;line-height:1.65;margin:14px 0;padding:12px;background:#f4f5f0;border-left:3px solid #a8b9b2}.context{color:#657078;font-size:12px}a{color:#17577f}.url{font-size:10px;overflow-wrap:anywhere;margin-top:7px;color:#657078}.why{display:flex;flex-direction:column;justify-content:center;text-align:center;font-size:16px;line-height:1.8;color:#77551c}.why b{font-size:23px}.reason{margin:22px 0 0;padding:16px 20px;background:#172a35;color:white;font-size:16px;line-height:1.7;border-radius:10px}.note{font-size:12px;color:#687178;margin:14px 0 0}@media(max-width:760px){main{margin:0;padding:22px}.compare{grid-template-columns:1fr}.why{padding:6px}h1{font-size:24px}}@media print{body{background:white}main{margin:0;padding:18px;border-top-width:5px;max-width:none}h1{font-size:24px}.compare{grid-template-columns:minmax(0,1fr) 110px minmax(0,1fr)}article{padding:16px}strong{font-size:42px}p,blockquote{font-size:12px}.reason{font-size:14px}.note{font-size:10px}}
  </style><main><div class="brand">溯证 TRACE · 事实分水岭</div><h1>${escape(question)}</h1><p class="lead">同为2024年新能源汽车产量，统计来源与覆盖范围不能默认相同。</p><div class="compare">${side(pair.nbs)}<div class="why"><b>统计口径<br>不同</b><span>先明确来源<br>再比较门槛</span></div>${side(pair.caam)}</div><p class="reason">为什么答案不同：按国家统计局相关统计超过1300万辆，按中国汽车工业协会相关统计未超过。未指定统计口径时，不能给出统一的“是”或“否”，也不能据此判定任何一方错误。</p><p class="note">真实网页原文记录的静态对照；中汽协的具体企业覆盖边界原页未细列。约数“1300万辆左右”不能证明严格“超过1300万辆”。</p></main></html>`;
}
