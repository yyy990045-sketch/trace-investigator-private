import { chromium } from "@playwright/test";
const base = process.argv[2] || "http://127.0.0.1:4316";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe });
for (const [w, h, tag] of [[1440, 900, "desktop"], [2048, 1200, "wide"], [390, 844, "mobile"]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "zh-CN" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const el = document.querySelector(".trace-page");
    const hero = document.querySelector(".home-hero");
    return {
      pageWidth: el ? Math.round(el.getBoundingClientRect().width) : null,
      heroCols: hero ? getComputedStyle(hero).gridTemplateColumns : null,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      h1: document.querySelector(".home-hero h1")?.textContent?.replace(/\s+/g, " ").trim(),
      heroCase: !!document.querySelector(".hero-case"),
      cards: document.querySelectorAll(".home-case").length,
      claim: document.querySelector(".hero-case-claim")?.textContent?.slice(0, 40),
      counts: document.querySelector(".hero-case-counts")?.textContent?.replace(/\s+/g, " ").trim(),
      steps: [...document.querySelectorAll(".hero-case-steps li")].map((li) => li.textContent.replace(/\s+/g, " ").trim()).slice(0, 6),
    };
  });
  console.log(tag, JSON.stringify(info, null, 1));
  if (errors.length) console.log(tag, "errors:", errors.slice(0, 3));
  await page.screenshot({ path: `/tmp/home-${tag}.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
