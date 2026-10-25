/**
 * 输入导入：把「截图里的文字」「粘贴的分享文案/链接」变成待核查的说法。
 *
 * 边界（与产品口径一致）：
 *  - 这里只负责**读出说法**，不判断真假；真假一律交给现有元宝搜索 + 证据判定链路。
 *  - 识别/提取出来的文字一律标记为「尚未核实」，用户必须能改。
 *  - 链接本身不是断言：只有从链接或分享文案里提取到的文字才能提交调查。
 *
 * 本文件只放纯函数，不碰 DOM、不引第三方库，方便直接单测。
 */

/** 单张图片上限 5MB（超出直接拒绝，不做静默压缩）。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 识别的文字超过这个长度就不自动填入，由用户自己挑要核查的那句。 */
export const MAX_INVESTIGATION_CHARS = 500;
/** 允许的图片类型：只看浏览器给出的 MIME。 */
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type ImportSource = "manual" | "screenshot" | "share" | "page";

export const importSourceLabel: Record<ImportSource, string> = {
  manual: "",
  screenshot: "从截图识别，尚未核实",
  share: "来自分享文案，尚未核实",
  page: "来自网页正文，尚未核实",
};

export interface ImageCheck {
  ok: boolean;
  reason?: string;
}

/**
 * 上传前的本地检查：类型 + 大小 + 基本完整性。
 * 只做本地判断，不上传原图，也不做任何隐式转换。
 */
export function checkImage(file: {
  type?: string;
  size?: number;
  name?: string;
}): ImageCheck {
  const type = String(file.type || "").toLowerCase();
  const size = Number(file.size || 0);
  if (size <= 0) return { ok: false, reason: "这个文件是空的，换一张截图再试。" };
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(type))
    return {
      ok: false,
      reason: "只支持 PNG、JPG、WebP 截图。当前文件类型是 " + (type || "未知") + "。",
    };
  if (size > MAX_IMAGE_BYTES)
    return {
      ok: false,
      reason: `图片 ${(size / 1024 / 1024).toFixed(1)}MB 超过 5MB 上限，请裁剪或压缩后再上传。`,
    };
  return { ok: true };
}

