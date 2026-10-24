/**
 * 公网受控服务层。
 *
 * 目标：把同一套 Runtime 安全地放到公网，而不是把本机开发环境暴露出去。
 *
 * 做四件事，且只做这四件：
 *  1. 匿名会话：访问者先领一个会话令牌，调查记录按会话隔离，互相读不到；
 *  2. 配额：每个会话每天最多几次调查、每个 IP 每天最多几次、同时只能跑一个；
 *  3. 搜索预算：每次调查的检索上限 + 全站每天检索总量上限，超出直接拒绝，不静默降级；
 *  4. 可观测：健康、配额、用量与失败统计，便于判断服务是否可用。
 *
 * 没有公网模式（PLATFORM_PUBLIC!=1）时全部关闭，本机开发行为保持不变。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ExecutionError } from "./contracts.ts";
import { now } from "./util.ts";
import type { Store } from "./store.ts";
import type { Engine } from "./engine.ts";

export interface TraceSession {
  id: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
}

function intEnv(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(raw)));
}

let activeGuard: Guard | null = null;

export function publicMode() {
  return process.env.PLATFORM_PUBLIC === "1";
}

export const limits = () => ({
  /** 同一会话每天的调查次数 */
  sessionRunsPerDay: intEnv("PLATFORM_SESSION_RUNS_PER_DAY", 3, 1, 50),
  /** 同一 IP 每天的调查次数（防止刷会话） */
  ipRunsPerDay: intEnv("PLATFORM_IP_RUNS_PER_DAY", 6, 1, 100),
  /** 同一会话同时运行的调查数 */
  sessionConcurrentRuns: intEnv("PLATFORM_SESSION_CONCURRENT_RUNS", 1, 1, 5),
  /** 单次调查最多调用几次检索 */
  runMaxSearches: intEnv("PLATFORM_RUN_MAX_SEARCHES", 8, 1, 40),
  /** 全站每天检索总量（成本闸门） */
  dailySearchBudget: intEnv("PLATFORM_DAILY_SEARCH_BUDGET", 300, 1, 100000),
  /** 单次调查最长运行时间，到点自动取消 */
  runTimeoutMs: intEnv("PLATFORM_RUN_TIMEOUT_MS", 300_000, 30_000, 1_800_000),
  /** 公网等待人工确认的最长时间，避免遗弃任务永久挂起 */
  approvalWaitTimeoutMs: intEnv("PLATFORM_APPROVAL_WAIT_TIMEOUT_MS", 1_800_000, 300_000, 86_400_000),
  /** 每会话每分钟请求数 */
  requestsPerMinute: intEnv("PLATFORM_REQUESTS_PER_MINUTE", 60, 5, 600),
  /** 每个 IP 每小时可领的会话数 */
  sessionsPerHourPerIp: intEnv("PLATFORM_SESSIONS_PER_HOUR_PER_IP", 10, 1, 200),
  /** 全站每天调查次数 */
  /** 全站每天调查次数 */
  dailyRunBudget: intEnv("PLATFORM_DAILY_RUN_BUDGET", 100, 1, 10000),
  /** 会话绝对期限（小时）：到点即失效，刷新不会延长 */
  sessionMaxHours: intEnv("PLATFORM_SESSION_MAX_HOURS", 72, 1, 2160),
  /** 会话闲置期限（分钟）：长时间不用即失效 */
  sessionIdleMinutes: intEnv("PLATFORM_SESSION_IDLE_MINUTES", 720, 10, 20160),
});

