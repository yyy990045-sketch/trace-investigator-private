import { chromium } from "@playwright/test";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe });
const runC = "run_d34a959a-e748-4208-b9a6-eac33c1de13a";

// 公网：版本表点击切换 + 下载可用
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(`https://trace-showcase-eight.vercel.app/#/archive/${runC}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const before = await page.locator(".trace-downloads a").first().innerText();
  await page.locator(".version-compare-row").first().click();
  await page.waitForTimeout(600);
  const after = await page.locator(".trace-downloads a").first().innerText();
  console.log("public version switch:", before, "→", after, before !== after ? "OK" : "NO CHANGE");
  const href = await page.locator(".trace-downloads a").first().getAttribute("href");
  const resp = await page.request.get(new URL(href, page.url()).toString());
  console.log("public download:", resp.status(), (await resp.body()).length, "bytes");
  await ctx.close();
}

// 本机：追问入口、修正入口、版本表
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:4316/cases/${runC}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  console.log("local case now-card:", (await page.locator(".case-now-head").innerText()).replace(/\n/g, " "));
  const fix = page.locator("button", { hasText: /修正这条判断/ }).first();
  await fix.click();
  await page.waitForTimeout(300);
  console.log("local correction form:", await page.locator(".trace-correct").first().isVisible());
  await page.locator(".trace-correct-option", { hasText: "无法确认" }).first().click();
  console.log("local followup trigger:", await page.locator("button", { hasText: "追加一次检索" }).count());
  await page.locator("button", { hasText: "取消修正" }).first().click();
  await page.goto(`http://127.0.0.1:4316/archive/${runC}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.locator(".version-compare-row").nth(1).click();
  await page.waitForTimeout(500);
  console.log("local v2 downloads:", await page.locator(".trace-downloads a").allInnerTexts());
  console.log("local errors:", errors.length ? errors.slice(0, 2) : "none");
  await ctx.close();
}
await browser.close();
