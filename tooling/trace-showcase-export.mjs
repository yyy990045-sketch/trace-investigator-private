/**
 * TRACE 只读展示版导出。
 *
 * 做什么：从本机 Runtime 读取真实的调查记录（只发 GET 请求，不触发任何检索），
 * 把 A/B/C 和真实 DeepSeek 案例 D 的记录与档案导出为静态站点。
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
import { statisticalScopePair, statisticalCardHtml } from "../apps/trace/src/presentation.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = process.env.TRACE_RUNTIME || "http://127.0.0.1:4313";
// 成品放进 delivery/（dist/ 被 .gitignore 忽略，交付物要能随仓库一起发给评委）
const outDir = join(repo, "delivery/trace-showcase");
const appDist = join(repo, "apps/trace/dist-showcase");

/** 只选择已完成的真实运行，描述不预设新调查结果。 */
const CASES = [
  {
    key: "A",
    runId: "run_13dcfa4f-3074-4bdc-a36b-53b2933bb7b8",
    label: "有明确原始证据",
    note: "《个人信息保护法》施行日期：查看网页正文、人工修正和全部已交付版本。",
  },
  {
    key: "B",
    runId: "run_ef9af382-947a-4a9d-acd0-34b496b3d9b3",
    label: "需要跨来源核查",
    note: "2024 年中国新能源汽车产量是否超过 1200 万辆：比较年份、产量与销量口径；不把多家转引当独立证明。",
  },
  {
    key: "C",
    runId: "run_d34a959a-e748-4208-b9a6-eac33c1de13a",
    label: "补充调查后仍证据不足",
    note: "2025 年全国氢能重卡加氢网络是否已建成：追加真实检索并人工修正，结论仍是证据不足；命中网页不等于独立证据。",
  },
  {
    key: "V",
    runId: "run_488c5ff0-a71e-43e1-82a8-d1b1c1777c27",
    label: "同一句话改数量门槛",
    note: "2024年新能源汽车产量：保留1200/1300万辆门槛对照；统计局规模以上工业产品统计与工信部引用中汽协数据分开解释，不把口径差异当作同口径直接矛盾。",
  },
  {
    key: "R",
    runId: "run_2254f124-88ea-4efd-807b-f613ec4b7396",
    label: "真实反证案例",
    note: "「《民法典》自2020年5月28日起施行」是错的：2020-05-28 是通过并公布日，施行日是 2021-01-01。规则与 DeepSeek 都判为与说法相反。",
  },
  {
    key: "M",
    runId: "run_1b4e678d-eb31-4e39-b467-a4ed80db4db0",
    label: "线索侦探｜主动消歧（香港警匪片）",
    note: "命中《无间道》；《被遗忘的时光》在追加搜索后确认是片中歌曲、不是影视作品；《无间道1》关系仍未确认，如实保留。",
  },
  {
    key: "L",
    runId: "run_ce63a399-a03d-41ad-9ec2-e2fc337c4dbb",
    label: "线索侦探｜模糊线索找剧",
    note: "「国产破案剧，男主是法医，有人叫大宝」：命中《法医秦明》；《第十一根手指》按检索到的句子判为原著（改编自），不再与别名混同。",
  },
  {
    key: "F",
    runId: "run_1509cd01-d852-4afe-b988-7ede65df0839",
    label: "来源冲突｜1288.8 万辆与 1316.8 万辆",
    note: "同一句话有两种数字：统计局口径 1316.8 万辆、中汽协口径 1288.8 万辆，分别保留原文，不认定哪一方错误。",
  },
  {
    key: "H",
    runId: "run_8fed9d25-ec95-4d7c-8d99-1b6828a72fdc",
    label: "证据不足｜氢能重卡加氢网络",
    note: "问的是「全国是否已全面建成」，查到的多是局部干线投运；证据不足时明确说不确定，并列出还缺什么。",
  },
  {
    key: "N",
    runId: "run_d403d238-2c64-42f3-9c86-3c9a1b57f67c",
    label: "线索侦探｜陌生电影（八分钟循环）",
    note: "「主角坐在火车里，每次只能经历八分钟，反复调查一次爆炸」：真实检索后命中《源代码》，盗梦空间/大话西游等同题材片只作为竞争候选列出。",
  },
  {
    key: "E",
    runId: "run_e2467008-5b5f-4c14-91c1-50a70e7d49ef",
    label: "跨调查经验复用｜通过日 vs 施行日",
    note: "「《个人信息保护法》自2021年8月20日起施行」：立案时匹配到《民法典》那条已确认经验，按提示逐字比对「通过/公布」与「施行」日期；模型复核引用的仍是本次真实证据。",
  },
  {
    key: "D",
    runId: "run_895b5bfe-69f8-4878-ab41-af4fc3f3fe82",
    label: "《民法典》施行日期｜模型辅助复核",
    note: "真实元宝搜索后，DeepSeek 基于提供的证据辅助语义复核；保留原始返回、5条引用和本地人工确认记录。历史回放，不重新调用。",
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
    modelCalls: (run.modelCalls || []).map((call) => ({
      id: call.id, model: call.model, status: call.status, durationMs: call.durationMs,
      createdAt: call.createdAt, errorCode: call.errorCode,
    })),
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
    if (record.status !== "completed") throw new Error(`${item.key} 尚未完成，不可作为已交付案例发布。`);
    // 线索调查没有事实结论，导出的是「候选 + 线索比对」。
    const isClue = Boolean((record.steps || []).some((step) => step.capabilityId === "trace.clue.candidates"));
    const revisions = isClue ? null : await api(`/v1/runs/${item.runId}/trace/revisions`);
    const clue = isClue ? await api(`/v1/runs/${item.runId}/trace/clue`) : null;
    for (const artifact of record.artifacts || [])
      artifactIndex[artifact.id] = `artifacts/${item.runId}/${encodeURIComponent(artifact.filename)}`;
    // 历史经验复用：取这条调查真实记录下来的匹配与使用结果（只读展示用）。
    const experience = await api(`/v1/runs/${item.runId}/trace/experiences`);
    const assessment = sanitize(clue || revisions?.current || null);
    if (assessment && Array.isArray(experience.hints) && experience.hints.length)
      assessment.experiences = sanitize(experience.hints);
    cases.push({
      key: item.key,
      label: item.label,
      note: item.note,
      runId: item.runId,
      run: trimRun(record),
      assessment,
      revisions: sanitize(revisions || { deliveredRevision: 0, dirty: false, pendingFollowups: 0, pendingCorrections: 0, current: null, changes: [], revisions: [] }),
      experienceUsage: sanitize(experience.usage || []),
      experienceDetected: sanitize(experience.detected || null),
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
  // 只替换生成的前端资产，保留已发布档案和已有 .vercel 项目绑定。
  if (existsSync(join(outDir, "assets"))) await rm(join(outDir, "assets"), { recursive: true, force: true });
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
      const target = join(outDir, "artifacts", item.runId, artifact.filename);
      if (existsSync(target)) {
        if (!(await readFile(target)).equals(bytes)) throw new Error(`历史档案内容不一致，拒绝覆盖：${artifact.filename}`);
      } else await writeFile(target, bytes);
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
      `- A/B/C 三次真实查询与 D DeepSeek 辅助语义复核：调查入口、调查过程、调查档案\n` +
      `- D 保留真实模型返回、5条引用、调用耗时和本地验收确认；没有实时模型接口\n` +
      `- 事实拆解仍由人工完成；搜索、规则、模型辅助意见和人工交付分别标明\n` +
      `- 页面校正来源独立性措辞，历史档案保留原样，不代表重新确认\n` +
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

  // ── 事实对照卡（静态文件，供评委单独下载；不改动任何调查档案）──
  const pairs = [
    { file: "民法典日期对照卡.md", left: "R", right: "D", title: "《民法典》施行日期对照" },
    { file: "新能源产量对照卡.md", left: "B", right: "V", title: "2024 新能源汽车产量门槛对照" },
  ];
  const OUTCOME = { supported: "有依据支持", contradicted: "存在反证", disputed: "存在争议", outdated: "信息过期或原文不足", insufficient: "证据不足" };
  await mkdir(join(outDir, "facts"), { recursive: true });
  for (const pair of pairs) {
    const left = cases.find((entry) => entry.key === pair.left);
    const right = cases.find((entry) => entry.key === pair.right);
    if (!left || !right) continue;
    const side = (entry, label) => {
      const assessment = entry.assessment || {};
      const verdict = assessment.verdict || {};
      const facts = (assessment.facts || [])[0] || {};
      const sources = (facts.sources || []).filter((source) => source.keySentence).slice(0, 3);
      return [
        `## ${label}`,
        ``,
        `- 说法：${(entry.run.steps || []).find((step) => step.capabilityId === "trace.case.intake")?.output?.case?.claim || ""}`,
        `- 结论：${OUTCOME[verdict.outcome] || verdict.outcome || "记录"}`,
        `- 说明：${verdict.statement || ""}`,
        `- 规模：${verdict.counts?.pages ?? "—"} 条网页 / ${assessment.independentSources ?? "—"} 个未检测到重复 / ${assessment.bodyAvailable ?? "—"} 份原文`,
        `- 支持 ${facts.supports ?? 0} 条、反证 ${facts.contradicts ?? 0} 条、无法确认 ${facts.unclear ?? 0} 条`,
        ...sources.map((source) => `- 关键原文：${source.site}｜${source.title}｜「${String(source.keySentence || "").slice(0, 160)}」${source.url}`),
        `- 调查档案：https://trace-showcase-eight.vercel.app/#/archive/${entry.runId}`,
        ``,
      ];
    };
    const body = [
      `# 事实对照卡：${pair.title}`,
      ``,
      `> 两次调查分别真实执行（元宝搜索检索 + 规则判定，D/V 含 DeepSeek 辅助复核）。本卡不重新判断真假，只并列结果与原文。`,
      ``,
      ...side(left, "原句"),
      ...side(right, "修改后"),
      `## 说明`,
      ``,
      `- 未检测到重复不等于已证明独立；仍不确定的部分见各自档案。`,
      `- 本卡为静态文件，不包含任何密钥、本机路径或个人身份信息。`,
      ``,
    ].join("\n");
    await writeFile(join(outDir, "facts", pair.file), body, "utf8");
    if (pair.right === "V") {
      const scopes = statisticalScopePair((right.assessment?.facts || []).flatMap((fact) => fact.sources));
      if (scopes) {
        const claim = right.run.steps.find((step) => step.capabilityId === "trace.case.intake")?.output?.case?.claim || "";
        await writeFile(join(outDir,"facts","新能源产量视觉对照卡.html"), statisticalCardHtml(claim, scopes), "utf8");
      }
    }
  }

  const files = await readdir(outDir);
  const artifactFiles = await readdir(join(outDir, "artifacts"));
  console.log(`\n成品目录：delivery/trace-showcase（${files.length} 项，档案 ${artifactFiles.length} 个）`);
  console.log(`数据体积：${(Buffer.byteLength(serialized) / 1024).toFixed(0)} KB`);
}

await main();
