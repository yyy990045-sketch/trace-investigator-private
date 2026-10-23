import { chromium } from "@playwright/test";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe });
const runC = "run_d34a959a-e748-4208-b9a6-eac33c1de13a";
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const page = await ctx.newPage();
for (const [label, url] of [
  ["public", `https://trace-showcase-eight.vercel.app/#/archive/${runC}`],
  ["local", `http://127.0.0.1:4316/archive/${runC}`],
]) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const rows = page.locator("button.version-compare-row");
  console.log(label, "clickable rows:", await rows.count());
  for (const i of [0, 1, 2]) {
    if (i >= (await rows.count())) break;
    await rows.nth(i).click();
    await page.waitForTimeout(500);
    const label2 = await rows.nth(i).innerText().then((t) => t.split("\n")[0]);
    console.log(` ${label} ${label2} →`, (await page.locator(".trace-downloads a").allInnerTexts()).join(" , "));
  }
}
await ctx.close();
await browser.close();
