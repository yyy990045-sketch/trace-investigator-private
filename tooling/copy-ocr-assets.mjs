/**
 * 把 Tesseract 的 worker 与 core 从 node_modules 复制进前端静态目录。
 *
 * 为什么不直接入库：核心运行时（worker.min.js + 三套 wasm core，约 20MB）
 * 在 npm 依赖里本来就有，入库只会让仓库为同一份二进制重复付费。
 * 语言包（traineddata.gz）npm 里没有，必须自托管，因此只有它在版本库里。
 *
 * 幂等：每次 build 前跑一遍，文件已存在且大小一致就跳过。
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "apps/trace/public/ocr");
const sources = [
  [join(root, "node_modules/tesseract.js/dist/worker.min.js"), "worker.min.js"],
  ...["relaxedsimd-lstm", "simd-lstm", "lstm"].flatMap((variant) => [
    [join(root, `node_modules/tesseract.js-core/tesseract-core-${variant}.wasm.js`), `tesseract-core-${variant}.wasm.js`],
    [join(root, `node_modules/tesseract.js-core/tesseract-core-${variant}.wasm`), `tesseract-core-${variant}.wasm`],
  ]),
];

await mkdir(target, { recursive: true });
let copied = 0;
for (const [from, name] of sources) {
  const to = join(target, name);
  try {
    const [a, b] = await Promise.all([stat(from), stat(to).catch(() => null)]);
    if (b && b.size === a.size) continue;
    await copyFile(from, to);
    copied += 1;
  } catch (error) {
    console.warn(`[ocr] 跳过 ${name}：${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`[ocr] 静态资源就绪：${sources.length} 个文件，本次复制 ${copied} 个 → ${target}`);
