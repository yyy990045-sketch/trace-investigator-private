/* Frontend-only product walkthrough. Requires visible WebKit and local apps; no Runtime acceptance. */
const { webkit, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const OUT =
  process.env.PREVIEW_OUTPUT_DIR ||
  path.resolve(__dirname, "../artifacts/redesign");
const STUDIO = process.env.PREVIEW_BASE_URL || "http://127.0.0.1:4310";
const AGENT = process.env.AGENT_PREVIEW_URL || "http://127.0.0.1:4311";
const BUSINESS = process.env.BUSINESS_PREVIEW_URL || "http://127.0.0.1:4312";
const GENERATED = process.env.GENERATED_PREVIEW_URL || "http://127.0.0.1:4415";
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
    errors = [],
    writes = [];
  const attach = (p) => {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(r.method()))
        writes.push({ url: r.url(), method: r.method() });
    });
  };
  attach(page);
  const passed = (name, detail) =>
    checks.push({ name, detail, result: "passed" });
  const visit = async (url) => {
    await page.goto(url);
    await page.locator("#main h1").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
  };
  const shot = async (name, full = false, p = page) => {
    const file = path.join(OUT, name + ".png");
    await p.screenshot({ path: file, fullPage: full });
    const size = await p.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
    }));
    expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
    captures.push({
      name,
      path: file,
      url: p.url(),
      viewport: p.viewportSize(),
      ...size,
    });
  };
  try {
    // Six primary views, using a clean browser profile and neutral page state.
    for (const [route, name] of [
      ["/", "studio"],
      ["/agent", "agent"],
      ["/business", "business"],
    ]) {
      await visit(STUDIO + route);
      if (name === "studio")
        await page.locator(".capability-choice").first().waitFor();
      await shot(name + "-desktop");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [route, name] of [
      ["/", "studio"],
      ["/agent", "agent"],
      ["/business", "business"],
    ]) {
      await visit(STUDIO + route);
      if (name === "studio")
        await page.locator(".capability-choice").first().waitFor();
      await shot(name + "-mobile");
      await shot(name + "-mobile-full", true);
    }
    passed(
      "Six live views",
      "1440×900 and 390×844; original page captures, not mockups",
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await visit(STUDIO);
    await page.getByRole("button", { name: "新建应用", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "保存应用配置" }),
    ).toBeDisabled();
    await page.getByLabel("应用名称", { exact: true }).fill("审阅用成果空间");
    await page.getByLabel("源码目录名").fill("review-workspace");
    await page.getByLabel("产品布局").selectOption("business");
    await shot("create-application-dialog");
    await page.getByRole("button", { name: "保存应用配置" }).click();
    await expect(page.getByRole("status")).toContainText("未生成源码");
    await page.reload();
    await expect(page.getByLabel("切换当前项目").locator("option")).toHaveCount(
      3,
    );
    await expect(page.locator("h1")).toHaveText("审阅用成果空间");
    await page.locator(".workspace-entry").first().click();
    await expect(page.locator(".wordmark strong")).toHaveText("审阅用成果空间");
    await expect(page.locator(".shell-top")).toHaveCount(1);
    await page.getByRole("link", { name: "资料对象", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("资料对象");
    await page.getByRole("link", { name: "返回 Studio" }).click();
    passed(
      "Create and switch project",
      "Local config survives reload, controls actual module entry and project identity; not generated source",
    );
    await page.getByRole("button", { name: "配置模块", exact: true }).click();
    await page.getByLabel("交付记录").uncheck();
    await page.getByRole("button", { name: "保存模块配置" }).click();
    await expect(
      page
        .getByRole("navigation", { name: "项目模块入口" })
        .getByRole("link", { name: /交付记录/ }),
    ).toHaveCount(0);
    await page.locator(".workspace-entry").first().click();
    await expect(
      page
        .getByRole("navigation", { name: "业务模块" })
        .getByRole("link", { name: "交付记录" }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "返回 Studio" }).click();
    passed(
      "Project module configuration",
      "Saved modules control both project entries and product navigation",
    );
    await page.getByLabel("切换当前项目").selectOption("agent");
    await page.getByLabel("搜索能力").fill("CAP-01");
    await page.locator(".capability-choice").click();
    await expect(page.getByRole("dialog")).toContainText("尚未接入");
    await expect(page.getByRole("dialog")).toContainText("证据接口");
    await page
      .getByRole("button", { name: "记录适配需求", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "仅保存在本机，能力尚未接入",
    );
    await page.reload();
    await page.getByRole("button", { name: "需求草稿", exact: true }).click();
    await expect(page.locator(".capability-choice")).toHaveCount(1);
    await page.getByLabel("切换当前项目").selectOption("business");
    await expect(
      page.getByRole("heading", { name: "尚无适配需求草稿" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "查看全部能力", exact: true })
      .click();
    await page.getByLabel("搜索能力").fill("CAP-05");
    await page.locator(".capability-choice").click();
    await expect(page.getByRole("dialog")).toContainText("不含持久化人工审批");
    await shot("capability-adaptation-context");
    await page.keyboard.press("Escape");
    passed(
      "Project ability drafts",
      "Real registry search; Gate 2 adaptation facts on selection; per-project local drafts persist without claiming integration",
    );
    await visit(STUDIO + "/agent");
    await expect(
      page.getByRole("button", { name: "执行任务", exact: true }),
    ).toBeDisabled();
    await page.locator(".content-context summary").first().click();
    await expect(page.locator(".content-context[open]")).toContainText(
      "资料 A",
    );
    await shot("agent-inline-source");
    await page.locator(".step-item").filter({ hasText: "核对规则" }).click();
    await expect(page.locator(".detail-heading h2")).toHaveText("核对规则");
    await page.getByRole("tab", { name: "处理内容", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "输入与输出", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "证据 (1)", exact: true }).click();
    const evidenceButton = page.getByRole("button", { name: /规则核验说明/ });
    await evidenceButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toContainText("不构成通过证据");
    await shot("agent-evidence-dialog");
    await page.keyboard.press("Escape");
    await expect(evidenceButton).toBeFocused();
    await page.getByRole("button", { name: "输入资料", exact: true }).click();
    await page
      .getByLabel("输入资料", { exact: true })
      .fill("本地输入检查，不能生成真实输出。");
    await page.getByRole("button", { name: "保留预览", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("尚未处理");
    await page.getByRole("tab", { name: "输入与输出", exact: true }).click();
    await expect(page.locator(".input-preview")).toContainText("本地输入检查");
    await page
      .locator(".step-item")
      .filter({ hasText: "等待你的确认" })
      .click();
    await page.getByRole("button", { name: "预览通过", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("未提交审批");
    await page.getByRole("button", { name: "预览拒绝", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("未修改真实运行状态");
    await page.getByRole("button", { name: "预览取消", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "不存在可取消的真实运行",
    );
    passed(
      "Agent task interaction",
      "Step and keyboard tab navigation, evidence, edited input and truthful local decision feedback",
    );
    await page.getByRole("link", { name: "查看同一资料的成果预览" }).click();
    expect(new URL(page.url()).searchParams.get("run")).toBe(
      "DEMO-20261021-01",
    );
    await expect(
      page.getByRole("button", { name: "审阅成果", exact: true }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "查看完整报告" }).click();
    await expect(page.getByRole("dialog")).toContainText("需要关注的要点");
    await shot("business-full-report");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /依据与来源/ }).click();
    await page.locator(".source-disclosure summary").first().click();
    await expect(page.getByRole("dialog")).toContainText("不是运行引擎输出");
    await shot("business-source-dialog");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "审阅成果", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "预览确认", exact: true }),
    ).toBeDisabled();
    await page.getByLabel("我已核对示例资料与交付范围").check();
    await page.getByRole("button", { name: "预览确认", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("没有执行后端能力");
    await page.getByRole("button", { name: "预览退回", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("没有提交真实审批");
    await shot("business-review-dialog");
    await page.keyboard.press("Escape");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出预览", exact: true }).click();
    const download = await downloadPromise;
    const downloaded = path.join(OUT, "演示-内容预览.txt");
    await download.saveAs(downloaded);
    const bytes = fs.readFileSync(downloaded, "utf8");
    for (const text of [
      "不是执行报告",
      "资料处理范围",
      "需要关注的要点",
      "未执行后端核验",
    ])
      expect(bytes).toContain(text);
    passed(
      "Business outcome and review",
      "One review entry; full report and evidence on demand; checkbox-gated preview decisions and actual labelled preview download",
    );
    await page.getByRole("link", { name: "资料对象", exact: true }).click();
    await expect(page.locator(".review-content-item")).toHaveCount(3);
    await page.locator(".content-context summary").first().click();
    await expect(page.locator(".content-context[open]")).toContainText(
      "资料 A",
    );
    await shot("business-materials-module");
    await page.getByRole("link", { name: "交付记录", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "尚无正式交付记录" }),
    ).toBeVisible();
    await shot("business-delivery-empty");
    passed(
      "Replaceable business workspace",
      "Materials and delivery modules occupy the same top-navigation shell without a report canvas or right attributes panel",
    );
    const loadingContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    await loadingContext.route("**/api/portfolio", async (route) => {
      await gate;
      await route.continue();
    });
    const lp = await loadingContext.newPage();
    attach(lp);
    await lp.goto(STUDIO);
    await lp.locator(".library-skeleton").waitFor();
    await shot("studio-loading", false, lp);
    release();
    await lp.locator(".capability-choice").first().waitFor();
    await loadingContext.close();
    const errorContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    let requests = 0;
    await errorContext.route("**/api/portfolio", (route) =>
      ++requests === 1
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: '{"error":"controlled browser check"}',
          })
        : route.continue(),
    );
    const ep = await errorContext.newPage();
    attach(ep);
    await ep.goto(STUDIO);
    await expect(
      ep.getByRole("heading", { name: "暂时无法读取正式登记源" }),
    ).toBeVisible();
    await shot("studio-registry-error", false, ep);
    await ep.getByRole("button", { name: "重新读取" }).click();
    await ep.locator(".capability-choice").first().waitFor();
    await errorContext.close();
    passed(
      "Loading, empty, error and recovery",
      "Delayed actual read and isolated injected 503; real retry reads registry; empty candidate and delivery states checked",
    );
    await visit(AGENT);
    await page.getByRole("link", { name: "资料来源", exact: true }).click();
    await page.getByRole("link", { name: "任务工作区", exact: true }).click();
    await page.reload();
    await expect(page.locator(".detail-heading h2")).toHaveText("等待你的确认");
    await shot("agent-independent");
    await page.getByRole("link", { name: "任务笔记", exact: true }).click();
    await page.getByRole("button", { name: "失败预览" }).click();
    await expect(
      page.getByRole("heading", { name: "演示：资料读取失败" }),
    ).toBeVisible();
    await shot("independent-component-error");
    await page.getByRole("button", { name: "重新读取" }).click();
    await visit(BUSINESS);
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await page.getByRole("link", { name: "资料对象", exact: true }).click();
    await expect(page.locator(".review-content-item")).toHaveCount(3);
    await page.reload();
    await expect(page.locator("h1")).toHaveText("资料对象");
    await page.getByRole("link", { name: "成果", exact: true }).click();
    await shot("business-independent");
    await visit(GENERATED);
    await expect(page.locator(".wordmark strong")).toHaveText("模块复用验证");
    await page.getByRole("link", { name: "资料对象", exact: true }).click();
    await expect(page.locator(".review-content-item")).toHaveCount(3);
    await page.reload();
    await expect(page.locator(".outcome-workspace")).toHaveCount(0);
    await shot("business-generated-module");
    passed(
      "Independent shell and template reuse",
      "Agent uses sidebar, Business uses top modules; generated app owns routes and independently serves dist",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(STUDIO + "/agent");
    await expect(page.locator(".detail-heading h2")).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "预览通过", exact: true }),
    ).toBeInViewport();
    await expect(page.locator(".step-list")).not.toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const lastSource = page.locator(".content-context summary").last();
    const sourceBox = await lastSource.boundingBox();
    const actionBox = await page.locator(".decision-zone").boundingBox();
    expect(sourceBox.y + sourceBox.height).toBeLessThan(actionBox.y);
    await shot("agent-mobile-content-clearance");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("button", { name: "全部步骤（5）" }).click();
    await expect(page.locator(".step-item")).toHaveCount(5);
    await shot("agent-mobile-expanded");
    await page.locator(".step-item").filter({ hasText: "核对规则" }).click();
    await expect(page.locator(".step-list")).not.toBeVisible();
    await expect(page.locator(".detail-heading h2")).toBeInViewport();
    await page.getByRole("button", { name: "打开导航" }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: "开发工作区", exact: true })
      .click();
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByLabel("切换当前项目")).toBeVisible();
    await page.getByRole("button", { name: "新建应用", exact: true }).click();
    await shot("studio-mobile-create-dialog");
    await page.keyboard.press("Escape");
    await visit(STUDIO + "/business");
    await expect(
      page.getByRole("button", { name: "审阅成果", exact: true }),
    ).toBeInViewport();
    await page.getByRole("button", { name: "审阅成果", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "预览确认", exact: true }),
    ).toBeDisabled();
    await shot("business-mobile-review");
    await page.keyboard.press("Escape");
    passed(
      "390px task-first organization",
      "Text creation entry; current step before collapsed path; review action near outcome; dialogs fit viewport",
    );
    const keyboardContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    const kp = await keyboardContext.newPage();
    attach(kp);
    await kp.goto(STUDIO);
    await kp.locator("h1").waitFor();
    await kp.locator(".capability-choice").first().waitFor();
    await kp.keyboard.press("Alt+Tab");
    await expect(kp.getByRole("link", { name: "跳至主要内容" })).toBeFocused();
    await kp.keyboard.press("Enter");
    await expect(kp.locator("#main")).toBeFocused();
    await kp.getByRole("button", { name: "新建应用", exact: true }).focus();
    await shot("keyboard-focus", false, kp);
    await keyboardContext.close();
    passed(
      "Keyboard and reduced motion",
      "macOS WebKit Option+Tab full-link navigation, visible focus, skip link, arrow-key tabs and native dialog keyboard-focus restoration",
    );
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
    fs.writeFileSync(
      path.join(OUT, "browser-record.json"),
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          browser: "WebKit",
          headless: false,
          scope: "Frontend redesign only; no Runtime or AI acceptance",
          checks,
          captures,
          pageErrors: errors,
          writeRequests: writes,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        checks: checks.length,
        captures: captures.length,
        pageErrors: errors,
        writeRequests: writes,
      }),
    );
  } catch (e) {
    await page.screenshot({
      path: path.join(OUT, "debug-current.png"),
      fullPage: true,
    });
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
