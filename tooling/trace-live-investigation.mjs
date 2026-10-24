/**
 * 真实陌生问题验收：必须连接已启动且已配置元宝 SearchPro 的 Runtime。
 *
 * 运行：
 * TRACE_RUNTIME_URL=http://127.0.0.1:4313 node tooling/trace-live-investigation.mjs "一段之前未用过的影视线索"
 *
 * 输出真实请求ID、搜索次数、候选、直接来源、补查前后状态；不读取/写入密钥。
 * 不能用作合成案例，也不能把没有来源的 found 判为通过。
 */
const root = String(process.env.TRACE_RUNTIME_URL || "http://127.0.0.1:4313").replace(/\/$/, "");
const question = process.argv.slice(2).join(" ").trim();
if (question.length < 8) {
  console.error("请提交一条完整的陌生线索（至少8字），不会自动使用旧测试案例。");
  process.exit(2);
}
let session = String(process.env.TRACE_SESSION_TOKEN || "");
async function api(path, method = "GET", data) {
  const response = await fetch(root + "/v1" + path, {
    method,
    headers: {
      "x-platform-client": "workbench-v1",
      ...(session ? { "x-trace-session": session } : {}),
      ...(data === undefined ? {} : { "content-type": "application/json" }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = { message: raw.slice(0, 200) }; }
  if (!response.ok) throw Error(`${method} ${path} HTTP ${response.status}: ${parsed.message || parsed.code || "请求失败"}`);
  return parsed;
}
function headline(assessment) {
  return {
    state: assessment?.decision?.state ?? "unknown",
    text: assessment?.decision?.headline ?? "",
    top: assessment?.candidates?.[0]?.name ?? null,
    matches: assessment?.candidates?.[0]?.matchedClues ?? 0,
    pages: assessment?.pageCount ?? 0,
    bodies: assessment?.bodyAvailable ?? 0,
  };
}
try {
  const health = await api("/health");
  if (health.status !== "ok") throw Error("Runtime 健康检查未通过");
  const catalog = await api("/catalog");
  const provider = catalog.providers?.find((item) => item.id === "tencent-wsa-search");
  if (!provider?.available) throw Error("元宝 SearchPro 未配置，无法真实验收：" + (provider?.reason || "服务不可用"));
  if (!session) {
    try { const issued = await api("/session", "POST", {}); session = issued.token || ""; }
    catch (error) {
      if (!String(error).includes("HTTP 404")) throw error;
      // 本机模式没有匿名会话端点，直接继续。
    }
  }
  const assembly = [
    { capabilityId: "trace.clue.intake", version: "1.0.0", config: {}, timeoutMs: 60000 },
    { capabilityId: "trace.facts.confirm", version: "1.0.0", config: {} },
    { capabilityId: "trace.web.search", version: "1.0.0", config: { fetchBodyBudget: 6, requestTimeoutMs: 20000, gapMs: 350 }, timeoutMs: 120000 },
    { capabilityId: "trace.clue.candidates", version: "1.0.0", config: {} },
  ];
  const projects = await api("/projects");
  const compatible = projects.find((p) =>
    p.name.startsWith("线索侦探 · 线索追查流程") &&
    p.steps?.length === assembly.length &&
    p.steps.every((step, i) => step.capabilityId === assembly[i].capabilityId && step.version === assembly[i].version),
  );
  const project = compatible || await api("/projects", "POST", {
    name: "线索侦探 · 线索追查流程 · 验收",
    layout: "business",
    permissions: ["document:read", "document:validate", "knowledge:search", "data:external", "evidence:write", "file:write", "model:invoke"],
    steps: assembly,
  });
  const started = await api("/projects/" + encodeURIComponent(project.id) + "/runs", "POST", {
    expectedRevision: project.revision,
    filename: "陌生线索现场验收.txt",
    text: question,
    payload: { question },
    dataConsent: true,
    modelConsent: false,
  });
  let run = started;
  for (let n = 0; n < 55; n++) {
    run = await api("/runs/" + encodeURIComponent(started.id));
    if (["completed", "failed", "canceled", "rejected", "waiting_approval"].includes(run.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (run.status !== "completed") throw Error(`调查未完成：${run.status} ${JSON.stringify(run.error || "")}`);
  const pre = await api("/runs/" + encodeURIComponent(run.id) + "/trace/clue");
  const follow = await api("/runs/" + encodeURIComponent(run.id) + "/trace/clue/auto", "POST", { max: 2 });
  const post = follow.assessment;
  run = await api("/runs/" + encodeURIComponent(run.id));
  const calls = (run.evidence || []).filter((x) => x.kind === "search.call")
    .map((x) => x.data).filter(Boolean);
  const additional = follow.executed || [];
  const actual = calls.some((x) => Number(x.httpStatus) === 200 && x.requestId) ||
    additional.some((x) => Number(x.resultCount) > 0);
  const best = post.candidates?.[0];
  const citations = (best?.matches || [])
    .filter((m) => m.found && m.relation === "direct" && m.url && m.sentence)
    .map((m) => ({ clue: m.clue, quote: m.sentence, source: m.url, from: m.from }));
  const result = {
    question, runId: run.id, runStatus: run.status,
    searchPro: "tencent-wsa-search",
    calls: calls.map((x) => ({
      query: x.query, httpStatus: x.httpStatus, requestId: x.requestId,
      resultCount: x.resultCount, error: x.error,
    })),
    followups: additional, before: headline(pre), after: headline(post),
    directEvidence: citations,
    meaningfulChange: pre.decision?.state !== post.decision?.state ||
      pre.candidates?.[0]?.name !== post.candidates?.[0]?.name ||
      pre.pageCount !== post.pageCount,
    sourceVerified: post.decision?.state !== "found" || citations.length > 0,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!actual || !result.sourceVerified) process.exitCode = 1;
} catch (error) {
  console.error("真实调查验收失败：" + String(error));
  process.exitCode = 1;
}
