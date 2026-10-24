/**
 * 真实陌生问题验收：必须连接已启动且已配置元宝 SearchPro 的 Runtime。
 *
 * 运行：
 * TRACE_RUNTIME_URL=http://127.0.0.1:4313 node tooling/trace-live-investigation.mjs "一段之前未用过的影视线索"
 *
 * 输出真实请求ID、搜索次数、候选、直接来源、补查前后状态；不读取/写入密钥。
 * 不能用作合成案例，也不能把没有来源的 found 判为通过。
 */
import { detectInvestigationDomain, investigationFlow } from "@personal/capability-sdk";

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
  // 同一套运行时，按问题类型选择装配：影视作品走候选追查，其余走「出处-主张」核验。
  // 不允许把开放事实问题硬送进影视候选判断器（那会得到 0 候选的假失败）。
  const domain = detectInvestigationDomain(question);
  const flow = investigationFlow(question, process.env.TRACE_FLOW === "verification" ? "verification" : "clue");
  const setup =
    flow === "clue"
      ? {
          title: "线索侦探 · 线索追查流程",
          suffix: "验收",
          filename: "陌生线索现场验收.txt",
          assembly: [
            { capabilityId: "trace.clue.intake", version: "1.0.0", config: {}, timeoutMs: 60000 },
            { capabilityId: "trace.facts.confirm", version: "1.0.0", config: {} },
            { capabilityId: "trace.web.search", version: "1.0.0", config: { fetchBodyBudget: 6, requestTimeoutMs: 20000, gapMs: 350 }, timeoutMs: 120000 },
            { capabilityId: "trace.clue.candidates", version: "1.0.0", config: {} },
          ],
        }
      : {
          title: "溯证 TRACE 调查流程",
          suffix: "验收",
          filename: "开放问题现场验收.txt",
          assembly: [
            { capabilityId: "trace.case.intake", version: "1.0.0", config: {} },
            { capabilityId: "trace.facts.confirm", version: "1.0.0", config: {} },
            { capabilityId: "trace.web.search", version: "1.0.0", config: { fetchBodyBudget: 6, requestTimeoutMs: 20000, gapMs: 350 }, timeoutMs: 120000 },
            { capabilityId: "trace.evidence.verify", version: "1.0.0", config: {} },
          ],
        };
  const assembly = setup.assembly;
  const projects = await api("/projects");
  const compatible = projects.find((p) =>
    p.name.startsWith(setup.title) &&
    p.steps?.length === assembly.length &&
    p.steps.every((step, i) => step.capabilityId === assembly[i].capabilityId && step.version === assembly[i].version),
  );
  const project = compatible || await api("/projects", "POST", {
    name: setup.title + " · " + setup.suffix,
    layout: "business",
    permissions: ["document:read", "document:validate", "knowledge:search", "data:external", "evidence:write", "file:write", "model:invoke"],
    steps: assembly,
  });
  const started = await api("/projects/" + encodeURIComponent(project.id) + "/runs", "POST", {
    expectedRevision: project.revision,
    filename: setup.filename,
    text: question,
    payload:
      flow === "clue"
        ? { question }
        : { question, claim: question, facts: [{ id: "fact-1", text: question, queries: [question] }] },
    dataConsent: true,
    // 允许用现有模型辅助规划线索（不改变「答案只来自真实检索」这条底线）。
    modelConsent: process.env.TRACE_MODEL === "1",
  });
  let run = started;
  for (let n = 0; n < 55; n++) {
    run = await api("/runs/" + encodeURIComponent(started.id));
    if (["completed", "failed", "canceled", "rejected", "waiting_approval"].includes(run.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (run.status !== "completed") throw Error(`调查未完成：${run.status} ${JSON.stringify(run.error || "")}`);
  let pre;
  let follow = { executed: [] };
  let post;
  if (flow === "clue") {
    pre = await api("/runs/" + encodeURIComponent(run.id) + "/trace/clue");
    follow = await api("/runs/" + encodeURIComponent(run.id) + "/trace/clue/auto", "POST", { max: 2 });
    post = follow.assessment;
  } else {
    // 核验流程：先读评估，再让系统按「影响答案的缺口」自动补查一轮。
    const assessment = await api("/runs/" + encodeURIComponent(run.id) + "/trace/assessment");
    const auto = await api("/runs/" + encodeURIComponent(run.id) + "/trace/auto", "POST", { max: 2 });
    follow = { executed: (auto.executed || []).map((item) => ({ query: item.query, reason: item.reason, resultCount: item.resultCount, stateBefore: item.before, stateAfter: item.after })) };
    if (auto.assessment) {
      const after = auto.assessment;
      post = { decision: { state: after.verdict?.outcome || "unknown", headline: after.verdict?.statement || "" }, candidates: [], pageCount: after.counts?.pages ?? 0, verdict: after.verdict, counts: after.counts, facts: after.facts };
      const cited = (after.facts || []).flatMap((fact) => (fact.sources || []).filter((source) => source.relation === "supports" || source.relation === "contradicts").slice(0, 3).map((source) => ({ clue: fact.fact?.text || "", relation: source.relation, quote: (source.semantic?.sentence || source.bodyExcerpt || source.excerpt || "").slice(0, 160), source: source.url, site: source.site, date: source.date, from: source.bodyAvailable ? "body" : "excerpt", semantic: source.semantic })));
      pre = { decision: { state: assessment.assessment?.verdict?.outcome || "unknown", headline: assessment.assessment?.verdict?.statement || "" }, candidates: [], pageCount: assessment.assessment?.counts?.pages ?? 0, verdict: assessment.assessment?.verdict, counts: assessment.assessment?.counts, facts: assessment.assessment?.facts, directEvidence: cited };
    }
    if (!auto.assessment) {
      pre = { decision: { state: assessment.assessment?.verdict?.outcome || "unknown", headline: assessment.assessment?.verdict?.statement || "" }, candidates: [], pageCount: assessment.assessment?.counts?.pages ?? 0 };
      post = { ...pre, verdict: assessment.assessment?.verdict, counts: assessment.assessment?.counts, facts: assessment.assessment?.facts };
    }
  }
  run = await api("/runs/" + encodeURIComponent(run.id));
  const calls = (run.evidence || []).filter((x) => x.kind === "search.call")
    .map((x) => x.data).filter(Boolean);
  const additional = follow.executed || [];
  const actual = calls.some((x) => Number(x.httpStatus) === 200 && x.requestId) ||
    additional.some((x) => Number(x.resultCount) > 0);
  const best = post.candidates?.[0];
  const clueCitations = (best?.matches || [])
    .filter((m) => m.found && m.relation === "direct" && m.url && m.sentence)
    .map((m) => ({ clue: m.clue, quote: m.sentence, source: m.url, from: m.from }));
  // 核验流程：直接取判定用到的证据句（与页面展示同源）。
  const factCitations = flow === "clue" ? [] : (post.facts || []).flatMap((fact) =>
    (fact.sources || [])
      .filter((source) => source.relation === "supports" || source.relation === "contradicts")
      .slice(0, 3)
      .map((source) => ({
        clue: fact.text,
        relation: source.relation,
        quote: source.bodyExcerpt || source.excerpt,
        source: source.url,
        site: source.site,
        date: source.date,
        from: source.bodyAvailable ? "body" : "excerpt",
      })),
  );
  const citations = [...clueCitations, ...factCitations];
  const result = {
    question, runId: run.id, runStatus: run.status,
    flow, domain,
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
