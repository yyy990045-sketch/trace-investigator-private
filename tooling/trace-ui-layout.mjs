/**
 * 布局量化验收：把「排版是否整齐」变成可复现的数字。
 *
 * 用法：
 *   BASE=http://127.0.0.1:4316 CASE_ID=run_xxx \
 *   TRACE_CHROMIUM=/path/to/chrome node tooling/trace-ui-layout.mjs
 *
 * 阈值来自 V3 排版计划，任何一条不满足都会以非 0 退出码失败：
 *  - 字号阶梯最多 7 级（设计上只有 6 级：11/12/13.5/15/18/28）
 *  - 顶层区块间距只允许 0 / 4 / 8 / 12 / 16 / 24 / 32
 *  - 首页 hero ≤ 540px，且输入框与 3 个示例入口都在首屏
 *  - 案例页桌面总高 ≤ 5200px、移动端 ≤ 9000px，结论都在首屏
 *  - 任何页面都不允许横向溢出
 */
import { chromium } from "@playwright/test";

const base = (process.env.BASE || "http://127.0.0.1:4400").replace(/\/$/, "");
const caseId = process.env.CASE_ID || "";
const SCALE = new Set([0, 4, 8, 12, 16, 24, 32]);

const browser = await chromium.launch({
  headless: true,
  ...(process.env.TRACE_CHROMIUM ? { executablePath: process.env.TRACE_CHROMIUM } : {}),
});

const failures = [];
const record = [];
function expect(label, ok, detail) {
  record.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures.push(label + (detail ? "：" + detail : ""));
}

const measure = () => {
  const fonts = new Set();
  document.querySelectorAll("body *").forEach((el) => {
    if (!el.textContent || !el.textContent.trim()) return;
    if (el.children.length && el.textContent.length > 200) return;
    fonts.add(getComputedStyle(el).fontSize);
  });
  const shell = document.querySelector(".trace-page") || document.querySelector("main") || document.body;
  const kids = [...shell.children]
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: r.height };
    })
    // 自动追查之类的状态行会临时出现/消失，高度极小，不算版面区块
    .filter((k) => k.h >= 8);
  const gaps = [];
  for (let i = 1; i < kids.length; i++) gaps.push(Math.round(kids[i].top - kids[i - 1].bottom));
  return {
    docH: document.documentElement.scrollHeight,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    fontCount: fonts.size,
    gaps,
  };
};

async function open(width, height, path) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: "load", timeout: 60000 });
  // 公网实例要先领会话再取运行，慢的时候 5–8 秒才出现结论；等元素而不是死等秒数。
  await page
    .locator("textarea, .case-now, .t-verdict, .clue-page, .archive-page")
    .first()
    .waitFor({ timeout: 25000 })
    .catch(() => undefined);
  await page.waitForTimeout(1200);
  return { ctx, page };
}

try {
  // 首页
  {
    const { ctx, page } = await open(1440, 900, "/");
    const m = await page.evaluate(measure);
    const fold = await page.evaluate(() => {
      const inFold = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight + 4;
      };
      const hero = document.querySelector(".t-hero");
      const examples = [...document.querySelectorAll(".t-example, .clue-example")];
      return {
        hero: hero ? Math.round(hero.getBoundingClientRect().height) : null,
        textarea: inFold(document.querySelector("textarea")),
        examples: examples.filter(inFold).length,
      };
    });
    expect("首页无横向溢出", !m.overflowX);
    expect("首页字号 ≤7 级", m.fontCount <= 7, `${m.fontCount} 级`);
    expect("首页 hero ≤540px", fold.hero !== null && fold.hero <= 540, `${fold.hero}px`);
    expect("首页输入框在首屏", fold.textarea === true);
    expect("首页至少 3 个示例入口在首屏", fold.examples >= 3, `${fold.examples} 个`);
    await ctx.close();
  }

  if (!caseId) {
    expect("案例页检查", false, "缺少 CASE_ID，未执行案例页断言");
  } else {
    for (const [w, h, limit, label] of [
      [1440, 900, 5200, "桌面"],
      [390, 844, 9000, "移动"],
    ]) {
      const { ctx, page } = await open(w, h, "/cases/" + caseId);
      const m = await page.evaluate(measure);
      const fold = await page.evaluate(() => {
        const v = document.querySelector(".case-now, .t-verdict");
        const ev = document.querySelector(".t-key-sources, .trace-evidence-list, .t-evidence");
        const r = v ? v.getBoundingClientRect() : null;
        const e = ev ? ev.getBoundingClientRect() : null;
        return {
          verdictTop: r ? Math.round(r.top) : null,
          verdictInFold: r ? r.top < window.innerHeight : false,
          evidenceTop: e ? Math.round(e.top) : null,
        };
      });
      expect(`案例页${label}无横向溢出`, !m.overflowX);
      expect(`案例页${label}字号 ≤7 级`, m.fontCount <= 7, `${m.fontCount} 级`);
      expect(`案例页${label}总高 ≤${limit}px`, m.docH <= limit, `${m.docH}px`);
      expect(`案例页${label}结论在首屏`, fold.verdictInFold === true, `top=${fold.verdictTop}`);
      const badGaps = m.gaps.filter((gap) => !SCALE.has(gap) && Math.abs(gap) > 0);
      expect(`案例页${label}区块间距落在 8px 阶梯`, badGaps.length === 0, badGaps.length ? `越界：${badGaps.join("/")}` : "");
      if (w === 1440) {
        expect(
          "案例页桌面关键来源在首屏内可见",
          fold.evidenceTop !== null && fold.evidenceTop < 900,
          `top=${fold.evidenceTop}`,
        );
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

console.log(record.join("\n"));
if (failures.length) {
  console.error("\n布局验收未通过：\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("\n布局验收通过。");
