/**
 * 原文获取适配器：用于判断「来源是否为原始出处」「是否有充分原文依据」，
 * 以及「是否只有搜索摘要」。
 *
 * 安全边界：
 *  - 只允许 http/https；
 *  - 解析 DNS 后拒绝环回、私有网段、链路本地、IPv6 唯一本地地址（防 SSRF）；
 *  - 手动跟随最多 3 次重定向，每一跳都重新校验；
 *  - 限制响应字节数与总时长；只接受 text/html 与 text/plain。
 * 抓取失败不是异常，而是「无法访问原文」这一事实，必须如实记录。
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface SourceFetch {
  url: string;
  finalUrl: string;
  ok: boolean;
  httpStatus: number | null;
  contentType: string;
  bytes: number;
  /** 去标签后的正文文本；失败时为空串 */
  text: string;
  /** 页面内声明的标题 */
  title: string;
  /** 是否在正文中发现「转载/来源/原文链接」等二次传播标记 */
  reprintMarkers: string[];
  error: { code: string; message: string } | null;
  fetchedAt: string;
  durationMs: number;
}

function ipBlocked(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (isIP(address) === 6) {
    const v = address.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
    if (v.startsWith("::ffff:")) return ipBlocked(v.slice(7));
  }
  return false;
}

async function guard(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw Object.assign(new Error("仅允许 http/https 链接。"), { code: "FETCH_SCHEME_DENIED" });
  if (parsed.username || parsed.password)
    throw Object.assign(new Error("链接不允许携带凭证。"), { code: "FETCH_URL_DENIED" });
  if (parsed.hostname === "localhost")
    throw Object.assign(new Error("不允许抓取本机地址。"), { code: "FETCH_HOST_DENIED" });
  let records: { address: string }[];
  try {
    records = await lookup(parsed.hostname, { all: true });
  } catch {
    throw Object.assign(new Error("域名无法解析：" + parsed.hostname), { code: "FETCH_DNS_FAILED" });
  }
  if (!records.length || records.some((r) => ipBlocked(r.address)))
    throw Object.assign(new Error("目标地址解析到受限网段，已阻止抓取。"), { code: "FETCH_HOST_DENIED" });
  return parsed;
}

const REPRINT_PATTERNS = [
  "转载请注明",
  "转载自",
  "本文转载",
  "来源：",
  "来源:",
  "原文链接",
  "原文地址",
  "via ",
  "Source:",
  "本文来源",
];

export function detectReprintMarkers(text: string) {
  const found: string[] = [];
  for (const marker of REPRINT_PATTERNS) if (text.includes(marker)) found.push(marker.trim());
  return found;
}

export function extractTitle(html: string, fallback: string) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return og[1].trim();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return title[1].replace(/\s+/g, " ").trim() || fallback;
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return h1 ? h1[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || fallback : fallback;
}

export function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|br|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface FetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}

export async function fetchSource(url: string, options: FetchOptions = {}): Promise<SourceFetch> {
  const startedAt = Date.now();
  const fetchedAt = new Date(startedAt).toISOString();
  const configEnabled = process.env.PLATFORM_TRACE_FETCH_ENABLED !== "false";
  const timeoutMs =
    options.timeoutMs ?? Math.min(60000, Math.max(1000, Number(process.env.PLATFORM_TRACE_FETCH_TIMEOUT_MS) || 12000));
  const maxBytes =
    options.maxBytes ?? Math.min(8_000_000, Math.max(1000, Number(process.env.PLATFORM_TRACE_FETCH_MAX_BYTES) || 1_200_000));
  const base: SourceFetch = {
    url,
    finalUrl: url,
    ok: false,
    httpStatus: null,
    contentType: "",
    bytes: 0,
    text: "",
    title: "",
    reprintMarkers: [],
    error: null,
    fetchedAt,
    durationMs: 0,
  };
  if (!configEnabled)
    return { ...base, error: { code: "FETCH_DISABLED", message: "原文抓取已被配置关闭。" } };
  let current = url;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const parsed = await guard(current);
      const timer = AbortSignal.timeout(timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timer]) : timer;
      const response = await fetch(parsed, {
        redirect: "manual",
        signal,
        headers: {
          "user-agent": "TRACE-Investigation/0.1 (local evidence reader)",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location)
          return {
            ...base,
            httpStatus: response.status,
            durationMs: Date.now() - startedAt,
            error: { code: "FETCH_REDIRECT_INVALID", message: "重定向缺少 Location。" },
          };
        current = new URL(location, parsed).toString();
        continue;
      }
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (!/text\/html|text\/plain|application\/xhtml/.test(contentType))
        return {
          ...base,
          finalUrl: parsed.toString(),
          httpStatus: response.status,
          contentType,
          durationMs: Date.now() - startedAt,
          error: {
            code: "FETCH_UNSUPPORTED_TYPE",
            message: `该链接返回 ${contentType || "未知类型"}，不是可直接引用的网页正文。`,
          },
        };
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            await reader.cancel().catch(() => {});
            chunks.push(value.slice(0, Math.max(0, value.byteLength - (bytes - maxBytes))));
            break;
          }
          chunks.push(value);
        }
      }
      const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      const html = buffer.toString("utf8");
      const text = htmlToText(html);
      return {
        ...base,
        finalUrl: parsed.toString(),
        ok: response.ok && text.length > 0,
        httpStatus: response.status,
        contentType,
        bytes: buffer.byteLength,
        text: text.slice(0, 400_000),
        title: extractTitle(html, parsed.hostname),
        reprintMarkers: detectReprintMarkers(text.slice(0, 20_000)),
        durationMs: Date.now() - startedAt,
        error: response.ok
          ? text.length
            ? null
            : { code: "FETCH_EMPTY_BODY", message: "页面无可见正文（可能是脚本渲染页面）。" }
          : { code: "FETCH_HTTP_ERROR", message: `原文返回 HTTP ${response.status}，未取得正文。` },
      };
    }
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      error: { code: "FETCH_TOO_MANY_REDIRECTS", message: "重定向次数过多。" },
    };
  } catch (error) {
    const aborted = options.signal?.aborted === true;
    const reason = error as Error & { code?: string };
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      error: {
        code: aborted ? "FETCH_CANCELED" : reason.code || "FETCH_FAILED",
        message: aborted ? "原文抓取已取消。" : reason.message || "无法访问原文。",
      },
    };
  }
}
