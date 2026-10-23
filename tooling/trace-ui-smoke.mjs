/**
 * 完整的无密钥只读展示烟雾测试：页面、锁定案例入口、移动端。
 * 需要本地 4400 静态服务和已安装的 Playwright Chromium。
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.env.TRACE_SHOWCASE_URL || "http://127.0.0.1:4400";
const output = "delivery/trace-review-screenshots";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/#/", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /记不清.*给我线索/ }).waitFor({ timeout: 15000 });
  if (await page.locator("textarea[aria-label='你想查什么']").count())
    throw new Error("只读展示出现无法操作的假搜索输入框");
  if (!(await page.getByRole("link", { name: /查看真实调查/ }).count()))
    throw new Error("主入口不可点击");
  await page.screenshot({ path: output + "/home-desktop.png", fullPage: true });

  const examples = [
    { button: "查冲突", id: "run_5ac241c1-1049-4c4d-aaf3-4cc0c45936f6", marker: "1316.8" },
    { button: "查真假", id: "run_8f812ae8-42f3-48d1-a353-84942f770e95", marker: "氢能" },
  ];
  for (const item of examples) {
    await page.goto(base + "/#/", { waitUntil: "networkidle" });
    await page.locator(".clue-example").filter({ hasText: item.button }).first().click();
    await page.waitForURL((url) => url.hash.includes(item.id), { timeout: 15000 });
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
  await page.getByRole("link", { name: /查看真实调查/ }).click();
  await page.waitForURL((url) => url.hash.includes("run_7ff5367b-1fbc-42e3-8f7c-0b8add9b9ab6"));
  await page.getByText("2021年11月1日", { exact: false }).first().waitFor();
  await page.screenshot({ path: output + "/case-law-desktop.png", fullPage: true });

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(base + "/#/", { waitUntil: "networkidle" });
  await phone.getByRole("heading", { name: /记不清.*给我线索/ }).waitFor();
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
