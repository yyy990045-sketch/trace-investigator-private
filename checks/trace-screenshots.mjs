/**
 * 溯证 TRACE 截图脚本（拍本机真实页面）。
 *
 * 用法：
 *   node checks/trace-screenshots.mjs [baseUrl] [runId] [label]
 *
 * - 只传 baseUrl：拍调查入口（移动 + 桌面）。
 * - 传 runId：额外拍该运行的调查过程页与调查档案页。
 * - label：文件名后缀，用于区分「未配置检索」与「真实案例」。
 *
 * 不注入任何数据：页面显示什么，就是 Runtime 里真实存了什么。
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] || "http://127.0.0.1:4316";
const runId = process.argv[3] || "";
const label = process.argv[4] || "current";
const outDir = "docs/screenshots";
await mkdir(outDir, { recursive: true });

// 使用本机已缓存的 Chromium（版本可能与 @playwright/test 内置清单不同，因此显式指定）。
const executablePath =
  process.env.TRACE_CHROMIUM ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath });

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

async function shot(name, path, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: "zh-CN" });
  const page = await context.newPage();
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  await context.close();
  console.log("saved", `${outDir}/${name}.png`);
}

await shot(`trace-entry-mobile-${label}`, "/", MOBILE);
await shot(`trace-entry-desktop-${label}`, "/", DESKTOP);
if (runId) {
  await shot(`trace-case-mobile-${label}`, `/cases/${runId}`, MOBILE);
  await shot(`trace-case-desktop-${label}`, `/cases/${runId}`, DESKTOP);
  await shot(`trace-archive-mobile-${label}`, `/archive/${runId}`, MOBILE);
  await shot(`trace-archive-desktop-${label}`, `/archive/${runId}`, DESKTOP);
}

await browser.close();
