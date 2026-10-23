/**
 * TRACE public investigation gateway (stateless Vercel Node Function).
 * Reuses the real SearchPro adapter and conservative evidence engine.
 *
 * This endpoint is deliberately disabled unless SearchPro, server-side rate limits,
 * an HMAC snapshot secret and a single allowed site origin are configured.
 * No external key, full fetched body or raw IP is ever returned to the browser.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  searchConfiguration, searchPro,
  type WebPage, type SearchAttempt,
} from "../services/runtime/adapters/trace/searchpro.ts";
import { fetchSource } from "../services/runtime/adapters/trace/fetch-source.ts";
import {
  groupSources, assessFact, aggregateCase, buildStatement, openQuestions,
  type AnalysablePage, type BodyEvidence,
} from "../services/runtime/adapters/trace/analyze.ts";

type Request = IncomingMessage & { body?: unknown };
type SavedPage = Pick<WebPage, "id" | "url" | "title" | "site" | "date" | "passage" | "score">;
type SavedBody = { id: string; text: string; ok: boolean; reprintMarkers: string[] };
type Round = { query: string; at: string; httpStatus: number | null; count: number; requestId: string | null; durationMs: number; error: string | null };
type Snapshot = { v: 1; claim: string; pages: SavedPage[]; bodies: SavedBody[]; rounds: Round[]; exp: number };

const DAILY_BUDGET = 100;
const HOURLY_BUDGET = 5;
const MAX_ROUNDS = 3;
const SIGNING_SECRET = () => (process.env.TRACE_SNAPSHOT_SECRET || "").trim();
const ALLOWED_ORIGIN = () => (process.env.TRACE_PUBLIC_ORIGIN || "").replace(/\/+$/, "").trim();
const redisUrl = () => (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "").trim();
const redisToken = () => (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();

export function liveReady() {
  const origin = ALLOWED_ORIGIN();
  let validOrigin = false;
  try {
    const u = new URL(origin);
    validOrigin = u.origin === origin && u.protocol === "https:";
  } catch {}
  return searchConfiguration().available &&
    SIGNING_SECRET().length >= 32 &&
    validOrigin &&
    /^https:\/\/[^/]+\.upstash\.io$/.test(redisUrl()) &&
    redisToken().length >= 12;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}
function sign(s: string) {
  return createHmac("sha256", SIGNING_SECRET()).update(s).digest("base64url");
}
function seal(snapshot: Snapshot) {
  const encoded = Buffer.from(JSON.stringify(snapshot), "utf8").toString("base64url");
  return encoded + "." + sign(encoded);
}
function unseal(value: string, claim: string): Snapshot {
  if (value.length > 110000) throw new Error("历史证据超过允许大小，请重新开始调查。");
  const parts = value.split(".");
  if (parts.length !== 2) throw new Error("历史证据缺少签名。");
  const expected = Buffer.from(sign(parts[0]));
  const actual = Buffer.from(parts[1]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("调查证据已被修改，无法继续追查。");
  const result = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Snapshot;
  if (result.v !== 1 || result.claim !== claim || !Array.isArray(result.pages) ||
      !Array.isArray(result.bodies) || !Array.isArray(result.rounds) || result.exp < Date.now() ||
      result.rounds.length >= MAX_ROUNDS || result.pages.length > 24 || result.bodies.length > 8)
    throw new Error("调查证据已经过期或达到追查次数限制。");
  return result;
}
async function readBody(req: Request): Promise<unknown> {
  if (req.body !== undefined) return req.body;
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const part of req) {
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
    total += bytes.length;
    if (total > 115000) throw new Error("请求过大。");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function scrub(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function redact(text: string) {
  return text
    .replace(/(?<![0-9a-fA-F])1[3-9]\d{9}(?![0-9a-fA-F])/g, "[手机号已隐去]")
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, "[证件号已隐去]");
}
async function budget(req: Request) {
  // Global cap is intentionally in addition to per-IP caps: spoofed IPs cannot escape daily spend limits.
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const ipHash = createHmac("sha256", SIGNING_SECRET()).update(ip).digest("hex").slice(0, 32);
  const day = Math.floor(Date.now() / 86400000);
  const hour = Math.floor(Date.now() / 3600000);
  const payload = [
    ["INCR", "trace:live:ip:" + ipHash + ":" + hour],
    ["EXPIRE", "trace:live:ip:" + ipHash + ":" + hour, 3700],
    ["INCR", "trace:live:global:" + day],
    ["EXPIRE", "trace:live:global:" + day, 90000],
  ];
  const response = await fetch(redisUrl() + "/pipeline", {
    method: "POST",
    headers: { authorization: "Bearer " + redisToken(), "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(4500),
  });
  if (!response.ok) throw new Error("公共调查额度服务暂时不可用。");
  const output = await response.json() as { result?: number; error?: string }[];
  if (!Array.isArray(output) || output.some((v) => v.error) ||
      typeof output[0]?.result !== "number" || typeof output[2]?.result !== "number")
    throw new Error("公共调查额度无法确认。");
  return output[0].result <= HOURLY_BUDGET && output[2].result <= DAILY_BUDGET;
}

function analyse(snapshot: Snapshot) {
  const pages: AnalysablePage[] = snapshot.pages.map((p) => ({
    id:p.id, url:p.url, site:p.site, title:p.title, date:p.date, passage:p.passage, score:p.score,
  }));
  const bodies = new Map<string, BodyEvidence>(snapshot.bodies.map((b) =>
    [b.id, { ok:b.ok, text:b.text, reprintMarkers:b.reprintMarkers }]));
  const grouping = groupSources(pages, bodies);
  const fact = assessFact({
    fact: { id:"fact-1", text:snapshot.claim, queries:snapshot.rounds.map((r)=>r.query) },
    pages, bodies, clusterOf:grouping.clusterOf,
    duplicatePages:new Set(grouping.duplicateOf.keys()), grouping,
  });
  const independentSources = new Set(pages
    .filter((p) => !grouping.duplicateOf.has(p.id) && !grouping.unconfirmed.has(p.id))
    .map((p) => grouping.clusterOf.get(p.id))).size;
  const bodyCount = snapshot.bodies.filter((b) => b.ok).length;
  const verdict = aggregateCase({
    facts:[fact],
    searchSummary:{
      total:snapshot.rounds.length,
      failed:snapshot.rounds.filter((r)=>!!r.error).length,
      empty:snapshot.rounds.filter((r)=>!r.error && r.count===0).length,
    },
    pageCount:pages.length, bodyCount, independentSourceCount:independentSources,
    searchedOk:snapshot.rounds.some((r)=>r.count>0 && !r.error),
  });
  // 开放式对照问题不能被当成一个真假断言；先展示各来源实际给出的数字。
  const compareQuestion = /为什么|为何|两组|两种说法|差异|不一样|不同|口径/.test(snapshot.claim) &&
    (snapshot.claim.match(/\d+(?:\.\d+)?/g) || []).filter((x) => Number(x) >= 100).length >= 2;
  const figures = [...new Map(fact.sources.flatMap((source) =>
    (source.quantityEvidence || []).map((f) => [f.statisticalSource + "|" + f.value + f.unit, {
      publisher:f.statisticalSource, value:f.value, unit:f.unit, sentence:redact(f.sentence).slice(0,230),
      scope:f.scope || "",url:f.url,from:f.from,year:f.year,
    }] as const),
  )).values()].slice(0, 8);
  const openQuestion = /^为什么|^为何|^如何|^怎么|^什么原因/.test(snapshot.claim.trim());
  const label = verdict.outcome === "supported" ? "有依据支持" :
    verdict.outcome === "contradicted" ? "存在反证" :
    verdict.outcome === "disputed" ? "来源存在争议" :
    verdict.outcome === "outdated" ? "时效尚未核实" : "证据不足";
  const sources = fact.sources
    .filter((s) => s.relevance > 0 || s.relation !== "irrelevant")
    .slice(0, 16).map((s) => ({
      id:s.pageId, url:s.url, site:s.site, title:s.title,
      relation:s.relation, sentence:s.keySentence || s.excerpt.slice(0, 220),
      scope:s.scopeNote || "", date:s.date,
      body:s.bodyStatus === "evidence_sentence",
      status:s.bodyStatus || "fetch_failed", origin:s.citedOrigin?.org || "",
      independence:s.independence, reasons:s.reasons.slice(0, 2),
    }));
  const comparison = compareQuestion && figures.length >= 2;
  const questionOnly = !comparison && openQuestion;
  const finalLabel = comparison ? "已找到不同来源的数据" : questionOnly ? "原因尚未查明" : label;
  const finalStatement = comparison
    ? `找到 ${figures.length} 组来自公开来源的数据。各组数字有其标注的发布方与原始链接；它们之间的具体差异原因尚未核实，不能凭数字不同就认定哪一方错误。`
    : questionOnly
      ? "这是一个需要解释原因的开放式问题。本轮已经列出检索得到的来源，但规则核验尚不能证明具体因果关系。可继续搜索官方原始解释。"
      : buildStatement(snapshot.claim, verdict);
  return {
    kind:comparison ? "comparison" : questionOnly ? "explanation" : "claim",
    figures, label:finalLabel, outcome:comparison||questionOnly?"insufficient":verdict.outcome,
    statement:finalStatement,
    reasons:comparison||questionOnly?[]:verdict.reasons.slice(0, 5),
    gaps:comparison?["两组数据为什么不同仍缺能说明统计范围、口径或计算方法的原始资料。"]:
      questionOnly?["仍缺直接解释因果关系的原始来源。"]:openQuestions([fact]),
    counts:{ pages:pages.length, bodies:bodyCount, keyEvidence:sources.filter((s)=>s.body).length,
      related:sources.length, independentSources },
    sources, rounds:snapshot.rounds,
  };
}

export async function investigate(body: unknown, dependencies: { search?: typeof searchPro; source?: typeof fetchSource } = {}) {
  const doSearch = dependencies.search || searchPro;
  const doSource = dependencies.source || fetchSource;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("请填写调查信息。");
  const input = body as Record<string, unknown>;
  const claim = scrub(input.claim, 400);
  const query = scrub(input.query, 120) || claim.slice(0, 120);
  if (claim.length < 6 || claim.length > 400 || query.length < 3 || query.length > 120)
    throw new Error("请填写6至400字的明确待核说法，以及不超过120字的检索词。");
  const snapshot = typeof input.snapshot === "string" && input.snapshot
    ? unseal(input.snapshot, claim)
    : {v:1 as const, claim, pages:[] as SavedPage[], bodies:[] as SavedBody[], rounds:[] as Round[], exp:Date.now()+30*60_000};
  // The query text originates from the user, never from model inference.
  const attempt: SearchAttempt = await doSearch(query, { maxAttempts:1, timeoutMs:13500 });
  const round: Round = {
    query, at:attempt.requestedAt, httpStatus:attempt.httpStatus,
    count:attempt.resultCount, requestId:attempt.requestId, durationMs:attempt.durationMs,
    error:attempt.error?.code || null,
  };
  const existing = new Set(snapshot.pages.map((p)=>p.url));
  const added = attempt.pages.filter((page)=>!existing.has(page.url)).slice(0, 8)
    .map((page) => ({ ...page, passage: redact(page.passage), title: redact(page.title) }));
  const pages = [...snapshot.pages, ...added].slice(0, 24);
  const bodies = [...snapshot.bodies];
  for (const page of added.slice(0,2)) {
    // Failed original-text fetch is recorded as absence of body, never synthetic text.
    const fetched = await doSource(page.url, { timeoutMs:4500, maxBytes:350000 });
    bodies.push({ id:page.id, text:fetched.ok?redact(fetched.text.slice(0,4800)):"",
      ok:fetched.ok, reprintMarkers:fetched.reprintMarkers });
  }
  const next: Snapshot = {
    v:1, claim, pages, bodies:bodies.slice(0,8),
    rounds:[...snapshot.rounds,round], exp:Math.min(snapshot.exp,Date.now()+30*60_000),
  };
  const result = analyse(next);
  const token = seal(next);
  if (token.length > 110000) throw new Error("本次证据较多，请缩小问题范围重新调查。");
  return { ...result, claim, snapshot:token,
    mayContinue:next.rounds.length<MAX_ROUNDS && !attempt.error?.code?.includes("UNAUTHORIZED"),
    rawStatus:attempt.error?attempt.error.message:null,
  };
}

export default async function handler(req: Request, res: ServerResponse) {
  if (req.method === "GET") {
    return send(res,200,{live:liveReady(), historyAvailable:true,
      reason:liveReady()?"可以开始真实元宝搜索。":"在线搜索尚未配置安全服务，历史调查仍可查看。"});
  }
  if (req.method !== "POST") return send(res,405,{error:"METHOD_NOT_ALLOWED"});
  const origin = String(req.headers.origin || "");
  if (!liveReady()) return send(res,503,{error:"LIVE_DISABLED",message:"在线调查尚未配置完整的密钥与额度控制，无法执行新搜索。"});
  if (origin !== ALLOWED_ORIGIN()) return send(res,403,{error:"ORIGIN_DENIED"});
  if (!(String(req.headers["content-type"] || "").startsWith("application/json")))
    return send(res,415,{error:"CONTENT_TYPE_REQUIRED"});
  try {
    const input = await readBody(req);
    if (!await budget(req)) return send(res,429,{error:"QUOTA_EXCEEDED",message:"当前匿名调查额度已用完，请稍后再试。"});
    const result = await investigate(input);
    return send(res,200,result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "调查失败。";
    const invalid = /请填写|超过|过期|大小|签名|无法继续|请求过大/.test(message);
    return send(res,invalid?400:503,{error:invalid?"INPUT_INVALID":"SEARCH_FAILED",message:invalid?message:"搜索或证据核验暂时不可用，请查看历史案例或稍后再试。"});
  }
}
