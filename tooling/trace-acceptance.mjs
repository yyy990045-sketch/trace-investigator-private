/**
 * 溯证 TRACE 真实案例验收脚本。
 *
 * 前置：Runtime 已启动且已配置元宝搜索密钥（.env.platform → PLATFORM_WSA_API_KEY）。
 * 用法：
 *   node tooling/trace-acceptance.mjs                 # 跑内置 A/B/C 三个案例
 *   node tooling/trace-acceptance.mjs cases.json      # 用自定义案例文件
 *
 * 它会：创建/复用调查项目 → 逐个案例真实立案 → 等待人工确认节点 → 自动以「验收脚本」
 * 身份批准 → 下载调查档案 → 把检索请求/响应状态、来源网址、结论与文件路径写成验收记录。
 *
 * 这里没有任何预填的搜索结果或结论：拿不到证据就如实记录「证据不足」。
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const API = process.env.TRACE_API || "http://127.0.0.1:4313";
const OUT = process.env.TRACE_ACCEPTANCE_DIR || "data/trace-acceptance";
const clientHeader = { "x-platform-client": "workbench-v1", "content-type": "application/json" };

const STEPS = [
  { capabilityId: "trace.case.intake", version: "1.0.0", config: {} },
  { capabilityId: "trace.facts.confirm", version: "1.0.0", config: {} },
  {
    capabilityId: "trace.web.search",
    version: "1.0.0",
    config: { fetchBodyBudget: 6, requestTimeoutMs: 20000, gapMs: 400 },
    timeoutMs: 120000,
  },
  { capabilityId: "trace.evidence.verify", version: "1.0.0", config: {} },
  { capabilityId: "human.confirm", version: "1.0.0", config: {} },
  { capabilityId: "trace.archive.export", version: "1.0.0", config: {} },
];

export const defaultCases = [
  {
    id: "A-original-source",
    intent: "可以找到原始证据的问题",
    question: "《中华人民共和国个人信息保护法》是什么时候通过、什么时候施行的？",
    claim: "《中华人民共和国个人信息保护法》自2021年11月1日起施行",
    facts: [
      {
        id: "fact-1",
        text: "《中华人民共和国个人信息保护法》自2021年11月1日起施行",
        queries: ["个人信息保护法 施行日期 2021年11月1日", "个人信息保护法 全文 主席令"],
        timeScope: "2021年",
        subjectScope: "中华人民共和国",
      },
    ],
  },
  {
    id: "B-cross-check",
    intent: "存在不同说法、需要交叉验证的问题",
    question: "2024年中国新能源汽车产量到底是多少？不同来源给出的数字一致吗？",
    claim: "2024年中国新能源汽车产量超过1200万辆",
    facts: [
      {
        id: "fact-1",
        text: "2024年中国新能源汽车产量超过1200万辆",
        queries: ["2024年 中国 新能源汽车 产量 万辆", "2024年 新能源汽车 产销 统计数据"],
        timeScope: "2024年",
        subjectScope: "中国",
      },
    ],
  },
  {
    id: "C-insufficient",
    intent: "现有公开来源无法充分支持结论的问题",
    question: "2025年是否已经建成覆盖全国的氢能长途重卡加氢网络？",
    claim: "2025年中国已建成覆盖全国的氢能长途重卡加氢网络",
    facts: [
      {
        id: "fact-1",
        text: "2025年中国已建成覆盖全国主要干线的氢能长途重卡加氢网络",
        queries: ["2025年 全国 氢能 重卡 加氢网络 建成", "全国加氢站 覆盖 干线 重卡"],
        timeScope: "2025年",
        subjectScope: "中国",
      },
    ],
  },
];

async function api(path, method = "GET", body) {
  let response;
  try {
    response = await fetch(API + path, {
      method,
      headers: clientHeader,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      `无法连接 Runtime（${API}）：${error.cause?.code || error.message}。请先启动 Runtime（npm run runtime），确认 4313 端口在监听。`,
    );
  }
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`运行服务返回非 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`);
  }
  if (!response.ok) throw new Error(`${data.code || response.status}：${data.message}`);
  return data;
}

async function ensureProject() {
  const projects = await api("/v1/projects");
  const found = projects.find((project) => project.name === "溯证 TRACE 调查流程");
  if (found) return found;
  return api("/v1/projects", "POST", {
    name: "溯证 TRACE 调查流程",
    layout: "business",
    permissions: [
      "document:read",
      "document:validate",
      "knowledge:search",
      "data:external",
      "evidence:write",
      "file:write",
    ],
    steps: STEPS,
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(runId, predicate, label, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = await api(`/v1/runs/${runId}`);
    if (predicate(run)) return run;
    await sleep(700);
  }
  throw new Error("等待超时：" + label);
}

async function download(url, target) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`无法连接 Runtime 下载档案（${API}）：${error.cause?.code || error.message}`);
  }
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}：${target}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(target, buffer);
  return buffer.byteLength;
}

async function runCase(project, testCase) {
  const dir = join(OUT, testCase.id);
  await mkdir(dir, { recursive: true });
  const run = await api(`/v1/projects/${project.id}/runs`, "POST", {
    filename: "调查案件.json",
    text: testCase.question,
    dataConsent: true,
    expectedRevision: project.revision,
    payload: {
      question: testCase.question,
      claim: testCase.claim,
      facts: testCase.facts,
    },
  });
  console.log(`[${testCase.id}] 立案 ${run.id}`);

  const pending = await waitFor(
    run.id,
    (current) => ["waiting_approval", "failed", "completed", "rejected"].includes(current.status),
    "到达确认节点",
  );
  if (pending.status !== "waiting_approval") {
    return { id: testCase.id, intent: testCase.intent, runId: run.id, status: pending.status, error: pending.error };
  }
  const approval = pending.approvals.find((item) => item.status === "pending");
  await api(`/v1/runs/${run.id}/approvals/${approval.id}`, "POST", {
    decision: "approve",
    actor: "验收脚本（人工确认节点由脚本代为记录，不是身份认证）",
  });
  const finished = await waitFor(run.id, (current) => ["completed", "failed"].includes(current.status), "完成导出");

  const searchStep = finished.steps.find((step) => step.capabilityId === "trace.web.search");
  const verifyStep = finished.steps.find((step) => step.capabilityId === "trace.evidence.verify");
  const bundle = verifyStep?.output || searchStep?.output || {};
  const verdict = bundle.assessment?.verdict;
  const files = [];
  for (const artifact of finished.artifacts || []) {
    const target = join(dir, artifact.filename);
    const bytes = await download(`${API}/v1/runs/${finished.id}/artifacts/${artifact.id}`, target);
    files.push({ filename: artifact.filename, bytes, sha256: artifact.sha256, path: target });
  }
  const record = {
    id: testCase.id,
    intent: testCase.intent,
    runId: finished.id,
    status: finished.status,
    question: testCase.question,
    claim: testCase.claim,
    searches: (bundle.searches || []).map((attempt) => ({
      query: attempt.query,
      requestId: attempt.requestId,
      httpStatus: attempt.httpStatus,
      resultCount: attempt.resultCount,
      durationMs: attempt.durationMs,
      attempts: attempt.attempts,
      error: attempt.error,
    })),
    sources: (bundle.pages || []).map((page) => ({
      title: page.title,
      url: page.url,
      site: page.site,
      date: page.date,
      score: page.score,
    })),
    bodies: (bundle.bodies || []).map((body) => ({ url: body.url, ok: body.ok, httpStatus: body.httpStatus, textLength: body.textLength, error: body.error })),
    verdict,
    facts: (bundle.assessment?.facts || []).map((fact) => ({
      fact: fact.fact,
      relation: fact.relation,
      independentClusters: fact.independentClusters,
      bodyBackedClusters: fact.bodyBackedClusters,
      supports: fact.supports,
      contradicts: fact.contradicts,
      reasons: fact.reasons,
    })),
    files,
    error: finished.error,
  };
  await writeFile(join(dir, "acceptance.json"), JSON.stringify(record, null, 2));
  console.log(
    `[${testCase.id}] ${finished.status} · 结论 ${verdict?.outcome || "无"} · 检索 ${record.searches.length} 次 · 来源 ${record.sources.length} 条 · 档案 ${files.length} 个`,
  );
  return record;
}

try {
  const casesPath = process.argv[2];
  const cases = casesPath ? JSON.parse(await readFile(casesPath, "utf8")) : defaultCases;
  await mkdir(OUT, { recursive: true });
  const project = await ensureProject();
  const catalog = await api("/v1/catalog");
  const provider = catalog.providers.find((item) => item.id === "tencent-wsa-search");
  if (!provider?.available) {
    console.error("阻塞：元宝搜索不可用 →", provider?.reason);
    console.error(
      "请先在 .env.platform 取消注释并填写 PLATFORM_WSA_API_KEY=sk-...（不要加引号），再重启 Runtime；脚本不会伪造检索结果。",
    );
    process.exit(2);
  }
  console.log(`检索能力已配置：${provider.endpointHost || "元宝搜索"}，开始 ${cases.length} 个真实案例`);

  const results = [];
  for (const testCase of cases) results.push(await runCase(project, testCase));
  await writeFile(join(OUT, "summary.json"), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log("\n汇总：", join(OUT, "summary.json"));
} catch (error) {
  console.error("\n验收中止：" + (error instanceof Error ? error.message : String(error)));
  process.exit(3);
}
