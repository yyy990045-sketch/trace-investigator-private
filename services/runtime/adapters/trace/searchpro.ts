/**
 * 腾讯云元宝搜索（WSA）服务端适配器。
 *
 * 官方契约（https://cloud.tencent.com.cn/document/product/1806/130615）：
 *   POST https://api.wsa.cloud.tencent.com/SearchPro
 *   Authorization: Bearer sk-...
 *   Content-Type: application/json; charset=utf-8
 *   请求体：{"Query": "..."}
 *   响应体：{"Response": {"Pages": ["<JSON字符串>", ...], "Query": "...", "RequestId": "..."}}
 *
 * 关键事实：Pages 的每一项是被二次序列化的 JSON 字符串，含
 *   passage / score / date / title / url / site / images / favicon。
 * 因此这里必须做第二次 JSON.parse，不能把 Pages 当成对象数组。
 *
 * 本适配器只在 Runtime 侧运行：密钥只从进程环境读取，不写日志、不回传前端、不落盘。
 * 任何失败都返回显式状态码，绝不返回编造的网页。
 */
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

export const WSA_DEFAULT_ENDPOINT = "https://api.wsa.cloud.tencent.com/SearchPro";

export type SearchErrorCode =
  | "SEARCH_DISABLED"
  | "SEARCH_NOT_CONFIGURED"
  | "SEARCH_UNAUTHORIZED"
  | "SEARCH_NOT_OPENED"
  | "SEARCH_QUOTA_UNAVAILABLE"
  | "SEARCH_RATE_LIMITED"
  | "SEARCH_TIMEOUT"
  | "SEARCH_NETWORK_ERROR"
  | "SEARCH_PROVIDER_ERROR"
  | "SEARCH_RESPONSE_INVALID"
  | "SEARCH_CANCELED"
  | "SEARCH_LIMIT_PER_RUN"
  | "SEARCH_BUDGET_EXHAUSTED";

export interface WebPage {
  /** 检索命中的网页标题（来自服务商返回，非本地补造） */
  title: string;
  url: string;
  site: string;
  /** 服务商给出的发布时间，原样保留；缺失则为空串，不猜 */
  date: string;
  /** 摘要原文（passage），已去除内嵌 HTML 标签，未改写语义 */
  passage: string;
  score: number;
  /** 稳定标识：url + passage 摘要，用于同源/转载判定与去重 */
  id: string;
}

export interface SearchAttempt {
  provider: "tencent-wsa";
  query: string;
  endpoint: string;
  requestId: string | null;
  httpStatus: number | null;
  durationMs: number;
  attempts: number;
  resultCount: number;
  pages: WebPage[];
  error: { code: SearchErrorCode; message: string; retryable: boolean } | null;
  requestedAt: string;
}

export interface SearchConfiguration {
  available: boolean;
  provider: "tencent-wsa";
  /** 仅暴露主机名，便于验收核对，不暴露路径参数与密钥 */
  endpointHost: string;
  keySource: "process-env" | "missing";
  timeoutMs: number;
  maxAttempts: number;
  maxQueriesPerFact: number;
  topK: number;
  code?: SearchErrorCode;
  reason: string;
}

function intEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const value = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function apiKey() {
  return (process.env.PLATFORM_WSA_API_KEY || "").trim();
}

export function searchConfiguration(): SearchConfiguration {
  const enabled = process.env.PLATFORM_WSA_ENABLED !== "false";
  const endpoint = (process.env.PLATFORM_WSA_ENDPOINT || WSA_DEFAULT_ENDPOINT).trim();
  const timeoutMs = intEnv("PLATFORM_WSA_TIMEOUT_MS", 20000, 1000, 60000);
  const maxAttempts = intEnv("PLATFORM_WSA_MAX_ATTEMPTS", 3, 1, 5);
  const maxQueriesPerFact = intEnv("PLATFORM_WSA_MAX_QUERIES_PER_FACT", 3, 1, 5);
  const topK = intEnv("PLATFORM_WSA_TOP_K", 8, 1, 20);
  let endpointHost = "api.wsa.cloud.tencent.com";
  try {
    const u = new URL(endpoint);
    endpointHost = u.host;
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname)))
      return {
        available: false,
        provider: "tencent-wsa",
        endpointHost,
        keySource: apiKey() ? "process-env" : "missing",
        timeoutMs,
        maxAttempts,
        maxQueriesPerFact,
        topK,
        code: "SEARCH_NOT_CONFIGURED",
        reason: "元宝搜索地址必须是 HTTPS（或本机 HTTP 用于联调）。",
      };
  } catch {
    return {
      available: false,
      provider: "tencent-wsa",
      endpointHost,
      keySource: apiKey() ? "process-env" : "missing",
      timeoutMs,
      maxAttempts,
      maxQueriesPerFact,
      topK,
      code: "SEARCH_NOT_CONFIGURED",
      reason: "元宝搜索地址格式无效。",
    };
  }
  const base = {
    provider: "tencent-wsa" as const,
    endpointHost,
    keySource: apiKey() ? ("process-env" as const) : ("missing" as const),
    timeoutMs,
    maxAttempts,
    maxQueriesPerFact,
    topK,
  };
  if (!enabled)
    return { ...base, available: false, code: "SEARCH_DISABLED", reason: "PLATFORM_WSA_ENABLED=false，联网检索已被显式关闭。" };
  if (!apiKey())
    return {
      ...base,
      available: false,
      code: "SEARCH_NOT_CONFIGURED",
      reason:
        "未配置 PLATFORM_WSA_API_KEY。请把腾讯云元宝搜索服务密钥写入本机私密配置 .env.platform 后重启 Runtime；在此之前不执行联网检索，也不给出联网结论。",
    };
  return {
    ...base,
    available: true,
    reason: "腾讯云元宝搜索 SearchPro，密钥来自本机进程环境，仅服务端持有。",
  };
}