/** 会话期限在读取时即时求值，改配置不必重启进程。 */
const sessionMaxMs = () => limits().sessionMaxHours * 3_600_000;
const sessionIdleMs = () => limits().sessionIdleMinutes * 60_000;

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function hourKey(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sameSecret(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface SessionQuota {
  runsToday: number;
  runsLimit: number;
  searchesToday: number;
  searchBudget: number;
  concurrentLimit: number;
}

export interface Guard {
  /** 建会话（POST /v1/session） */
  createSession(ip: string, userAgent: string): { token: string; session: TraceSession; quota: SessionQuota };
  /** 读会话（令牌 -> 会话），过期/撤销返回 null */
  sessionOf(token: string | undefined): TraceSession | null;
  /** 会话配额与今日用量 */
  quotaOf(session: TraceSession): SessionQuota;
  /** 新调查前的配额检查：会话/ IP / 全站 / 并发 */
  assertInvestigationAllowed(session: TraceSession, ip: string): void;
  /** 登记一次调查（建运行成功后调用） */
  recordInvestigation(runId: string, session: TraceSession, ip: string): void;
  /** 检索前的预算检查：单次调查上限 + 全站每日上限 */
  reserveSearch(runId: string): { used: number; runLimit: number; dayUsed: number; dayLimit: number };
  /** 运行超时时间 */
  runTimeoutMs: number;
  /** 统计 */
  metrics(): Record<string, unknown>;
}

export function createGuard(store: Store): Guard {
  const limit = limits();

  function bumpDaily(scope: string, scopeKey: string, metric: string, amount = 1) {
    const day = dayKey();
    const at = now();
    const row = store.get(
      "SELECT count FROM usage_daily WHERE day=? AND scope=? AND scope_key=? AND metric=?",
      day,
      scope,
      scopeKey,
      metric,
    );
    const next = Number(row?.count || 0) + amount;
    store.exec(
      "INSERT INTO usage_daily(day,scope,scope_key,metric,count,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(day,scope,scope_key,metric) DO UPDATE SET count=excluded.count,updated_at=excluded.updated_at",
      day,
      scope,
      scopeKey,
      metric,
      next,
      at,
    );
    return next;
  }

  function dailyCount(scope: string, scopeKey: string, metric: string) {
    return Number(
      store.get(
        "SELECT count FROM usage_daily WHERE day=? AND scope=? AND scope_key=? AND metric=?",
        dayKey(),
        scope,
        scopeKey,
        metric,
      )?.count || 0,
    );
  }

  function quotaOf(session: TraceSession) {
    return {
      runsToday: dailyCount("session", session.id, "investigation"),
      runsLimit: limit.sessionRunsPerDay,
      searchesToday: dailyCount("global", "all", "search"),
      searchBudget: limit.dailySearchBudget,
      concurrentLimit: limit.sessionConcurrentRuns,
    };
  }

  function createSession(ip: string, userAgent: string) {
    const hour = hourKey();
    const issued = Number(
      store.get(
        "SELECT count FROM usage_daily WHERE day=? AND scope='ip' AND scope_key=? AND metric='session'",
        hour,
        ip,
      )?.count || 0,
    );
    if (issued >= limit.sessionsPerHourPerIp)
      throw new ExecutionError(
        "SESSION_RATE_LIMITED",
        "这个网络刚刚建立的会话太多，请过一会儿再试。",
      );
    const token = "ts_" + randomBytes(24).toString("base64url");
    const id = "ses_" + randomBytes(9).toString("hex");
    const at = now();
    store.exec(
      "INSERT INTO web_sessions(id,token_hash,ip,user_agent,created_at,last_seen_at,revoked) VALUES(?,?,?,?,?,?,0)",
      id,
      tokenHash(token),
      ip.slice(0, 80),
      userAgent.slice(0, 200),
      at,
      at,
    );
    // 会话签发按小时记在 usage_daily 里，进程重启后仍然有效。
    const hourRow = store.get(
      "SELECT count FROM usage_daily WHERE day=? AND scope='ip' AND scope_key=? AND metric='session'",
      hour,
      ip,
    );
    store.exec(
      "INSERT INTO usage_daily(day,scope,scope_key,metric,count,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(day,scope,scope_key,metric) DO UPDATE SET count=excluded.count,updated_at=excluded.updated_at",
      hour,
      "ip",
      ip,
      "session",
      Number(hourRow?.count || 0) + 1,
      at,
    );
    const session = { id, ip, createdAt: at, lastSeenAt: at };
    return { token, session, quota: quotaOf(session) };
  }

  function sessionOf(token: string | undefined): TraceSession | null {
    const raw = (token || "").trim();
    if (!raw || raw.length > 200) return null;
    const row = store.get(
      "SELECT id,ip,created_at,last_seen_at,revoked FROM web_sessions WHERE token_hash=?",
      tokenHash(raw),
    );
    if (!row || Number(row.revoked) === 1) return null;
    // 服务端期限：Cookie 的 Max-Age 只是浏览器侧提示，客户端可以一直留着不放；
    // 真正的失效判定必须在这里做——绝对期限不能因为刷新而无限延长。
    const created = Date.parse(String(row.created_at || ""));
    const lastSeen = Date.parse(String(row.last_seen_at || ""));
    const expired =
      (Number.isFinite(created) && Date.now() - created > sessionMaxMs()) ||
      (Number.isFinite(lastSeen) && Date.now() - lastSeen > sessionIdleMs());
    if (expired) {
      store.exec("UPDATE web_sessions SET revoked=1 WHERE id=?", row.id);
      return null;
    }
    store.exec(
      "UPDATE web_sessions SET last_seen_at=? WHERE id=?",
      now(),
      row.id,
    );
    return {
      id: row.id,
      ip: row.ip,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  function activeRunsOf(sessionId: string) {
    return Number(
      store.get(
        "SELECT COUNT(*) AS n FROM runs WHERE owner=? AND status IN ('queued','running','cancel_requested')",
        sessionId,
      )?.n || 0,
    );
  }

  function assertInvestigationAllowed(session: TraceSession, ip: string) {
    const quota = quotaOf(session);
    if (quota.runsToday >= quota.runsLimit)
      throw new ExecutionError(
        "QUOTA_EXCEEDED",
        `这个会话今天已经发起 ${quota.runsToday} 次调查，达到上限 ${quota.runsLimit} 次。明天再来，或先查看已完成的调查。`,
      );
    if (dailyCount("ip", ip, "investigation") >= limit.ipRunsPerDay)
      throw new ExecutionError(
        "IP_QUOTA_EXCEEDED",
        "这个网络今天的调查次数已达上限，请明天再试。",
      );
    if (dailyCount("global", "all", "investigation") >= limit.dailyRunBudget)
      throw new ExecutionError(
        "SERVICE_QUOTA_EXCEEDED",
        "今天全站调查名额已用完，请明天再试。",
      );
    if (activeRunsOf(session.id) >= limit.sessionConcurrentRuns)
      throw new ExecutionError(
        "RUN_ALREADY_ACTIVE",
        "你还有一个调查正在运行，等它结束或取消后再发起新的。",
      );
    if (dailyCount("global", "all", "search") >= limit.dailySearchBudget)
      throw new ExecutionError(
        "SEARCH_BUDGET_EXHAUSTED",
        "今天全站检索额度已用完，暂时无法发起新的联网调查。",
      );
  }

  function recordInvestigation(runId: string, session: TraceSession, ip: string) {
    store.exec(
      "UPDATE runs SET owner=? WHERE id=? AND (owner IS NULL OR owner=?)",
      session.id,
      runId,
      session.id,
    );
    bumpDaily("session", session.id, "investigation");
    bumpDaily("ip", ip, "investigation");
    bumpDaily("global", "all", "investigation");
    store.exec(
      "INSERT INTO search_usage(run_id,count,updated_at) VALUES(?,0,?) ON CONFLICT(run_id) DO NOTHING",
      runId,
      now(),
    );
  }

  function reserveSearch(runId: string) {
    if (!publicMode())
      return {
        used: 0,
        runLimit: limit.runMaxSearches,
        dayUsed: 0,
        dayLimit: limit.dailySearchBudget,
      };
    const dayUsed = dailyCount("global", "all", "search");
    const row = store.get("SELECT count FROM search_usage WHERE run_id=?", runId);
    const used = Number(row?.count || 0);
    if (used >= limit.runMaxSearches)
      throw new ExecutionError(
        "SEARCH_LIMIT_PER_RUN",
        `本次调查的检索次数已达上限（${limit.runMaxSearches} 次），继续检索会超出成本限制；请基于已取得的证据判断，或发起一次更聚焦的新调查。`,
      );
    if (dayUsed >= limit.dailySearchBudget)
      throw new ExecutionError(
        "SEARCH_BUDGET_EXHAUSTED",
        `今天全站检索额度（${limit.dailySearchBudget} 次）已用完，暂时无法继续检索。`,
      );
    const next = used + 1;
    store.exec(
      "INSERT INTO search_usage(run_id,count,updated_at) VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET count=excluded.count,updated_at=excluded.updated_at",
      runId,
      next,
      now(),
    );
    bumpDaily("global", "all", "search");
    return {
      used: next,
      runLimit: limit.runMaxSearches,
      dayUsed: dayUsed + 1,
      dayLimit: limit.dailySearchBudget,
    };
  }

  function metrics() {
    const day = dayKey();
    const runsToday = Number(
      store.get("SELECT COUNT(*) AS n FROM runs WHERE created_at>=?", day + "T00:00:00")?.n || 0,
    );
    const byStatus = store.all(
      "SELECT status, COUNT(*) AS n FROM runs WHERE created_at>=? GROUP BY status",
      day + "T00:00:00",
    );
    const failuresToday = store.all(
      "SELECT json_extract(error,'$.code') AS code, COUNT(*) AS n FROM runs WHERE created_at>=? AND status='failed' GROUP BY code ORDER BY n DESC",
      day + "T00:00:00",
    );
    const duration = store.get(
      "SELECT AVG((julianday(updated_at)-julianday(created_at))*86400) AS s FROM runs WHERE created_at>=? AND status IN ('completed','failed','canceled')",
      day + "T00:00:00",
    );
    // 用户是否真正查到答案，是独立于 HTTP/任务成功率的产品质量指标。
    // 每个运行只取最近一次已保存的规则判定，不将重算次数当作更多调查。
    // 本处只统计状态类型，不把“有结论”伪称为“结论准确”。
    const verdictsToday = store.all(
      `SELECT CASE
             WHEN e.kind='trace.reassessment' THEN json_extract(e.data,'$.assessment.verdict.outcome')
             ELSE json_extract(e.data,'$.outcome')
           END AS outcome,COUNT(*) AS count
         FROM runs r
         JOIN evidence e ON e.rowid=(
           SELECT x.rowid FROM evidence x
           WHERE x.run_id=r.id AND x.kind IN ('trace.verdict','trace.reassessment')
           ORDER BY x.created_at DESC,x.rowid DESC LIMIT 1
         )
         WHERE r.created_at>=? AND r.owner IS NOT NULL
         GROUP BY outcome`,
      day + "T00:00:00",
    );
    const waitingApprovalCount = Number(store.get(
      "SELECT COUNT(*) AS n FROM runs WHERE owner IS NOT NULL AND status='waiting_approval'",
    )?.n || 0);
    return {
      mode: "public",
      day,
      sessionsTotal: Number(store.get("SELECT COUNT(*) AS n FROM web_sessions")?.n || 0),
      sessionsToday: Number(
        store.get("SELECT COUNT(*) AS n FROM web_sessions WHERE created_at>=?", day + "T00:00:00")?.n || 0,
      ),
      runsToday,
      runsByStatus: byStatus,
      searchesToday: dailyCount("global", "all", "search"),
      searchBudget: limit.dailySearchBudget,
      runBudget: limit.dailyRunBudget,
      failuresToday,
      verdictsToday,
      waitingApprovalCount,
      note: "状态计数仅表示真实调查判定分布，不代表结论准确率或真实问题解决率。",
      averageDurationSeconds: duration?.s ? Math.round(Number(duration.s)) : null,
      limits: limit,
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
  }

  const api: Guard = {
    createSession,
    sessionOf,
    quotaOf,
    assertInvestigationAllowed,
    recordInvestigation,
    reserveSearch,
    runTimeoutMs: limit.runTimeoutMs,
    metrics,
  };
  activeGuard = api;
  return api;
}

/**
 * 供能力插件调用：检索前占预算。
 * 非公网模式或尚未创建 guard 时返回 null，插件按原逻辑继续。
 */
/**
 * 公网审批遗弃清理：只处理匿名公网会话拥有、超过配置窗口的等待任务。
 * 依赖原有 Engine.cancel，保留取消事件/待审记录，不删除历史数据。
 * 每次运行可重入，SQLite 状态条件和 Engine 冲突校验防止重复取消。
 */
export function expireAbandonedApprovals(
  store: Store,
  engine: Pick<Engine, "cancel">,
  maxAgeMs = limits().approvalWaitTimeoutMs,
) {
  if (!publicMode()) return 0;
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const expired = store.all(
    "SELECT id FROM runs WHERE owner IS NOT NULL AND status='waiting_approval' AND updated_at<? ORDER BY updated_at ASC LIMIT 100",
    cutoff,
  );
  let count = 0;
  for (const row of expired) {
    try {
      engine.cancel(row.id);
      store.event(row.id, "approval.expired", { reason: "PUBLIC_APPROVAL_TIMEOUT", timeoutMs: maxAgeMs });
      count++;
    } catch (error) {
      if (!(error instanceof ExecutionError) || error.code !== "CANCEL_CONFLICT") throw error;
    }
  }
  return count;
}

export function guardReserveSearch(runId: string) {
  if (!publicMode() || !activeGuard) return null;
  return activeGuard.reserveSearch(runId);
}

/** 进程内的每分钟请求限流（单进程部署足够；重启后重新计数，不承担持久承诺）。 */
const minuteBuckets = new Map<string, { minute: string; count: number }>();

function hitMinute(key: string, perMinute: number) {
  const minute = new Date().toISOString().slice(0, 16);
  const bucket = minuteBuckets.get(key);
  if (!bucket || bucket.minute !== minute) {
    minuteBuckets.set(key, { minute, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > perMinute)
    throw new ExecutionError(
      "RATE_LIMITED",
      "请求太频繁，请稍等几秒再试。",
    );
}

const SESSION_COOKIE = "trace_session";

/**
 * 会话 Cookie 的安全属性。
 *
 * `Secure` 只在 HTTPS 下有意义：明文 HTTP 站点写 Secure Cookie 会被浏览器**直接丢弃**，
 * 于是档案下载这类普通链接跳转（带不了自定义请求头）就只剩「没有会话」。
 * 因此这里按实际协议决定，而不是无条件写死 Secure。
 */
function cookieSecure(req: FastifyRequest) {
  const forced = String(process.env.PLATFORM_COOKIE_SECURE ?? "").trim();
  if (forced) return /^(1|true|yes|on)$/i.test(forced);
  if (trustsProxy()) {
    const proto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
    if (proto === "https") return true;
    // Cloudflare 隧道下 Caddy 看到的是 http，真正的协议记在 CF-Visitor 里。
    const visitor = String(req.headers["cf-visitor"] || "");
    if (/"scheme"\s*:\s*"https"/i.test(visitor)) return true;
  }
  return req.protocol === "https";
}

/** Cookie 有效期与服务端绝对期限保持一致，避免浏览器比服务端保留更久。 */
function sessionCookieHeader(token: string, req: FastifyRequest) {
  const secure = cookieSecure(req) ? "; Secure" : "";
  const maxAge = limits().sessionMaxHours * 3600;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAge}`;
}

/**
 * 会话令牌来源：Cookie 优先，其次兼容既有客户端的请求头。
 *
 * 浏览器侧不再持有可脚本读取的令牌，Cookie 才是主路径；
 * 请求头只为已部署的老页面保留，且不能覆盖有效 Cookie。
 */
function tokenFromRequest(req: FastifyRequest) {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.split("=");
    if (name?.trim() === SESSION_COOKIE) {
      const value = rest.join("=").trim();
      if (value) return value;
    }
  }
  return String(req.headers["x-trace-session"] || "").trim();
}

/**
 * 是否信任反向代理转发的地址。
 *
 * 默认**不信任**：直连时 X-Forwarded-For 完全由客户端决定，任何匿名用户都能
 * 随便写一个 IP 绕过「每 IP 每日上限」。只有在受控部署（Caddy/Cloudflare 在前面）
 * 时，才用 PLATFORM_TRUST_PROXY=1 明确开启。
 */
function trustsProxy() {
  return /^(1|true|yes|on)$/i.test(String(process.env.PLATFORM_TRUST_PROXY || ""));
}

/**
 * 是否信任 Cloudflare 边缘写入的 CF-Connecting-IP。
 *
 * 只有流量确实经过 Cloudflare（隧道或橙色云代理）时才成立。直连部署时任何人
 * 都能自带这个头伪造来源 IP，因此必须单独开关，不能与 TRUST_PROXY 合并。
 */
function trustsCloudflareHeader() {
  return /^(1|true|yes|on)$/i.test(String(process.env.PLATFORM_TRUST_CF_IP || ""));
}

function clientIp(req: FastifyRequest) {
  if (trustsProxy()) {
    if (trustsCloudflareHeader()) {
      const cf = String(req.headers["cf-connecting-ip"] || "").trim();
      if (cf) return cf.slice(0, 64);
    }
    // 代理会在末尾追加它看到的对端地址，客户端自己伪造的项只能出现在前面。
    const hops = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (hops.length) return hops[hops.length - 1].slice(0, 64);
  }
  const socket = (req as unknown as { socket?: { remoteAddress?: string } }).socket?.remoteAddress;
  return String(req.ip || socket || "0.0.0.0").slice(0, 64);
}

/**
 * 只读公开案例：交付材料里给评委的三个已存调查，允许任何人按 ID 打开查看。
 *
 * 只放开 GET，且只放开列在这里的运行；写入、列表、其它运行仍然要求会话归属。
 */
function demoRunIds() {
  return new Set(
    String(process.env.PLATFORM_DEMO_RUNS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

/**
 * 公开案例允许匿名读取的子路径。
 *
 * 只读案例是为了给评委看证据，不是把整条运行记录连同内部数据一起对外开放：
 * 人工反馈（含记录人）、模型调用等路由不在名单内，仍要求会话归属。
 */
const DEMO_READ_PATHS = new Set([
  "",
  "/receipt",
  "/trace/assessment",
  "/trace/revisions",
  "/trace/clue",
  "/trace/experiences",
  "/report.md",
  "/report.json",
]);

function demoReadable(path: string, runId: string) {
  if (!demoRunIds().has(runId)) return false;
  const rest = path.slice(`/v1/runs/${runId}`.length);
  if (DEMO_READ_PATHS.has(rest)) return true;
  // 档案下载：/v1/runs/:id/artifacts/:artifactId
  return /^\/artifacts\/[^/]+$/.test(rest);
}

const PUBLIC_PATHS = [
  "/v1/health",
  "/v1/session",
  "/v1/admin/metrics",
  "/v1/catalog",
];

/**
 * 把公网约束挂到 Fastify 上。
 * 注意：路由级 ownership 检查必须在读取运行/项目之前完成，因此放在 onRequest。
 */
export function installPublicGuard(
  app: FastifyInstance,
  store: Store,
  guard: Guard,
  adminToken: string | undefined,
) {
  if (!publicMode()) return;

  app.addHook("onRequest", async (req, _reply) => {
    const path = req.url.split("?")[0];
    if (PUBLIC_PATHS.includes(path)) return;
    const ip = clientIp(req);
    hitMinute("ip:" + ip, limits().requestsPerMinute * 4);
    const session = guard.sessionOf(tokenFromRequest(req));
    if (!session)
      throw new ExecutionError(
        "SESSION_REQUIRED",
        "这个浏览器还没有会话，请刷新页面重新开始。",
      );
    hitMinute("session:" + session.id, limits().requestsPerMinute);
    (req as unknown as { traceSession: TraceSession }).traceSession = session;

    // 运行/项目必须属于当前会话。没有归属（owner 为空）的历史数据同样不能匿名读取：
    // 「谁的都不是」不等于「大家的」。
    const runRow = /^\/v1\/runs\/([^/]+)/.exec(path);
    if (runRow) {
      const row = store.get("SELECT owner FROM runs WHERE id=?", runRow[1]) as
        | { owner?: string | null }
        | undefined;
      // 公开案例只开放只读路由；反馈、模型等内部数据仍按归属判断。
      const readonlyDemo =
        (req.method === "GET" || req.method === "HEAD") &&
        demoReadable(path, runRow[1]);
      if (row && row.owner !== session.id && !readonlyDemo)
        throw new ExecutionError("RUN_NOT_FOUND", "任务不存在。");
    }
    const projectRow = /^\/v1\/projects\/([^/]+)/.exec(path);
    if (projectRow) {
      const row = store.get("SELECT owner FROM projects WHERE id=?", projectRow[1]) as
        | { owner?: string | null }
        | undefined;
      if (row && row.owner !== session.id)
        throw new ExecutionError("PROJECT_NOT_FOUND", "项目不存在。");
    }
  });

  // 读取某个会话下不属于自己的运行列表/概览同样要过滤，见 app.ts 内的列表实现。

  // 工作室类接口（全站概览、经验库、组合库、能力清单）面向本机 Studio，
  // 含全站数据，不属于 C 端调查界面；公网只允许管理员令牌访问。
  const adminOnly = [
    "/v1/overview",
    "/v1/experiences",
    "/v1/compositions",
    "/v1/capabilities",
  ];
  app.addHook("preHandler", async (req) => {
    const path = req.url.split("?")[0];
    if (!adminOnly.some((prefix) => path.startsWith(prefix))) return;
    if (
      !adminToken ||
      !sameSecret(String(req.headers["x-admin-token"] || ""), adminToken)
    )
      throw new ExecutionError("ADMIN_DENIED", "这个接口不对外开放。");
  });

  app.post("/v1/session", async (req, reply) => {
    const ip = clientIp(req);
    hitMinute("session-issue:" + ip, 20);
    const { token, session, quota } = guard.createSession(
      ip,
      String(req.headers["user-agent"] || ""),
    );
    reply.header("cache-control", "no-store");
    // 令牌只经 HttpOnly Cookie 下发：前端不再持有可被脚本读取的 bearer token，
    // 页面上就没有能把会话带走的字符串。
    reply.header("set-cookie", sessionCookieHeader(token, req));
    const expiresAt = new Date(
      Date.now() + limits().sessionMaxHours * 3_600_000,
    ).toISOString();
    return { sessionId: session.id, quota, limits: limits(), expiresAt };
  });

  app.get("/v1/session", async (req, reply) => {
    const token = tokenFromRequest(req);
    const session = guard.sessionOf(token);
    if (!session)
      throw new ExecutionError("SESSION_REQUIRED", "会话已失效，请刷新页面重新开始。");
    reply.header("cache-control", "no-store");
    // 老客户端只用请求头、没有 Cookie 时在这里补发一次，档案下载才能走普通链接。
    const hasCookie = String(req.headers.cookie || "").includes(SESSION_COOKIE + "=");
    if (token && !hasCookie) reply.header("set-cookie", sessionCookieHeader(token, req));
    return { sessionId: session.id, quota: guard.quotaOf(session) };
  });

  app.get("/v1/admin/metrics", async (req, reply) => {
    const provided = String(req.headers["x-admin-token"] || "");
    if (!adminToken || !sameSecret(provided, adminToken))
      throw new ExecutionError("ADMIN_DENIED", "需要管理令牌。");
    reply.header("cache-control", "no-store");
    return guard.metrics();
  });
}

/** 路由内部取会话（仅公网模式有值）。 */
export function sessionOfRequest(req: FastifyRequest): TraceSession | null {
  return (
    (req as unknown as { traceSession?: TraceSession }).traceSession || null
  );
}

export function requestIp(req: FastifyRequest) {
  return clientIp(req);
}
