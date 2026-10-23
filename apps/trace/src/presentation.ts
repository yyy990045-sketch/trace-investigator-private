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
