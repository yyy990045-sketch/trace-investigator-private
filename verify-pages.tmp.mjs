import { chromium } from "@playwright/test";
const base = process.argv[2] || "http://127.0.0.1:4316";
const prefix = base.includes("vercel") || process.argv[3] === "hash" ? "/#" : "";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe });
const runs = {
  C: "run_d34a959a-e748-4208-b9a6-eac33c1de13a",
  A: "run_13dcfa4f-3074-4bdc-a36b-53b2933bb7b8",
};
for (const [w, h, tag] of [[1440, 900, "desktop"], [390, 844, "mobile"]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "zh-CN" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 140)); });
  for (const [label, id] of Object.entries(runs)) {
    for (const kind of ["cases", "archive"]) {
      await page.goto(`${base}${prefix}/${kind}/${id}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
      const info = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        maps: document.querySelectorAll(".evidence-map").length,
        diffs: document.querySelectorAll(".correction-diff").length,
        versionTable: document.querySelectorAll(".version-compare-row").length,
        verdict: document.querySelector(".trace-verdict-head h2, .trace-masthead h1")?.textContent?.slice(0, 40),
      }));
      console.log(`${tag} ${label} ${kind}`, JSON.stringify(info));
      await page.screenshot({ path: `/tmp/${kind}-${label}-${tag}.png`, fullPage: true });
    }
  }
  if (errors.length) console.log(tag, "errors:", errors.slice(0, 3));
  await ctx.close();
}
await browser.close();
