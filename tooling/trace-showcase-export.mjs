/**
 * TRACE 只读展示版导出。
 *
 * 做什么：从本机 Runtime 读取真实的调查记录（只发 GET 请求，不触发任何检索），
 * 把三个案例的数据、评估、版本记录与档案文件导出成一份可以独立部署的静态站点。
 *
 * 为什么不直接暴露 Runtime：本机 Runtime 没有鉴权，公网暴露等于把运行接口交出去。
 * 这份静态成品只有页面、只有公开来源与结论，没有接口可写。
 *
 * 用法：
 *   npm run build:showcase            # 生成 delivery/trace-showcase/
 *   cd delivery/trace-showcase && python3 -m http.server 4400   # 任意静态服务器 / 静态托管都可
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = process.env.TRACE_RUNTIME || "http://127.0.0.1:4313";
// 成品放进 delivery/（dist/ 被 .gitignore 忽略，交付物要能随仓库一起发给评委）
const outDir = join(repo, "delivery/trace-showcase");
const appDist = join(repo, "apps/trace/dist-showcase");

/** 三个案例：runId 是本机真实运行记录，label/note 只描述这次调查查了什么。 */
const CASES = [
  {
    key: "A",
    runId: "run_13dcfa4f-3074-4bdc-a36b-53b2933bb7b8",
    label: "有明确原始证据",
    note: "《个人信息保护法》自 2021 年 11 月 1 日起施行：官方原文可查、转载被合并，中途还做过一次人工修正并出了第 2 版档案。",
  },
  {
    key: "B",
    runId: "run_ef9af382-947a-4a9d-acd0-34b496b3d9b3",
    label: "需要跨来源核查",
    note: "2024 年中国新能源汽车产量是否超过 1200 万辆：多家统计口径不一致，看系统如何逐条对照数字而不误判。",
  },
  {
    key: "C",
    runId: "run_d34a959a-e748-4208-b9a6-eac33c1de13a",
    label: "补充调查后仍证据不足",
    note: "2025 年全国氢能重卡加氢网络是否已建成：追加真实检索并人工修正，结论仍是证据不足；命中网页不等于独立证据。",
  },
];

const headers = { "x-platform-client": "workbench-v1" };

async function api(path) {
  const response = await fetch(runtime + path, { headers });
  if (!response.ok) throw new Error(`GET ${path} 失败：HTTP ${response.status}`);
  return response.json();
}

