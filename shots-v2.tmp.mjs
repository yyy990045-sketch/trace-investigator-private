import { chromium } from "@playwright/test";
const base = "https://trace-showcase-eight.vercel.app";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe });
const targets = [
  ["home", "/"],
  ["case-c", "/#/cases/run_d34a959a-e748-4208-b9a6-eac33c1de13a"],
  ["archive-c", "/#/archive/run_d34a959a-e748-4208-b9a6-eac33c1de13a"],
  ["archive-a", "/#/archive/run_13dcfa4f-3074-4bdc-a36b-53b2933bb7b8"],
];
const viewports = [
  [1440, 900, "desktop"],
  [390, 844, "mobile"],
  [2048, 1200, "wide"],
];
const report = [];
for (const [name, path] of targets) {
  for (const [w, h, tag] of viewports) {
    if (tag === "wide" && name !== "home") continue;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: "zh-CN" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(1100);
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    await page.screenshot({ path: `docs/screenshots/trace-v2-${name}-${tag}.png`, fullPage: true });
    report.push(`${name}-${tag}: ${o.sw === o.cw ? "ok" : "OVERFLOW " + o.sw + ">" + o.cw}${errors.length ? " errors:" + errors.slice(0, 2).join(" / ") : ""}`);
    await ctx.close();
  }
}
await browser.close();
console.log(report.join("\n"));
