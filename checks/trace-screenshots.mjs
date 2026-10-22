/**
 * 溯证 TRACE 截图脚本（本机真实页面）。
 *
 * 用法：
 *   node checks/trace-screenshots.mjs [baseUrl] [runId]
 *
 * 不注入任何数据：页面显示什么，就是 Runtime 里真实存了什么。
 * 当前未配置元宝搜索密钥时，入口必然显示「检索不可用」并禁用开始按钮，
 * 这是产品的真实状态，截图如实记录。
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] || "http://127.0.0.1:4316";
const runId = process.argv[3] || "";
const outDir = "docs/screenshots";
await mkdir(outDir, { recursive: true });

// 使用本机已缓存的 Chromium（版本可能与 @playwright/test 内置清单不同，因此显式指定）。
const executablePath =
  process.env.TRACE_CHROMIUM ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath });
async function shot(name, path, viewport, prepare) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  if (prepare) await prepare(page);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  await context.close();
  console.log("saved", `${outDir}/${name}.png`);
}

await shot("trace-entry-mobile", "/", { width: 390, height: 844 });
await shot("trace-entry-desktop", "/", { width: 1440, height: 900 });

if (runId) {
  await shot("trace-case-search-blocked-mobile", `/cases/${runId}`, { width: 390, height: 844 });
  await shot("trace-case-search-blocked-desktop", `/cases/${runId}`, { width: 1440, height: 900 });
  await shot("trace-archive-pending-mobile", `/archive/${runId}`, { width: 390, height: 844 });
}

await browser.close();