async function apiBytes(path) {
  const response = await fetch(runtime + path, { headers });
  if (!response.ok) throw new Error(`GET ${path} 失败：HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const SECRET_KEYS = /^(api[-_]?key|key|token|secret|password|authorization|credential|cookie)$/i;
const DROP_EVIDENCE = new Set([
  "step.output",
  "search.plan",
  "search.call",
  "source.fetch",
  "trace.verdict",
  "trace.facts.confirmed",
]);

/** 递归清洗：去掉密钥字段，隐去本机绝对路径，保持其余内容原样。 */
function sanitize(value, depth = 0) {
  if (depth > 24) return null;
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") {
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEYS.test(key)) continue;
      clean[key] = sanitize(item, depth + 1);
    }
    return clean;
  }
  if (typeof value === "string")
    return value
      .replace(/\/Users\/[^\s"']+/g, "[本机路径已隐去]")
      .replace(/\/home\/[^\s"']+/g, "[本机路径已隐去]");
  return value;
}

function trimRun(run) {
  return sanitize({
    id: run.id,
    projectName: run.projectName,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    input: { text: run.input?.text || "", dataConsent: run.input?.dataConsent === true },
    assembly: (run.assembly || []).map((step) => ({
      capabilityId: step.capabilityId,
      version: step.version,
    })),
    steps: (run.steps || []).map((step) => ({
      id: step.id,
      position: step.position,
      capabilityId: step.capabilityId,
      version: step.version,
      status: step.status,
      error: step.error,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      output: step.output,
    })),
    approvals: (run.approvals || []).map((approval) => ({
      id: approval.id,
      stepId: approval.stepId,
      status: approval.status,
      actor: approval.actor,
      decidedAt: approval.decidedAt,
    })),
    evidence: (run.evidence || [])
      .filter((item) => !DROP_EVIDENCE.has(item.kind))
      .map((item) => ({ id: item.id, kind: item.kind, data: item.data, createdAt: item.createdAt })),
    artifacts: (run.artifacts || []).map((artifact) => ({
      id: artifact.id,
      filename: artifact.filename,
      mime: artifact.mime,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      createdAt: artifact.createdAt,
    })),
  });
}

async function main() {
  // 1) 只读抓数据
  const artifactIndex = {};
  const cases = [];
  for (const item of CASES) {
    const run = await api(`/v1/runs/${item.runId}`);
    const record = run.run || run;
    const revisions = await api(`/v1/runs/${item.runId}/trace/revisions`);
    for (const artifact of record.artifacts || [])
      artifactIndex[artifact.id] = `artifacts/${item.runId}/${encodeURIComponent(artifact.filename)}`;
    cases.push({
      key: item.key,
      label: item.label,
      note: item.note,
      runId: item.runId,
      run: trimRun(record),
      assessment: sanitize(revisions.current || null),
      revisions: sanitize(revisions),
    });
    console.log(`读取 ${item.key}：${record.status} · 证据 ${record.evidence?.length || 0} 条 · 产物 ${record.artifacts?.length || 0} 个`);
  }

  const data = {
    kind: "trace-showcase",
    generatedAt: new Date().toISOString(),
    product: {
      name: "溯证 TRACE",
      tagline: "把一句说法交给证据去检验：真实联网检索、原文取证、结论可复查。",
      boundary:
        "这里的调查记录来自本机真实联网运行；页面是只读展示，不含运行接口、不含任何密钥。",
    },
    cases,
    artifactIndex,
  };

  const serialized = JSON.stringify(data, null, 0);
  if (/sk-[A-Za-z0-9]{12,}/.test(serialized))
    throw new Error("导出数据里出现疑似 API Key，已中止。");
  if (serialized.includes("/Users/")) throw new Error("导出数据里仍有本机绝对路径，已中止。");

  // 2) 构建只读前端（相对路径 + hash 路由，放任何静态目录都能打开）
  console.log("构建只读前端…");
  execFileSync("npx", ["vite", "build", "--outDir", "dist-showcase"], {
    cwd: join(repo, "apps/trace"),
    env: { ...process.env, TRACE_SHOWCASE: "1", VITE_TRACE_MODE: "showcase" },
    stdio: "inherit",
  });

  // 3) 组装成品目录
  if (existsSync(outDir)) await rm(outDir, { recursive: true, force: true });
  await cp(appDist, outDir, { recursive: true });
  await writeFile(join(outDir, ".gitignore"), ".vercel\n");
  await mkdir(join(outDir, "artifacts"), { recursive: true });

  // 每个案例一个子目录：不同调查的同名档案（调查档案.md）不能互相覆盖。
  for (const item of CASES) {
    const run = cases.find((entry) => entry.key === item.key)?.run;
    if (!run) continue;
    await mkdir(join(outDir, "artifacts", item.runId), { recursive: true });
    for (const artifact of run.artifacts || []) {
      const bytes = await apiBytes(`/v1/runs/${item.runId}/artifacts/${artifact.id}`);
      await writeFile(join(outDir, "artifacts", item.runId, artifact.filename), bytes);
      console.log(`${item.key} · ${artifact.filename}（${(bytes.length / 1024).toFixed(1)} KB）`);
    }
  }

  await writeFile(
    join(outDir, "showcase-data.js"),
    `// 由 tooling/trace-showcase-export.mjs 生成：历史调查记录，只读。\nwindow.__TRACE_SHOWCASE__ = ${serialized};\n`,
    "utf8",
  );

  // 4) 把数据脚本挂进 index.html（先于应用脚本执行）
  const indexPath = join(outDir, "index.html");
  const html = await readFile(indexPath, "utf8");
  const injected = html.replace(
    /<script type="module"/,
    '<script src="./showcase-data.js"></script>\n    <script type="module"',
  );
  await writeFile(indexPath, injected, "utf8");

  await writeFile(
    join(outDir, "部署说明.md"),
    `# 溯证 TRACE · 只读展示版\n\n` +
      `生成时间：${new Date().toISOString()}　数据来源：本机真实运行记录（只读取，不触发检索）\n\n` +
      `## 怎么打开\n\n` +
      `- 本机：\`cd delivery/trace-showcase && python3 -m http.server 4400\`，浏览器打开 http://127.0.0.1:4400\n` +
      `- 任意静态托管：整目录上传即可（不需要 Node、不需要 Runtime、不需要任何密钥）\n\n` +
      `## 里面有什么\n\n` +
      `- 三个真实调查案例的完整页面：调查入口、调查过程、调查档案\n` +
      `- 每个案例的真实来源链接、原文摘录、支持/反对/无法确认的判断理由\n` +
      `- 档案版本切换与逐版本下载（${Object.keys(artifactIndex).length} 个档案文件在 \`artifacts/<runId>/\`）\n` +
      `- 人工修正记录与「为什么变化」说明\n\n` +
      `## 里面没有什么\n\n` +
      `- 没有运行接口：追加检索、人工修正、重新确认在只读版里被明确禁用，不会假装成功\n` +
      `- 没有密钥、没有本机路径、没有内部运行日志；导出脚本会在发现 \`sk-\` 或绝对路径时直接中止\n\n` +
      `## 需要实时自由提问怎么办\n\n` +
      `只读版不能联网。实时调查需要用受控服务端提供检索能力（具备访问控制与调用限额），` +
      `不要直接把本机 Runtime 端口映射到公网。\n`,
    "utf8",
  );

  const files = await readdir(outDir);
  const artifactFiles = await readdir(join(outDir, "artifacts"));
  console.log(`\n成品目录：delivery/trace-showcase（${files.length} 项，档案 ${artifactFiles.length} 个）`);
  console.log(`数据体积：${(Buffer.byteLength(serialized) / 1024).toFixed(0)} KB`);
}

await main();