const ERROR_MAP: Record<string, { code: SearchErrorCode; retryable: boolean; message: string }> = {
  UnauthorizedOperation: {
    code: "SEARCH_UNAUTHORIZED",
    retryable: false,
    message: "元宝搜索鉴权失败：服务 API KEY 不正确或已被删除。",
  },
  ResourceNotFound: {
    code: "SEARCH_NOT_OPENED",
    retryable: false,
    message: "元宝搜索服务未开通：请先在腾讯云控制台开通服务。",
  },
  ResourceUnavailable: {
    code: "SEARCH_QUOTA_UNAVAILABLE",
    retryable: false,
    message: "元宝搜索额度不可用：账号欠费或额度耗尽，请检查控制台。",
  },
  RequestLimitExceeded: {
    code: "SEARCH_RATE_LIMITED",
    retryable: true,
    message: "元宝搜索触发频率限制。",
  },
  InvalidParameter: {
    code: "SEARCH_PROVIDER_ERROR",
    retryable: false,
    message: "元宝搜索拒绝该查询参数。",
  },
  InternalError: {
    code: "SEARCH_PROVIDER_ERROR",
    retryable: true,
    message: "元宝搜索服务端内部错误。",
  },
};

/** 去除检索摘要里的 HTML 标签与多余空白；不改写文字内容。 */
export function cleanPassage(raw: unknown) {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pageId(url: string, passage: string) {
  return "page_" + createHash("sha256").update(url + "\u0000" + passage.slice(0, 512)).digest("hex").slice(0, 16);
}

/**
 * Pages 的每项可能是 JSON 字符串，也可能（未来版本）是对象。
 * 两种都接受；解析失败的条目计入 malformed，不丢弃整次响应。
 */
export function decodePages(pages: unknown): { items: WebPage[]; malformed: number } {
  const items: WebPage[] = [];
  let malformed = 0;
  if (!Array.isArray(pages)) return { items, malformed };
  for (const entry of pages) {
    let obj: any = entry;
    if (typeof entry === "string") {
      try {
        obj = JSON.parse(entry);
      } catch {
        malformed++;
        continue;
      }
    }
    if (!obj || typeof obj !== "object") {
      malformed++;
      continue;
    }
    const url = typeof obj.url === "string" ? obj.url.trim() : "";
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      malformed++;
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      malformed++;
      continue;
    }
    const passage = cleanPassage(obj.passage);
    const title = cleanPassage(obj.title) || parsed.hostname;
    if (!passage) {
      malformed++;
      continue;
    }
    items.push({
      title,
      url: parsed.toString(),
      site: cleanPassage(obj.site) || parsed.hostname,
      date: typeof obj.date === "string" ? obj.date.trim() : "",
      passage,
      score: typeof obj.score === "number" && Number.isFinite(obj.score) ? obj.score : 0,
      id: pageId(parsed.toString(), passage),
    });
  }
  return { items, malformed };
}

export interface SearchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Runs immediately before every outbound HTTP attempt; a rejected guard is not retried. */
  beforeRequest?: () => void;
}

/**
 * 执行一次真实联网检索。永不抛出业务异常：失败体现在 attempt.error 上，
 * 让上层把「搜索失败/超时/限流/无结果」当成一等状态记录，而不是伪装成空结果。
 */
