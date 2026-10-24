/**
 * 完整的无密钥只读展示烟雾测试：页面、锁定案例入口、移动端。
 * 需要本地 4400 静态服务和已安装的 Playwright Chromium。
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.env.TRACE_SHOWCASE_URL || "http://127.0.0.1:4400";
const output = "delivery/trace-review-screenshots";
await mkdir(output, { recursive: true });
// 允许用本机已缓存的 Chromium（不同 Playwright 版本自带的浏览器版本号不同）。
const browser = await chromium.launch({
  headless: true,
  ...(process.env.TRACE_CHROMIUM ? { executablePath: process.env.TRACE_CHROMIUM } : {}),
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/#/", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /只记得一点线索.*追到答案/ }).waitFor({ timeout: 15000 });
  if (await page.locator("textarea[aria-label='你想查什么']").count())
    throw new Error("只读展示出现无法操作的假搜索输入框");
  if (!(await page.getByRole("link", { name: /查看侦探实战/ }).count()))
    throw new Error("主入口不可点击");
  await page.screenshot({ path: output + "/home-desktop.png", fullPage: true });
  // 三条真实侦探调查从首页逐一点击：必须进入正确案件，且答案有实际渲染。
  for (const example of [
    { label: "找线索", id: "run_ce63a399-a03d-41ad-9ec2-e2fc337c4dbb", answer: "法医秦明" },
    { label: "按剧情找电影", id: "run_1413b04d-4b42-4806-9060-da6b40d1a432", answer: "源代码" },
    { label: "排除翻拍和续作", id: "run_1b4e678d-eb31-4e39-b467-a4ed80db4db0", answer: "无间道" },
  ]) {
    await page.goto(base + "/#/", { waitUntil: "networkidle" });
    const trigger = page.locator(".clue-example").filter({ hasText: example.label }).first();
    if (!(await trigger.count())) throw new Error("首页缺少真实侦探入口：" + example.label);
    await trigger.click();
    await page.waitForURL((url) => url.hash.includes(example.id), { timeout: 15000 });
    await page.getByText(example.answer, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
  }
  await page.goto(base + "/#/", { waitUntil: "networkidle" });


  const examples = [
    { button: "查冲突", id: "run_5ac241c1-1049-4c4d-aaf3-4cc0c45936f6", marker: "1316.8" },
    { button: "查真假", id: "run_8f812ae8-42f3-48d1-a353-84942f770e95", marker: "氢能" },
  ];
  for (const item of examples) {
    await page.goto(base + "/#/", { waitUntil: "networkidle" });
    await page.goto(base + "/#/cases/" + item.id, { waitUntil: "networkidle" });
    await page.waitForURL((url) => url.hash.includes(item.id), { timeout: 15000 });
    await page.locator(".trace-masthead h1").waitFor({ state: "visible", timeout: 15000 });
    if (item.button === "查冲突") {
      const numbers = page.locator(".case-now .trace-quantity-diff");
      if (!(await numbers.count())) throw new Error("调查结果首屏没有两组数字对照：" + (await page.locator(".case-now").innerText()).slice(0,500));
      await numbers.getByText("1316.8", { exact: false }).first().waitFor({ state: "visible" });
      await numbers.getByText("1288.8", { exact: false }).first().waitFor({ state: "visible" });
      await page.screenshot({ path: output + "/case-conflict-desktop.png", fullPage: true });
    } else {
      await page.getByText(item.marker, { exact: false }).filter({ visible: true }).first().waitFor();
    }
  }
  await page.goto(base + "/#/", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /查看侦探实战/ }).click();
  await page.waitForURL((url) => url.hash.includes("run_ce63a399-a03d-41ad-9ec2-e2fc337c4dbb"));
  await page.getByText("法医秦明", { exact: false }).first().waitFor();
  await page.screenshot({ path: output + "/case-detective-desktop.png", fullPage: true });

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(base + "/#/", { waitUntil: "networkidle" });
  await phone.getByRole("heading", { name: /只记得一点线索.*追到答案/ }).waitFor();
  await phone.screenshot({ path: output + "/home-mobile.png", fullPage: true });
  const overflow = await phone.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  if (overflow.content > overflow.viewport + 4)
    throw new Error("390px 页面发生横向溢出：" + JSON.stringify(overflow));
  if (errors.length) throw new Error("前端未捕获异常：" + errors.join(" | "));
  console.log("TRACE 无密钥静态展示验收通过：主页、三个 V14 案例、1440/390px，无横向溢出或页面异常。");
} finally {
  await browser.close();
}
