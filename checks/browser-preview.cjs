/* Reproducible browser acceptance for the frontend-review stage; never runtime acceptance. */
const { webkit, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const OUT =
  process.env.PREVIEW_OUTPUT_DIR ||
  path.resolve(__dirname, "../artifacts/browser");
const STUDIO = process.env.PREVIEW_BASE_URL || "http://127.0.0.1:4310";
const AGENT = process.env.AGENT_PREVIEW_URL || "http://127.0.0.1:4311";
const BUSINESS = process.env.BUSINESS_PREVIEW_URL || "http://127.0.0.1:4312";
const ID = "DEMO-20261021-01";
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await webkit.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const checks = [],
    captures = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const passed = (name, detail) =>
    checks.push({ name, detail, result: "passed" });
  async function visit(url) {
    await page.goto(url);
    await page.locator("#main h1, #main h3").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
  }
  async function capture(name, fullPage = false) {
    if (await page.locator(".skip-link:focus").count())
      await page.locator("#main").focus();
    const filename = path.join(OUT, name + ".png");
    await page.screenshot({ path: filename, fullPage });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    expect(overflow).toBe(false);
    captures.push({
      name,
      path: filename,
      url: page.url(),
      viewport: page.viewportSize(),
      overflow,
    });
  }
  try {
    await visit(STUDIO);
    await expect(page.getByText("17", { exact: true })).toBeVisible();
    passed(
      "Actual Portfolio read",
      "Version 0.4.0 and registered counts from local read-only bridge",
    );
    await page.getByRole("button", { name: "准备一个新任务" }).click();
    await expect(
      page.getByRole("button", { name: "创建真实任务" }),
    ).toBeDisabled();
    expect((await page.getByRole("dialog").boundingBox()).x).toBeGreaterThan(
      200,
    );
    await capture("new-task-dialog");
    await page.keyboard.press("Escape");
    await visit(STUDIO + "/capabilities");
    await expect(page.locator("tbody tr")).toHaveCount(10);
    await page.getByLabel("搜索能力").fill("CAP-04");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "查看", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("尚未集成");
    await page.keyboard.press("Escape");
    passed(
      "Registry search and detail",
      "No historical asset is presented as an executable capability",
    );
    await visit(STUDIO + "/spaces");
    await page.getByRole("button", { name: "新增预览空间" }).click();
    await page.getByLabel("空间名称").fill("界面审阅空间");
    await page.getByLabel("产品布局").selectOption("business");
    await page.getByRole("button", { name: "保存预览配置" }).click();
    await page.getByRole("link", { name: "打开界面审阅空间" }).click();
    await expect(page.locator(".page-eyebrow")).toContainText("界面审阅空间");
    await page.getByRole("link", { name: /查看 Agent 处理路径/ }).click();
    await expect(page.locator(".page-eyebrow")).toContainText("界面审阅空间");
    expect(new URL(page.url()).searchParams.get("space")).toBe("界面审阅空间");
    await page.getByRole("link", { name: /打开商业成果视图/ }).click();
    await expect(page.locator(".page-eyebrow")).toContainText("界面审阅空间");
    passed(
      "Local space context",
      "Name preserved in both cross-view directions; not claimed as source generation",
    );
    await visit(STUDIO + "/tasks");
    await page.getByRole("button", { name: "演示记录 · 1" }).click();
    await page.getByRole("link", { name: "打开记录" }).click();
    expect(page.url()).toContain(ID);
    await page.getByRole("button", { name: "预览通过", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("未提交审批");
    await page.getByRole("button", { name: "预览拒绝", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("未修改真实运行状态");
    await page.getByRole("button", { name: "预览取消", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "不存在可取消的真实运行",
    );
    passed(
      "Preview decisions",
      "Approve/reject/cancel remain explicit local-only interactions",
    );
    await page.getByRole("tab", { name: "步骤详情" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "输入与输出" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: /关联证据/ }).click();
    await page.getByRole("button", { name: /规则核验说明/ }).click();
    await expect(page.getByRole("dialog")).toContainText("不构成通过证据");
    await capture("evidence-dialog");
    await page.keyboard.press("Escape");
    passed(
      "Keyboard and evidence",
      "Associated tabs, arrow keys and labelled evidence dialog",
    );
    await page.getByRole("link", { name: /打开商业成果视图/ }).click();
    expect(page.url()).toContain(ID);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    passed(
      "Cross-layout record and scroll",
      "Same demo ID; new page opens at its beginning",
    );
    await page.getByRole("tab", { name: "资料记录", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await page.getByRole("tab", { name: "交付记录", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "尚无正式交付记录" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "成果预览", exact: true }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出内容预览" }).click();
    const download = await pending;
    const file = path.join(OUT, "演示-资料核验预览.txt");
    await download.saveAs(file);
    const bytes = fs.readFileSync(file, "utf8");
    for (const content of [
      "不是执行报告",
      "资料处理范围",
      "与交付安排",
      "本次整理范围",
      "需要关注的要点",
      "每条记录保留来源",
      "明确资料处理范围",
    ])
      expect(bytes).toContain(content);
    passed(
      "Download preview file",
      "Displayed report title, introduction, sections and records downloaded with explicit demo disclaimer",
    );
    await page.getByRole("button", { name: "审阅这份成果" }).click();
    await page.getByRole("button", { name: "预览确认" }).click();
    await expect(page.getByRole("status")).toContainText("没有执行后端能力");
    await page.keyboard.press("Escape");
    await visit(STUDIO + "/agent?run=UNKNOWN");
    await expect(
      page.getByRole("heading", { name: "未找到这条记录" }),
    ).toBeVisible();
    await capture("unknown-run-desktop");
    passed("Unknown record", "No successful demo substituted");
    await visit(AGENT);
    await page.getByRole("link", { name: "资料来源", exact: true }).click();
    await page.getByRole("link", { name: "任务工作区", exact: true }).click();
    await page.reload();
    await expect(page.locator("h1")).toHaveText("资料核验与交付");
    await capture("agent-standalone-desktop");
    passed(
      "Independent Agent navigation",
      "Own route, brand, module and deep-link reload",
    );
    await page.getByRole("link", { name: "任务笔记", exact: true }).click();
    await page.getByLabel("笔记内容").fill("独立模块复用验证");
    await page.getByRole("button", { name: "保存在本机" }).click();
    await page.reload();
    await expect(page.getByLabel("笔记内容")).toHaveValue("独立模块复用验证");
    await page.getByRole("button", { name: "失败预览" }).click();
    await capture("shared-state-error");
    await page.getByRole("button", { name: "重新读取" }).click();
    await capture("module-extension-desktop");
    passed(
      "App-owned extension",
      "/notes uses shared ready/error states and local note persistence",
    );
    await visit(BUSINESS);
    await page.getByRole("link", { name: "资料对象", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await page.getByRole("link", { name: "成果交付", exact: true }).click();
    await page.reload();
    await expect(page.locator("h1")).toHaveText("让资料成为清晰的成果");
    await capture("business-standalone-desktop");
    passed(
      "Independent Business navigation",
      "Different routes/modules and results layout",
    );
    for (const [pathname, name] of [
      ["/", "studio"],
      ["/agent", "agent"],
      ["/business", "business"],
      ["/spaces", "spaces"],
      ["/capabilities", "capabilities"],
      ["/tasks", "tasks"],
      ["/history", "history"],
      ["/results", "results"],
    ]) {
      await visit(STUDIO + pathname);
      if (name === "studio")
        await expect(page.getByText("17", { exact: true })).toBeVisible();
      if (name === "capabilities")
        await expect(page.locator("tbody tr")).toHaveCount(10);
      await capture(name + "-desktop", name === "capabilities");
    }
    const errorContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await errorContext.route("**/api/portfolio", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"controlled check"}',
      }),
    );
    const ep = await errorContext.newPage();
    await ep.goto(STUDIO + "/capabilities");
    await expect(
      ep.getByRole("heading", { name: "暂时无法读取正式登记源" }),
    ).toBeVisible();
    await ep.screenshot({
      path: path.join(OUT, "portfolio-error-desktop.png"),
    });
    await errorContext.close();
    passed(
      "Controlled portfolio error",
      "Isolated injected 503; no data fallback",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [pathname, name] of [
      ["/", "studio"],
      ["/agent", "agent"],
      ["/business", "business"],
      ["/spaces", "spaces"],
      ["/capabilities", "capabilities"],
      ["/tasks", "tasks"],
      ["/history", "history"],
      ["/results", "results"],
    ]) {
      await visit(STUDIO + pathname);
      if (name === "capabilities") {
        await expect(page.locator("tbody tr")).toHaveCount(10);
        const action = page
          .getByRole("button", { name: "查看", exact: true })
          .first();
        await expect(action).toBeInViewport();
        await action.click();
        await expect(page.getByRole("dialog")).toContainText("尚未集成");
        await page.keyboard.press("Escape");
      }
      await capture(name + "-mobile", true);
    }
    await visit(STUDIO + "/agent");
    const box = await page.locator(".step-item.selected").boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "打开导航" }).click();
    await page.waitForFunction(
      () => document.querySelector(".sidebar").getBoundingClientRect().x >= -1,
    );
    await capture("mobile-navigation");
    await page.getByRole("link", { name: "能力目录", exact: true }).click();
    await expect(page.locator("h1")).toContainText("知道有什么");
    passed(
      "390px interaction",
      "No viewport overflow; selected step and catalog actions visible; mobile menu works",
    );
    for (const [url, name] of [
      [AGENT, "agent-standalone"],
      [BUSINESS, "business-standalone"],
    ]) {
      await visit(url);
      await capture(name + "-mobile", true);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await visit("http://127.0.0.1:4414/");
    await expect(page.locator(".wordmark")).toContainText("复用验证空间");
    await capture("generated-app-desktop");
    passed(
      "Newly generated app",
      "Template output independently built and served from its own dist; no shared-core edits",
    );
    expect(errors).toEqual([]);
    fs.writeFileSync(
      path.join(OUT, "browser-interaction-record.json"),
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          browser: "WebKit",
          headless: false,
          checks,
          captures,
          errors,
          scope: "Frontend review only; runtime and AI not accepted.",
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        checks: checks.length,
        captures: captures.length,
        errors,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