export async function searchPro(query: string, options: SearchOptions = {}): Promise<SearchAttempt> {
  const config = searchConfiguration();
  const startedAt = Date.now();
  const requestedAt = new Date(startedAt).toISOString();
  const base: SearchAttempt = {
    provider: "tencent-wsa",
    query,
    endpoint: config.endpointHost,
    requestId: null,
    httpStatus: null,
    durationMs: 0,
    attempts: 0,
    resultCount: 0,
    pages: [],
    error: null,
    requestedAt,
  };
  if (!config.available) {
    return {
      ...base,
      error: { code: config.code || "SEARCH_NOT_CONFIGURED", message: config.reason, retryable: false },
    };
  }
  const text = query.trim();
  if (!text)
    return {
      ...base,
      error: { code: "SEARCH_PROVIDER_ERROR", message: "空查询不会发起联网检索。", retryable: false },
    };
  const endpoint = (process.env.PLATFORM_WSA_ENDPOINT || WSA_DEFAULT_ENDPOINT).trim();
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const maxAttempts = options.maxAttempts ?? config.maxAttempts;
  let attempts = 0;
  let lastError: SearchAttempt["error"] = null;

  while (attempts < maxAttempts) {
    if (options.signal?.aborted)
      return {
        ...base,
        attempts,
        durationMs: Date.now() - startedAt,
        error: { code: "SEARCH_CANCELED", message: "检索已取消。", retryable: false },
      };
    options.beforeRequest?.();
    attempts++;
    const timer = AbortSignal.timeout(timeoutMs);
    const combined = options.signal ? AbortSignal.any([options.signal, timer]) : timer;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: "Bearer " + apiKey(),
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ Query: text }),
        signal: combined,
      });
      const raw = await response.text();
      let payload: any = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }
      const requestId =
        typeof payload?.Response?.RequestId === "string" ? payload.Response.RequestId : null;
      // 服务端错误：既可能是 HTTP 非 2xx，也可能是 200 + {"Error": {...}}
      const providerError = payload?.Error || payload?.Response?.Error;
      if (!response.ok || providerError) {
        const code = String(providerError?.Code || providerError?.code || "");
        const mapped = ERROR_MAP[code] || {
          code: (response.status === 401 || response.status === 403
            ? "SEARCH_UNAUTHORIZED"
            : response.status === 429
              ? "SEARCH_RATE_LIMITED"
              : "SEARCH_PROVIDER_ERROR") as SearchErrorCode,
          retryable: response.status === 429 || response.status >= 500,
          message:
            (typeof providerError?.Message === "string" && providerError.Message) ||
            `元宝搜索返回 HTTP ${response.status}。`,
        };
        lastError = { code: mapped.code, message: mapped.message, retryable: mapped.retryable };
        if (!mapped.retryable || attempts >= maxAttempts) {
          return { ...base, requestId, httpStatus: response.status, attempts, durationMs: Date.now() - startedAt, error: lastError };
        }
        await sleep(300 * 2 ** (attempts - 1), undefined, { signal: options.signal });
        continue;
      }
      if (!payload || typeof payload !== "object" || !payload.Response)
        return {
          ...base,
          requestId,
          httpStatus: response.status,
          attempts,
          durationMs: Date.now() - startedAt,
          error: {
            code: "SEARCH_RESPONSE_INVALID",
            message: "元宝搜索响应缺少 Response 字段，无法确认为真实结果。",
            retryable: false,
          },
        };
      const { items, malformed } = decodePages(payload.Response.Pages);
      return {
        ...base,
        requestId,
        httpStatus: response.status,
        attempts,
        durationMs: Date.now() - startedAt,
        resultCount: items.length,
        pages: items.slice(0, config.topK),
        error:
          items.length === 0
            ? {
                code: "SEARCH_PROVIDER_ERROR",
                message:
                  malformed > 0
                    ? `响应中 ${malformed} 条结果无法解析，未获得可用网页。`
                    : "该查询没有返回任何网页。",
                retryable: false,
              }
            : null,
      };
    } catch (error) {
      const aborted = options.signal?.aborted === true;
      const timedOut = timer.aborted && !aborted;
      lastError = aborted
        ? { code: "SEARCH_CANCELED", message: "检索已取消。", retryable: false }
        : timedOut
          ? { code: "SEARCH_TIMEOUT", message: `检索超过 ${timeoutMs}ms 未返回。`, retryable: attempts < maxAttempts }
          : {
              code: "SEARCH_NETWORK_ERROR",
              message: "无法连接元宝搜索：" + (error instanceof Error ? error.message : "网络错误"),
              retryable: attempts < maxAttempts,
            };
      if (!lastError.retryable || attempts >= maxAttempts)
        return { ...base, attempts, durationMs: Date.now() - startedAt, error: lastError };
      await sleep(300 * 2 ** (attempts - 1), undefined, { signal: options.signal });
    }
  }
  return { ...base, attempts, durationMs: Date.now() - startedAt, error: lastError };
}
