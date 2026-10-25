/**
 * 离线刷新 TRACE 只读展示页面。
 * 使用仓库里已经导出并脱敏的真实历史调查记录和档案；
 * 只重建前端，不访问 Runtime，不发起元宝搜索，不生成新的调查结果。
 */
import { execFileSync } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "delivery/trace-showcase");
const dist = join(root, "apps/trace/dist-showcase");
const dataPath = join(out, "showcase-data.js");
const record = await readFile(dataPath, "utf8");
const lockedIds = [
  "run_7ff5367b-1fbc-42e3-8f7c-0b8add9b9ab6",
  "run_5ac241c1-1049-4c4d-aaf3-4cc0c45936f6",
  "run_8f812ae8-42f3-48d1-a353-84942f770e95",
];
for (const id of lockedIds) {
  if (!record.includes(id)) throw new Error("离线历史数据缺少锁定案例：" + id);
}
if (!existsSync(join(out, "artifacts")))
  throw new Error("缺少历史档案，请先在已授权本机执行原始导出脚本。");

execFileSync("npx", ["vite", "build", "--outDir", "dist-showcase"], {
  cwd: join(root, "apps/trace"),
  env: { ...process.env, TRACE_SHOWCASE: "1", VITE_TRACE_MODE: "showcase" },
  stdio: "inherit",
});
await rm(join(out, "assets"), { recursive: true, force: true });
// 只读回放不需要 OCR 运行时（那是「上传截图」用的，回放里没有输入框）。
// 而且 wasm/js 二进制里的 vendor 字符串会被脱敏审计误判成路径泄露，所以不拷过去。
try {
  await rm(join(dist, "ocr"), { recursive: true, force: true });
} catch {
  /* 没有就跳过 */
}
await cp(dist, out, { recursive: true });
const index = join(out, "index.html");
const html = await readFile(index, "utf8");
if (!html.includes('<script type="module"')) throw new Error("前端 HTML 模块入口不存在。");
await writeFile(index, html.replace('<script type="module"', '<script src="./showcase-data.js"></script>\n    <script type="module"'), "utf8");
execFileSync("node", [join(root, "tooling/trace-showcase-audit.mjs"), out], {
  cwd: root,
  stdio: "inherit",
});
console.log("TRACE 离线只读展示已刷新；全部锁定案例数据和历史档案保留，未调用 Runtime。");