/** 文本里出现的所有链接（去重、保留原始顺序）。 */
export function extractUrls(text: string): string[] {
  const found = String(text || "").match(/https?:\/\/[^\s<>"'）)】\]]+/gi) || [];
  return [...new Set(found.map((url) => url.replace(/[.,，。、]+$/, "")))];
}

/** 抖音及其短链域名（含 v.douyin.com）。 */
const DOUYIN_HOSTS = /(^|\.)(douyin\.com|iesdouyin\.com)$/i;

export function isDouyinUrl(url: string): boolean {
  try {
    return DOUYIN_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** 各平台分享时自动带上的引导语。按最长优先匹配，避免「复制打开抖音」先命中。 */
const GUIDE_PHRASES = [
  "复制此链接，打开抖音搜索，直接观看视频",
  "复制此链接打开抖音，看看这条视频",
  "复制打开抖音，看看这条视频",
  "复制此链接，打开抖音",
  "复制打开抖音",
  "打开抖音搜索",
  "直接观看视频",
  "看看这条视频",
  "看看这条",
  "复制此链接",
  "复制打开快手",
  "复制打开小红书",
  "打开抖音",
  "打开快手",
  "打开小红书",
  "抖音搜索",
  "抖音短视频",
  "快手短视频",
  "小红书",
  "抖音",
  "快手",
  "微视",
];

/**
 * 分享文案里除掉链接、平台引导语和话题标签，剩下的才是用户真正看到的说法。
 * 例如「复制打开抖音，看看这条视频…某种食品反复加热会产生某种物质…
 * https://v.douyin.com/xxxx」→ 只留中间那句。
 */
export function parsePastedShare(text: string): {
  statement: string;
  urls: string[];
  douyin: boolean;
} {
  const urls = extractUrls(text);
  let statement = String(text || "");
  for (const url of urls) statement = statement.split(url).join(" ");
  // 只删平台自己加的固定引导语，按最长优先；不做「吃掉整句」的贪婪匹配，
  // 否则一行到底的分享文案会把用户真正想核查的那句话一起吞掉。
  for (const phrase of GUIDE_PHRASES) statement = statement.split(phrase).join(" ");
  statement = statement
    .replace(/#[^#\s]{1,30}#?/g, " ")
    .replace(/[【\[][^】\]]{0,24}[】\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:：,，.。、;；!！?？-]+|[\s:，、;：!！?？.。-]+$/g, "")
    .trim();
  return { statement, urls, douyin: urls.some(isDouyinUrl) };
}

/**
 * 去掉汉字之间的空格。
 *
 * Tesseract 识别中文时会把每个字当成一个「词」，输出「家 庭 群 老 张」这种
 * 逐字空格；直接拿去检索会把整句拆碎。这里只删「汉字/中文标点」之间的空格，
 * 英文单词之间、数字与单位之间的空格保持不动。
 */
function despaceCjk(text: string): string {
  const CJK = "\\u4e00-\\u9fa5\\u3000-\\u303f\\uff00-\\uffef";
  return (
    text
      // 汉字与汉字之间
      .replace(new RegExp(`([${CJK}])[ \\t]+(?=[${CJK}])`, "g"), "$1")
      // 汉字与数字之间（「自 2021 年」→「自2021年」），英文单词之间的空格不动
      .replace(new RegExp(`([${CJK}])[ \\t]+(?=[0-9])`, "g"), "$1")
      .replace(new RegExp(`([0-9])[ \\t]+(?=[${CJK}])`, "g"), "$1")
      // 汉字两侧的英文标点（「家庭群 . 老张」→「家庭群.老张」）
      .replace(new RegExp(`([${CJK}])[ \\t]+([.,!?;:])[ \\t]+(?=[${CJK}])`, "g"), "$1$2")
  );
}

/** OCR 文本清洗：全角空格、逐字空格、行尾空白、连续空行，不改变字词内容。 */
export function normalizeOcrText(raw: string): string {
  return despaceCjk(
    String(raw || "")
      .replace(/\u3000/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " "),
  )
    .replace(/[ \t]+([，。、；：？！）》”])/g, "$1")
    .replace(/([（《“])[ \t]+/g, "$1")
    .trim();
}

/**
 * OCR 文本能不能直接填进调查框。
 * 超过上限时**不做静默截断**：返回候选句子，让用户自己挑要核查的那一句。
 */
/**
 * 候选句排序：网页正文常把导航、字号、来源、时间混在第一段里。
 *
 * 只做「挑选」，不改原文：更像一句完整说法的排前面（有中文句末标点、
 * 长度适中、少像导航词），纯导航/工具条文字沉到后面。识别文本本身不改写。
 */
export function rankCandidates(lines: string[]): string[] {
  const navigation = /浏览字号|打印本页|关闭窗口|分享到|责任编辑|来源[:：]|上一篇|下一篇|返回顶部|收藏本站|版权所有|京ICP/i;
  const score = (line: string) => {
    let value = 0;
    if (/[。！？!?]/.test(line)) value += 4;
    if (line.length >= 20 && line.length <= 200) value += 3;
    if (line.length > 200) value -= 2;
    if (navigation.test(line)) value -= 5;
    if (/^[\d\s.,，、:：%-]+$/.test(line)) value -= 3;
    return value;
  };
  return [...lines]
    .map((line, index) => ({ line, index, score: score(line) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 12)
    .map((item) => item.line);
}

export function planOcrInsertion(raw: string): {
  text: string;
  needChoice: boolean;
  candidates: string[];
} {
  const text = normalizeOcrText(raw);
  if (text.length <= MAX_INVESTIGATION_CHARS)
    return { text, needChoice: false, candidates: [] };
  const candidates = rankCandidates(
    text
      .split(/\n+|(?<=[。！？!?])/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length >= 6),
  );
  return { text, needChoice: true, candidates };
}

/**
 * 把选中的图片压成可上传的 dataURL。
 *
 * 只做等比缩放（最长边 1600px）与 JPEG 质量压缩，不裁切、不改内容：
 * 目的是把 5MB 的上传上限用在「够清楚」上，而不是原封不动传一张 4000px 的图。
 */
/** 大图的 base64 必须分块拼，直接 spread 上百万字节会爆调用栈。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function fileToUploadDataUrl(
  file: File | Blob,
  options: { maxSide?: number; quality?: number } = {},
): Promise<{ dataUrl: string; mime: string; bytes: number }> {
  const maxSide = options.maxSide ?? 1600;
  const quality = options.quality ?? 0.85;
  const type = "image/jpeg";
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    const buffer = await (file as Blob).arrayBuffer();
    const base64 = bytesToBase64(new Uint8Array(buffer));
    return { dataUrl: `data:${type};base64,${base64}`, mime: type, bytes: buffer.byteLength };
  }
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  const ratio = Math.min(1, maxSide / Math.max(1, longest));
  const width = Math.max(1, Math.round(bitmap.width * ratio));
  const height = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器不支持图片预处理。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((value) => resolve(value), type, quality),
  );
  if (!blob) throw new Error("图片预处理失败，请换一张截图。");
  const buffer = await blob.arrayBuffer();
  const base64 = bytesToBase64(new Uint8Array(buffer));
  return { dataUrl: `data:${type};base64,${base64}`, mime: type, bytes: buffer.byteLength };
}

/** 识别质量太差时的判断：几乎没有汉字/字母就当作识别失败，禁止拿去调查。 */
export function looksUnreadable(text: string): boolean {
  const compact = String(text || "").replace(/\s+/g, "");
  if (compact.length < 6) return true;
  const meaningful = (compact.match(/[\u4e00-\u9fa5A-Za-z0-9]/g) || []).length;
  return meaningful / compact.length < 0.5;
}

/** 提交前的最后一道本地检查：太短或只是链接都不允许直接调查。 */
export function validateForInvestigation(text: string): ImageCheck {
  const value = String(text || "").trim();
  if (value.length < 4) return { ok: false, reason: "至少要 4 个字才能调查。" };
  if (extractUrls(value).length && extractUrls(value)[0].length >= value.replace(/\s/g, "").length - 2)
    return {
      ok: false,
      reason: "链接本身不是待核查的说法，请把视频或页面里那句话复制进来。",
    };
  return { ok: true };
}
