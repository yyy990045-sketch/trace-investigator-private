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
  /** 去标签后的正文文本（已剔除导航/页脚等样板）；失败时为空串 */
  text: string;
  /** 去样板前整页文本长度，用于对比"抓到多少、正文占多少" */
  rawTextLength?: number;
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

/**
 * 去掉导航、菜单、页脚、登录提示等样板区块，只留可能的正文区域。
 * 先按语义标签与常见 class/id 命名切除，再优先取 <article>/<main>/正文容器。
 */
export function extractMainHtml(html: string) {
  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|form|nav|aside|footer|header)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|form|nav|aside|footer|header)\b[^>]*\/?>/gi, " ");
  // 常见样板区块（class/id 里带这些词的容器整块丢弃）
  cleaned = cleaned.replace(
    /<(div|section|ul|ol|dl|table|p|span)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:nav|menu|breadcrumb|crumb|footer|header|sidebar|side-bar|toolbar|share|social|related|recommend|copyright|login|signin|subscribe|advert|banner|popup|modal|comment)[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi,
    " ",
  );
  const candidates: string[] = [];
  for (const pattern of [
    /<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi,
    /<main\b[^>]*>([\s\S]*?)<\/main\s*>/gi,
    /<div\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:article|content|detail|main|body|text|zhengwen|TRS_Editor)[^"']*["'][^>]*>([\s\S]*?)<\/div\s*>/gi,
  ]) {
    for (const match of cleaned.matchAll(pattern)) candidates.push(match[1]);
  }
  // Statistical bulletins contain nested divs and tables. A lazy </div> match can
  // stop at the first inner block and silently discard the actual statistics.
  for (const open of cleaned.matchAll(/<div\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:article|content|detail|main|body|text|zhengwen|TRS_Editor)[^"']*["'][^>]*>/gi)) {
    const tags = /<\/?div\b[^>]*>/gi;
    tags.lastIndex = open.index! + open[0].length;
    let depth = 1, tag: RegExpExecArray | null;
    while ((tag = tags.exec(cleaned))) {
      depth += /^<\//.test(tag[0]) ? -1 : /\/>$/.test(tag[0]) ? 0 : 1;
      if (depth === 0) { candidates.push(cleaned.slice(open.index! + open[0].length, tag.index)); break; }
    }
  }
  if (candidates.length) {
    // 取文本量最大的候选块（多栏页面里正文通常最长）
    const best = candidates.sort((a, b) => htmlToText(b).length - htmlToText(a).length)[0];
    if (htmlToText(best).length >= 40) return best;
  }
  const body = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1];
  return body || cleaned;
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

/** Respect the page's encoding; unreadable bytes must not become original-text evidence. */
export function decodeSource(buffer: Uint8Array, contentType: string) {
  const prefix = Buffer.from(buffer.subarray(0, 4096)).toString("latin1");
  const charset = (value: string) => value.match(/(?:^|;)\s*charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
  const declared = charset(contentType);
  let meta: string | undefined;
  const declarations = prefix
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|title|textarea|xmp|iframe|noembed|noframes|noscript|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "");
  for (const tag of declarations.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attrs = new Map([...tag[0].matchAll(/\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)]
      .map((attr) => [attr[1].toLowerCase(), (attr[2] ?? attr[3] ?? attr[4]).trim()]));
    meta = attrs.get("charset") ||
      (attrs.get("http-equiv")?.toLowerCase() === "content-type" ? charset(attrs.get("content") || "") : undefined);
    if (meta) break;
  }
  const bom = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
    ? "utf-8"
    : buffer[0] === 0xff && buffer[1] === 0xfe
      ? "utf-16le"
      : buffer[0] === 0xfe && buffer[1] === 0xff
        ? "utf-16be"
        : undefined;
  const encoding = bom || declared || meta || "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(encoding, { fatal: true });
  } catch {
    throw Object.assign(new Error("页面声明的字符编码不受支持，未将内容作为原文证据。"), {
      code: "FETCH_CHARSET_UNSUPPORTED",
    });
  }
  try {
    return decoder.decode(buffer);
  } catch {
    throw Object.assign(new Error("页面字节与字符编码不符或正文被截断，未将乱码作为原文证据。"), {
      code: "FETCH_DECODE_FAILED",
    });
  }
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
      // Preserve response metadata even when decoding fails.
      Object.assign(base, { finalUrl: parsed.toString(), httpStatus: response.status, contentType, bytes: buffer.byteLength });
      const html = decodeSource(buffer, contentType);
      // 正文与样板分离：导航/页脚不应算作"取得的原文"。
      const text = htmlToText(extractMainHtml(html));
      const rawLength = htmlToText(html).length;
      return {
        ...base,
        finalUrl: parsed.toString(),
        ok: response.ok && text.length > 0,
        httpStatus: response.status,
        contentType,
        bytes: buffer.byteLength,
        rawTextLength: rawLength,
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
    const reason = error as Error & { code?: string; cause?: { code?: string } };
    const code = reason.cause?.code || reason.code || "FETCH_FAILED";
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      error: {
        code: aborted ? "FETCH_CANCELED" : code,
        message: aborted ? "原文抓取已取消。" : /SSL|TLS|CERT|EPROTO/.test(code)
          ? `目标站点的 TLS 连接失败（${code}）；未关闭证书验证，也未自动改用 HTTP。`
          : reason.message || "无法访问原文。",
      },
    };
  }
}
