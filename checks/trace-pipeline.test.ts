/**
 * TRACE 调查流水线自动化检查。
 *
 * 这里的本地 HTTP 服务只是「模拟服务端」，用来验证适配器对官方响应结构的解析与错误处理；
 * 它不产出任何产品内容，产品界面与验收档案里出现的来源永远来自真实元宝搜索响应。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { planFactQueries } from "../services/runtime/src/query-plan.ts";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 45917;
const ENDPOINT = `http://127.0.0.1:${PORT}/SearchPro`;

const FACT_TEXT = "某市2024年新能源汽车产量为120万辆";
const SUPPORT_PASSAGE =
  "本市统计局发布2024年统计公报：全市新能源汽车产量120万辆，同比增长明显。该数据来自市统计局官网。";
const DUPLICATE_PASSAGE =
  "本市统计局发布2024年统计公报：全市新能源汽车产量120万辆，同比增长明显。该数据来自市统计局官网。";

function page(overrides: Record<string, unknown>) {
  return JSON.stringify({
    passage: "",
    score: 0.8,
    date: "2024-06-07 19:00:51",
    title: "",
    url: "https://example.com/a",
    site: "示例",
    images: [],
    favicon: "",
    ...overrides,
  });
}

let server: Server;
let requestCount = 0;
let rateLimited = 0;
let unauthorized = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/SearchPro") {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    requestCount++;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const query = JSON.parse(body || "{}").Query || "";
      if (query === "触发限流") {
        if (rateLimited < 1) {
          rateLimited++;
          res.statusCode = 429;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ Error: { Code: "RequestLimitExceeded", Message: "请求的次数超过了频率限制。" } }));
          return;
        }
      }
      if (query === "触发鉴权失败") {
        unauthorized++;
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ Error: { Code: "UnauthorizedOperation", Message: "未授权操作。" } }));
        return;
      }
      if (query === "空结果") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ Response: { Pages: [], Query: "空结果", RequestId: "req-empty" } }));
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          Response: {
            // 官方返回：Pages 每一项都是被二次序列化的 JSON 字符串
            Pages: [
              page({ title: "市统计局：2024年统计公报", url: "https://stats.example.gov.cn/a.html", site: "统计局", passage: SUPPORT_PASSAGE, score: 0.91 }),
              page({ title: "转载：2024年统计公报", url: "https://news.example.com/b.html", site: "转载站", passage: DUPLICATE_PASSAGE, score: 0.88 }),
              page({ title: "转载：2024年统计公报", url: "https://portal.example.net/c.html", site: "门户", passage: DUPLICATE_PASSAGE, score: 0.85 }),
            ],
            Query: query,
            RequestId: "req-" + requestCount,
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 环境变量必须在调用适配器前设置，因为这些函数在调用时才读取。 */
function useMockEndpoint() {
  process.env.PLATFORM_WSA_ENDPOINT = ENDPOINT;
  process.env.PLATFORM_WSA_API_KEY = "sk-local-test-only";
  process.env.PLATFORM_WSA_MAX_ATTEMPTS = "3";
  process.env.PLATFORM_TRACE_FETCH_ENABLED = "false";
}

describe("元宝搜索适配器", () => {
  it("未配置密钥时明确阻塞，不返回任何网页", async () => {
    delete process.env.PLATFORM_WSA_API_KEY;
    const { searchConfiguration, searchPro } = await import("../services/runtime/adapters/trace/searchpro.ts");
    expect(searchConfiguration().available).toBe(false);
    const attempt = await searchPro("任意查询");
    expect(attempt.error?.code).toBe("SEARCH_NOT_CONFIGURED");
    expect(attempt.pages).toHaveLength(0);
  });

  it("解析二次序列化的 Pages，并保留真实来源链接与时间", async () => {
    useMockEndpoint();
    const { searchPro } = await import("../services/runtime/adapters/trace/searchpro.ts");
    const attempt = await searchPro(FACT_TEXT);
    expect(attempt.error).toBeNull();
    expect(attempt.httpStatus).toBe(200);
    expect(attempt.requestId).toMatch(/^req-/);
    expect(attempt.pages).toHaveLength(3);
    expect(attempt.pages[0].url).toBe("https://stats.example.gov.cn/a.html");
    expect(attempt.pages[0].date).toBe("2024-06-07 19:00:51");
    expect(attempt.pages[0].passage).toBe(SUPPORT_PASSAGE);
  });

  it("限流后按退避重试成功，并记录尝试次数", async () => {
    useMockEndpoint();
    const { searchPro } = await import("../services/runtime/adapters/trace/searchpro.ts");
    const attempt = await searchPro("触发限流");
    expect(attempt.error).toBeNull();
    expect(attempt.attempts).toBeGreaterThanOrEqual(2);
  });

  it("把鉴权错误映射为 SEARCH_UNAUTHORIZED，而不是空结果", async () => {
    useMockEndpoint();
    const { searchPro } = await import("../services/runtime/adapters/trace/searchpro.ts");
    const attempt = await searchPro("触发鉴权失败");
    expect(attempt.error?.code).toBe("SEARCH_UNAUTHORIZED");
    expect(attempt.pages).toHaveLength(0);
  });

  it("无结果与失败是不同状态", async () => {
    useMockEndpoint();
    const { searchPro } = await import("../services/runtime/adapters/trace/searchpro.ts");
    const attempt = await searchPro("空结果");
    expect(attempt.resultCount).toBe(0);
    expect(attempt.error?.message).toContain("没有返回任何网页");
  });
});

describe("原文抓取安全边界", () => {
  it("拒绝抓取环回地址（防 SSRF），并如实记录原因", async () => {
    process.env.PLATFORM_TRACE_FETCH_ENABLED = "true";
    const { fetchSource } = await import("../services/runtime/adapters/trace/fetch-source.ts");
    const result = await fetchSource(`http://127.0.0.1:${PORT}/SearchPro`);
    expect(result.ok).toBe(false);
    expect(result.error).not.toBeNull();
    expect(result.text).toBe("");
  });
});

describe("证据核验规则", () => {
  it("内容雷同的转载页面被合并为一个独立来源", async () => {
    const { clusterSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const pages = [
      { id: "a", url: "https://stats.example.gov.cn/a.html", site: "统计局", title: "统计公报", date: "2024-06-07", passage: SUPPORT_PASSAGE },
      { id: "b", url: "https://news.example.com/b.html", site: "转载", title: "转载A", date: "2024-06-08", passage: DUPLICATE_PASSAGE },
      { id: "c", url: "https://other.example.org/d.html", site: "另一家", title: "独立报道", date: "2024-06-09", passage: "本市新能源汽车产能持续扩大，多家整车厂公布扩产计划，配套产业链同步跟进，形成新的增长点。" },
    ];
    const clusters = clusterSources(pages);
    expect(clusters.get("a")).toBe(clusters.get("b"));
    expect(clusters.get("c")).not.toBe(clusters.get("a"));
  });

  it("只有搜索摘要、没有原文时不给确定结论", async () => {
    const { assessFact, aggregateCase, clusterSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const pages = [
      { id: "a", url: "https://stats.example.gov.cn/a.html", site: "统计局", title: "统计公报", date: "2024-06-07", passage: SUPPORT_PASSAGE, score: 0.9 },
      { id: "c", url: "https://other.example.org/d.html", site: "另一家", title: "2024年统计公报", date: "2024-06-09", passage: SUPPORT_PASSAGE.replace("该数据来自市统计局官网。", ""), score: 0.7 },
    ];
    const clusterOf = clusterSources(pages);
    const bodies = new Map(pages.map((p) => [p.id, { ok: false, text: "", reprintMarkers: [] }]));
    const assessment = assessFact({
      fact: { id: "fact-1", text: FACT_TEXT, queries: [FACT_TEXT] },
      pages,
      bodies,
      clusterOf,
      duplicatePages: new Set<string>(),
    });
    expect(assessment.relation).toBe("supports");
    const verdict = aggregateCase({
      facts: [assessment],
      searchSummary: { total: 1, failed: 0, empty: 0 },
      pageCount: pages.length,
      bodyCount: 0,
      independentSourceCount: 1,
      searchedOk: true,
    });
    // V23：已有支持性表述但缺原文时，结论是「答了一部分」（partial），
    // 依然不是确定结论；页面上会把已查清的原句单独列出来。
    expect(verdict.outcome).toBe("partial");
    expect(verdict.partialAnswer?.length).toBeGreaterThan(0);
  });

  it("取得原文正文且有两个独立来源时才判为有依据支持", async () => {
    const { assessFact, aggregateCase, clusterSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const pages = [
      { id: "a", url: "https://stats.example.gov.cn/a.html", site: "统计局", title: "2024年统计公报", date: "2024-06-07", passage: SUPPORT_PASSAGE, score: 0.9 },
      { id: "b", url: "https://other.example.org/d.html", site: "另一家", title: "2024年统计公报发布", date: "2024-06-09", passage: "另一家媒体同日报道：全市新能源汽车产量达到120万辆，配套产业链产值同步增长，统计口径为规模以上企业。", score: 0.7 },
    ];
    const clusterOf = clusterSources(pages);
    expect(clusterOf.get("a")).not.toBe(clusterOf.get("b"));
    const bodies = new Map(
      pages.map((p) => [p.id, { ok: true, text: SUPPORT_PASSAGE + " 补充说明。", reprintMarkers: [] as string[] }]),
    );
    const assessment = assessFact({
      fact: { id: "fact-1", text: FACT_TEXT, queries: [FACT_TEXT] },
      pages,
      bodies,
      clusterOf,
      duplicatePages: new Set<string>(),
    });
    expect(assessment.bodyBackedClusters).toBe(2);
    const verdict = aggregateCase({
      facts: [assessment],
      searchSummary: { total: 1, failed: 0, empty: 0 },
      pageCount: pages.length,
      bodyCount: 2,
      independentSourceCount: 2,
      searchedOk: true,
    });
    expect(verdict.outcome).toBe("supported");
  });

  it("出现相反说法时判为争议而不是强行下结论", async () => {
    const { assessFact, aggregateCase, clusterSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const pages = [
      { id: "a", url: "https://stats.example.gov.cn/a.html", site: "统计局", title: "2024年统计公报", date: "2024-06-07", passage: SUPPORT_PASSAGE, score: 0.9 },
      { id: "b", url: "https://rumor.example.org/x.html", site: "论坛", title: "市统计局回应网传产能数据", date: "2024-06-10", passage: "市统计局回应：网传某市2024年新能源汽车产量120万辆的说法不实，并非120万辆，官方从未发布该数据。", score: 0.6 },
    ];
    const clusterOf = clusterSources(pages);
    const bodies = new Map(
      pages.map((p) => [p.id, { ok: true, text: p.passage, reprintMarkers: [] as string[] }]),
    );
    const assessment = assessFact({
      fact: { id: "fact-1", text: FACT_TEXT, queries: [FACT_TEXT] },
      pages,
      bodies,
      clusterOf,
      duplicatePages: new Set<string>(),
    });
    expect(assessment.relation).toBe("mixed");
    const verdict = aggregateCase({
      facts: [assessment],
      searchSummary: { total: 1, failed: 0, empty: 0 },
      pageCount: 2,
      bodyCount: 2,
      independentSourceCount: 2,
      searchedOk: true,
    });
    expect(verdict.outcome).toBe("disputed");

  });

  it("年份不算数值证据：来源只是同年提到，不能判为支持", async () => {
    const { assessFact, clusterSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const fact = {
      id: "fact-1",
      text: "2025年中国已建成覆盖全国主要干线的氢能长途重卡加氢网络",
      queries: ["氢能重卡"],
      timeScope: "2025年",
    };
    // 这条来源只说明「首条干线投运」，与「覆盖全国的加氢网络」不是同一件事；
    // 它出现 2025年 不代表数量断言一致。
    const pages = [
      {
        id: "a",
        url: "https://news.example.com/h2.html",
        site: "某媒体",
        title: "我国首条跨区域氢能重卡干线投运",
        date: "2025-04-15",
        passage: "2025年4月14日，我国首条跨区域氢能重卡干线正式投运，全长1150公里。",
        score: 0.8,
      },
    ];
    const assessment = assessFact({
      fact,
      pages,
      bodies: new Map(pages.map((p) => [p.id, { ok: false, text: "", reprintMarkers: [] as string[] }])),
      clusterOf: clusterSources(pages),
      duplicatePages: new Set<string>(),
    });
    expect(assessment.relation).not.toBe("supports");
    expect(assessment.sources[0].reasons.join(" ")).not.toContain("数量断言一致");
  });

  it("事实没有数量断言时，来源里的其他数字不构成反证", async () => {
    const { assessFact, clusterSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const fact = {
      id: "fact-1",
      text: "2025年中国已建成覆盖全国主要干线的氢能长途重卡加氢网络",
      queries: ["氢能重卡"],
    };
    const pages = [
      {
        id: "a",
        url: "https://news.example.com/h3.html",
        site: "某媒体",
        title: "氢能重卡干线贯通",
        date: "2025-04-15",
        passage: "该干线全长1150公里，连接西部陆海新通道，共设10座加氢站。",
        score: 0.8,
      },
    ];
    const assessment = assessFact({
      fact,
      pages,
      bodies: new Map(pages.map((p) => [p.id, { ok: false, text: "", reprintMarkers: [] as string[] }])),
      clusterOf: clusterSources(pages),
      duplicatePages: new Set<string>(),
    });
    expect(assessment.relation).not.toBe("contradicts");
  });

  it("期间型时间要求看内容所指期间，不因发布在次年就被判为过期", async () => {
    const { assessFact, clusterSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const fact = {
      id: "fact-1",
      text: "2024年中国新能源汽车产量超过1200万辆",
      queries: ["2024年 新能源汽车 产量"],
      timeScope: "2024年",
    };
    // 统计公报发表于 2025 年 1 月，内容讲的是 2024 年数据 —— 属于有效来源。
    const pages = [
      {
        id: "a",
        url: "https://www.gov.cn/stats.html",
        site: "中国政府网",
        title: "2024年我国新能源汽车产销量均超1200万辆",
        date: "2025-01-13",
        // 标题与正文都写「超过1200万辆」：这条断言考的是时效判定，不是数量门槛。
        passage: "2024年我国新能源汽车产量超过1200万辆，同比增长明显。",
        score: 0.9,
      },
    ];
    const assessment = assessFact({
      fact,
      pages,
      bodies: new Map(pages.map((p) => [p.id, { ok: false, text: "", reprintMarkers: [] as string[] }])),
      clusterOf: clusterSources(pages),
      duplicatePages: new Set<string>(),
    });
    expect(assessment.sources[0].dateStatus).toBe("in_range");
    expect(assessment.relation).toBe("supports");
    expect(assessment.outOfRangeSupports).toBe(0);
  });
});

describe("端到端：立案→检索→核验→人工确认→档案导出", () => {
  it("真实运行时链路产出可下载调查档案", async () => {
    useMockEndpoint();
    const { createPlatform } = await import("../services/runtime/src/app.ts");
    const dir = await mkdtemp(join(tmpdir(), "trace-e2e-"));
    const platform = await createPlatform({
      dbPath: join(dir, "platform.sqlite"),
      artifactRoot: join(dir, "artifacts"),
      recover: false,
    });
    try {
      const catalog = await platform.registry.catalog();
      for (const id of [
        "trace.case.intake",
        "trace.facts.confirm",
        "trace.web.search",
        "trace.evidence.verify",
        "trace.archive.export",
      ])
        expect(catalog.capabilities.some((c) => c.id === id)).toBe(true);

      const project = platform.engine.createProject({
        name: "TRACE 自动化检查",
        layout: "business",
        permissions: ["document:read", "document:validate", "knowledge:search", "data:external", "evidence:write", "file:write"],
        steps: [
          { capabilityId: "trace.case.intake", version: "1.0.0", config: {} },
          { capabilityId: "trace.facts.confirm", version: "1.0.0", config: {} },
          {
            capabilityId: "trace.web.search",
            version: "1.0.0",
            config: { fetchBodyBudget: 0, requestTimeoutMs: 5000, gapMs: 0 },
            timeoutMs: 60000,
          },
          { capabilityId: "trace.evidence.verify", version: "1.0.0", config: {} },
          { capabilityId: "human.confirm", version: "1.0.0", config: {} },
          { capabilityId: "trace.archive.export", version: "1.0.0", config: {} },
        ],
      });
      expect(project.validation.ready).toBe(true);

      const run = platform.engine.createRun(
        project.id,
        {
          filename: "case.json",
          text: "核查某市2024年新能源汽车产量",
          dataConsent: true,
          payload: {
            question: "核查某市2024年新能源汽车产量",
            claim: FACT_TEXT,
            facts: [{ id: "fact-1", text: FACT_TEXT, queries: [FACT_TEXT] }],
          },
        } as any,
        project.revision,
      );

      const waitFor = async (predicate: () => boolean, label: string) => {
        for (let i = 0; i < 200; i++) {
          if (predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error("等待超时：" + label);
      };

      await waitFor(
        () => ["waiting_approval", "failed", "completed"].includes(platform.store.run(run.id)!.status),
        "运行到达人工确认",
      );
      const beforeApproval = platform.store.run(run.id)!;
      expect(beforeApproval.status).toBe("waiting_approval");
      const searchStep = beforeApproval.steps.find((s) => s.capabilityId === "trace.web.search")!;
      expect(searchStep.status).toBe("completed");
      const searchOutput = searchStep.output as any;
      expect(searchOutput.searches[0].requestId).toMatch(/^req-/);
      expect(searchOutput.pages).toHaveLength(3);
      expect(searchOutput.pages[0].url).toBe("https://stats.example.gov.cn/a.html");
      const verifyStep = beforeApproval.steps.find((s) => s.capabilityId === "trace.evidence.verify")!;
      expect(verifyStep.status).toBe("completed");
      expect((verifyStep.output as any).assessment.facts[0].sources.length).toBe(3);

      const approval = beforeApproval.approvals.find((a) => a.status === "pending")!;
      platform.engine.decide(run.id, approval.id, "approve", "自动化检查");
      await waitFor(() => ["completed", "failed", "rejected"].includes(platform.store.run(run.id)!.status), "运行完成");

      const finished = platform.store.run(run.id)!;
      expect(finished.status).toBe("completed");
      expect(finished.artifacts).toHaveLength(2);
      const archive = finished.artifacts.find((a) => a.filename === "调查档案.md")!;
      const row = platform.store.get("SELECT path FROM artifacts WHERE id=?", archive.id);
      const content = await readFile(row.path, "utf8");
      expect(content).toContain("https://stats.example.gov.cn/a.html");
      expect(content).toContain("结论类型");
      expect(content).toContain("检索与取证记录");
      expect(content).toContain("未取得正文");
      expect(content).toContain("人工确认（未使用 AI 拆解）");
    } finally {
      await platform.engine.stop();
      platform.store.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe("来源独立性判定", () => {
  it("同一篇文章挂在不同栏目：按文章编号合并", async () => {
    const { groupSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const pages = [
      { id: "a", url: "https://www.stats.gov.cn/sj/sjjd/202502/t20250228_1958819.html", site: "统计局", title: "统计公报评读", date: "2025-02-28", passage: "第一段内容不同" },
      { id: "b", url: "https://www.stats.gov.cn/zwfwck/sjfb/202502/t20250228_1958819.html", site: "统计局", title: "统计公报评读", date: "2025-02-28", passage: "另一段措辞不同" },
    ];
    const grouping = groupSources(pages);
    expect(grouping.clusterOf.get("a")).toBe(grouping.clusterOf.get("b"));
    expect(grouping.duplicateOf.get("b")?.basis).toContain("同一文章编号");
  });

  it("繁体镜像页还原为同一网址后合并", async () => {
    const { groupSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const pages = [
      { id: "a", url: "https://www.gov.cn/yaowen/liebiao/202501/content_6998270.htm", site: "中国政府网", title: "新能源汽车产销量均超1200万辆", date: "2025-01-13", passage: "简体摘要内容" },
      { id: "b", url: "https://big5.www.gov.cn/gate/big5/www.gov.cn/yaowen/liebiao/202501/content_6998270.htm", site: "中国政府网", title: "新能源汽車產銷量均超1200萬輛", date: "2025-01-13", passage: "繁體摘要內容" },
    ];
    const grouping = groupSources(pages);
    expect(grouping.clusterOf.get("a")).toBe(grouping.clusterOf.get("b"));
  });

  it("跨站标题完全一致：只作线索，判独立性未确认而不合并", async () => {
    const { groupSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const grouping = groupSources([
      { id: "a", url: "https://news.example.com/a.html", site: "甲站", title: "我国首条跨区域氢能重卡干线投运", date: "", passage: "甲站自己写的导语，描述线路投运情况与配套。" },
      { id: "b", url: "https://auto.example.org/b.html", site: "乙站", title: "我国首条跨区域氢能重卡干线投运", date: "", passage: "乙站另一段完全不同措辞的报道，讲同一件事。" },
    ]);
    expect(grouping.clusterOf.get("a")).not.toBe(grouping.clusterOf.get("b"));
    expect(grouping.unconfirmed.has("a")).toBe(true);
    expect(grouping.unconfirmed.has("b")).toBe(true);
    expect(grouping.unconfirmedReason.get("a")).toContain("标题完全一致");
  });

  it("不同网站出现相同文章编号：属线索，不合并", async () => {
    const { groupSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const grouping = groupSources([
      { id: "a", url: "https://a.example.com/n/1234567.html", site: "甲站", title: "某地氢能项目投运", date: "2025-04-15", passage: "甲站摘要，讲项目投运。" },
      { id: "b", url: "https://b.example.org/n/1234567.html", site: "乙站", title: "某地氢能项目投运情况", date: "2025-04-15", passage: "乙站摘要，讲同一件事但措辞不同。" },
    ]);
    expect(grouping.clusterOf.get("a")).not.toBe(grouping.clusterOf.get("b"));
    expect(grouping.unconfirmed.has("a")).toBe(true);
    expect(grouping.unconfirmedReason.get("a")).toContain("相同文章编号");
  });

  it("多条来源引用同一官方发布：只算一条独立证据", async () => {
    const { groupSources, assessFact } = await import("../services/runtime/adapters/trace/analyze.ts");
    const fact = { id: "f", text: "2024年本市新能源汽车产量超过120万辆", queries: ["产量"] } as any;
    const pages = [
      { id: "a", url: "https://a.example.com/1.html", site: "甲报", title: "新能源汽车产量超120万辆", date: "2025-01-20", passage: "2024年本市新能源汽车产量超过120万辆，同比增长明显。", score: 0.9 },
      { id: "b", url: "https://b.example.com/2.html", site: "乙台", title: "新能源汽车年产量创新高", date: "2025-01-21", passage: "本市2024年新能源汽车产量超过120万辆，创历史新高。", score: 0.8 },
    ];
    const bodies = new Map(
      pages.map((page) => [
        page.id,
        {
          ok: true,
          text:
            "据中国汽车工业协会发布的数据，" +
            (page.id === "a" ? "2024年本市新能源汽车产量超过120万辆，同比增长明显。" : "本市2024年新能源汽车产量超过120万辆，创历史新高。") +
            "行业整体保持增长。".repeat(40),
          reprintMarkers: [] as string[],
        },
      ]),
    );
    const grouping = groupSources(pages, bodies);
    expect(grouping.sharedOrigins.get("中国汽车工业协会")?.length).toBe(2);
    const factAssessment = assessFact({ fact, pages, bodies, clusterOf: grouping.clusterOf, duplicatePages: new Set(), grouping });
    expect(factAssessment.supports).toBeGreaterThanOrEqual(1);
    expect(factAssessment.independentClusters).toBe(1);
    expect(factAssessment.reasons.join(" ")).toContain("中国汽车工业协会");
  });

  it("独立性未确认的支持来源不计入独立证据簇", async () => {
    const { assessFact } = await import("../services/runtime/adapters/trace/analyze.ts");
    const fact = { id: "fact-1", text: "2024年本市新能源汽车产量超过120万辆", queries: ["产量"] } as any;
    const pages = [
      { id: "a", url: "https://a.example.com/1.html", site: "甲站", title: "本市新能源汽车产量超过120万辆", date: "2024-06-01", passage: "本市统计局发布：2024年新能源汽车产量超过120万辆，同比增长明显。", score: 0.9 },
      { id: "b", url: "https://b.example.com/2.html", site: "乙站", title: "本市新能源汽车产量超过120万辆", date: "2024-06-02", passage: "本市统计局发布：2024年新能源汽车产量超过120万辆，同比增长明显。", score: 0.8 },
      { id: "c", url: "https://c.example.com/3.html", site: "丙站", title: "本市新能源汽车产量情况观察", date: "2024-06-03", passage: "本市新能源汽车产量超过120万辆，同比增长明显。", score: 0.7 },
    ];
    const { groupSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const grouping = groupSources(pages);
    const bodies = new Map(pages.map((p) => [p.id, { ok: true, text: "本市统计局发布：2024年新能源汽车产量超过120万辆，同比增长明显。" + "补充正文".repeat(80), reprintMarkers: [] as string[] }]));
    const assessment = assessFact({
      fact,
      pages,
      bodies,
      clusterOf: grouping.clusterOf,
      duplicatePages: new Set(grouping.duplicateOf.keys()),
      grouping,
    });
    // a/b 段落逐字一致 → 合并为一条；c 独立
    expect(assessment.supports).toBeGreaterThanOrEqual(2);
    expect(assessment.independentClusters).toBeLessThan(assessment.supports);
  });
});

/**
 * 三道锁定题的真实断言（V14）。
 * 判定依据来自本项目真实检索到的公开原文：
 *  - 个人信息保护法：2021-08-20 通过、2021-11-01 施行；
 *  - 新能源汽车产量：统计局口径 1316.8 万辆、中汽协口径 1288.8 万辆；
 *  - 氢能重卡：只查到局部干线投运，没有「全国建成」的证据。
 * 这里断言的是判断规则，不是某一篇文章的措辞。
 */
describe("三道锁定题：日期、数量、范围", () => {
  const lawFact = {
    id: "fact-1",
    text: "《中华人民共和国个人信息保护法》自2021年8月20日起施行",
    queries: ["个人信息保护法 施行日期"],
    timeScope: "2021年",
  };

  it("把「通过日」当成「施行日」的说法必须判为证伪", async () => {
    const { assessFact, aggregateCase, clusterSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const pages = [
      {
        id: "a",
        url: "https://www.gov.cn/zhengce/2021-08/20/content_5632404.htm",
        site: "中国政府网",
        title: "中华人民共和国主席令（第九十一号）",
        date: "2021-08-20",
        // 官方原文：8月20日通过并公布，11月1日起施行。
        passage:
          "《中华人民共和国个人信息保护法》已由中华人民共和国第十三届全国人民代表大会常务委员会第三十次会议于2021年8月20日通过,现予公布,自2021年11月1日起施行。",
        score: 0.9,
      },
    ];
    const assessment = assessFact({
      fact: lawFact as any,
      pages,
      bodies: new Map(pages.map((p) => [p.id, { ok: false, text: "", reprintMarkers: [] as string[] }])),
      clusterOf: clusterSources(pages),
      duplicatePages: new Set<string>(),
    });
    expect(assessment.relation).toBe("contradicts");
    const verdict = aggregateCase({
      facts: [assessment],
      searchSummary: { total: 1, failed: 0, empty: 0 },
      pageCount: pages.length,
      bodyCount: 0,
      independentSourceCount: 1,
      searchedOk: true,
    });
    expect(verdict.outcome).toBe("contradicted");
  });

  it("1288.8 万辆不满足「超过 1300 万辆」，1316.8 万辆满足", async () => {
    const { assessFact, clusterSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const claim = { id: "fact-1", text: "2024年中国新能源汽车产量超过1300万辆", queries: ["产量"], subjectScope: "中国" };
    const below = {
      id: "a",
      url: "https://news.cctv.com/2025/01/13/x.html",
      site: "央视网",
      title: "2024年新能源汽车产销量",
      date: "2025-01-13",
      passage: "2024年,我国新能源汽车产销量分别完成1288.8万辆和1286.6万辆,同比分别增长34.4%和35.5%。",
      score: 0.8,
    };
    const above = {
      id: "b",
      url: "https://www.stats.gov.cn/sj/zxfb/202502/t20250228.html",
      site: "国家统计局",
      title: "2024年国民经济和社会发展统计公报",
      date: "2025-02-28",
      passage: "2024年,我国新能源汽车产量达1316.8万辆,比上年增长38.7%。",
      score: 0.9,
    };
    const evaluate = (page: typeof below) =>
      assessFact({
        fact: claim as any,
        pages: [page],
        bodies: new Map([[page.id, { ok: false, text: "", reprintMarkers: [] as string[] }]]),
        clusterOf: clusterSources([page]),
        duplicatePages: new Set<string>(),
      }).sources[0].relation;
    expect(evaluate(below)).toBe("contradicts");
    expect(evaluate(above)).toBe("supports");
  });

  it("两组产量数字都能追溯到出处，但不能据此断定差异成因", async () => {
    const { assessFact, aggregateCase, clusterSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const pages = [
      {
        id: "a",
        url: "https://www.stats.gov.cn/sj/zxfb/202502/t20250228.html",
        site: "国家统计局",
        title: "2024年国民经济和社会发展统计公报",
        date: "2025-02-28",
        passage: "2024年,我国新能源汽车产量达1316.8万辆,比上年增长38.7%。",
        score: 0.9,
      },
      {
        id: "b",
        url: "https://news.cctv.com/2025/01/13/x.html",
        site: "央视网",
        title: "2024年新能源汽车产销量",
        date: "2025-01-13",
        passage: "2024年,我国新能源汽车产销量分别完成1288.8万辆和1286.6万辆,同比分别增长34.4%和35.5%。",
        score: 0.8,
      },
    ];
    const assessment = assessFact({
      fact: { id: "fact-1", text: "2024年中国新能源汽车产量为1316.8万辆", queries: ["产量"], subjectScope: "中国" } as any,
      pages,
      bodies: new Map(pages.map((p) => [p.id, { ok: false, text: "", reprintMarkers: [] as string[] }])),
      clusterOf: clusterSources(pages),
      duplicatePages: new Set<string>(),
    });
    const verdict = aggregateCase({
      facts: [assessment],
      searchSummary: { total: 2, failed: 0, empty: 0 },
      pageCount: pages.length,
      bodyCount: 0,
      independentSourceCount: 2,
      searchedOk: true,
    });
    // 结论只能是「还在争 / 证据不足」，不能据此认定谁算错；两组数字都要留在来源里。
    expect(["disputed", "insufficient"]).toContain(verdict.outcome);
    expect(assessment.sources.map((s) => s.url)).toEqual(
      expect.arrayContaining([pages[0].url, pages[1].url]),
    );
    expect(verdict.statement + verdict.reasons.join(" ")).not.toContain("统计范围一定不同");
  });

  it("局部干线投运不能证明全国网络建成，也不能据此判定「说法是假的」", async () => {
    const { assessFact, aggregateCase, clusterSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const pages = [
      {
        id: "a",
        url: "https://www.jjckb.cn/2025-04/15/x.html",
        site: "经济参考网",
        title: "我国首条跨区域氢能重卡干线投运",
        date: "2025-04-15",
        passage: "2025年4月14日,我国首条跨区域氢能重卡干线正式投运,全长约1150公里,沿线加氢站尚未覆盖全国。",
        score: 0.8,
      },
    ];
    const assessment = assessFact({
      fact: { id: "fact-1", text: "2025年全国已建成覆盖全国的氢能长途重卡加氢网络", queries: ["氢能重卡"], subjectScope: "中国", timeScope: "2025年" } as any,
      pages,
      bodies: new Map(pages.map((p) => [p.id, { ok: false, text: "", reprintMarkers: [] as string[] }])),
      clusterOf: clusterSources(pages),
      duplicatePages: new Set<string>(),
    });
    const verdict = aggregateCase({
      facts: [assessment],
      searchSummary: { total: 1, failed: 0, empty: 0 },
      pageCount: pages.length,
      bodyCount: 0,
      independentSourceCount: 1,
      searchedOk: true,
    });
    expect(verdict.outcome).toBe("insufficient");
    expect(verdict.outcome).not.toBe("supported");
  });
});

describe("问句与否定词判定", () => {
  it("「未来」里的「未」不算否定，不能据此判反证", async () => {
    const { assessFact, clusterSources } = await import("../services/runtime/adapters/trace/analyze.ts");
    const fact = { id: "fact-1", text: "《狮子王》里辛巴的父亲是木法沙", queries: ["辛巴的父亲是谁"] };
    const pages = [
      {
        id: "a",
        url: "https://example.com/lion.html",
        site: "示例媒体",
        title: "《狮子王》三十周年",
        date: "2024-11-12",
        passage: "辛巴的父亲木法沙备受敬仰；辛巴出生时被高高举起，成为狮群未来的领袖。",
        score: 0.9,
      },
    ];
    const bodies = new Map(pages.map((p) => [p.id, { ok: true, text: pages[0].passage, reprintMarkers: [] as string[] }]));
    const assessment = assessFact({
      fact,
      pages,
      bodies,
      clusterOf: clusterSources(pages),
      duplicatePages: new Set<string>(),
    });
    // 关键：不能因为「未来」里的「未」把正面叙述判成相反说法。
    expect(assessment.relation).not.toBe("contradicts");
  });

  it("求值型问句不判真假：结论是证据不足，并说明该怎么问", async () => {
    const { assessFact, aggregateCase, clusterSources, isEvaluativeQuestion } = await import(
      "../services/runtime/adapters/trace/analyze.ts"
    );
    const question = "《狮子王》里辛巴的父亲叫什么名字？";
    expect(isEvaluativeQuestion(question)).toBe(true);
    // 陈述句不能被当成问句
    expect(isEvaluativeQuestion("《狮子王》里辛巴的父亲是木法沙")).toBe(false);
    // 日期/数值类问题各有核验路径，不能被实体型问句规则挡掉
    expect(isEvaluativeQuestion("《个人信息保护法》是什么时候开始施行的？")).toBe(false);
    expect(isEvaluativeQuestion("2024年新能源汽车产量是多少？")).toBe(false);

    const pages = [
      {
        id: "a",
        url: "https://example.com/lion2.html",
        site: "示例媒体",
        title: "《狮子王》角色介绍",
        date: "2024-11-12",
        passage: "辛巴的父亲木法沙从未缺席；未来的狮王在成长中失去了父亲。",
        score: 0.9,
      },
    ];
    const bodies = new Map(pages.map((p) => [p.id, { ok: false, text: "", reprintMarkers: [] as string[] }]));
    const assessment = assessFact({
      fact: { id: "fact-1", text: question, queries: [question] },
      pages,
      bodies,
      clusterOf: clusterSources(pages),
      duplicatePages: new Set<string>(),
    });
    expect(assessment.relation).not.toBe("contradicts");
    const verdict = aggregateCase({
      facts: [assessment],
      searchSummary: { total: 1, failed: 0, empty: 0 },
      pageCount: pages.length,
      bodyCount: 0,
      independentSourceCount: 1,
      searchedOk: true,
    });
    expect(verdict.outcome).toBe("insufficient");
    expect(verdict.headline).toContain("求值型问句");
    expect(verdict.reasons.join(" ")).toContain("改写成陈述句");
  });
});

describe("检索式规划（规则扩展）", () => {
  it("多组数值各自单独成检索式，原句保留在最前", () => {
    const plan = planFactQueries(
      "为什么2024年新能源汽车产量有1288.8万辆和1316.8万辆两种说法？",
      ["为什么2024年新能源汽车产量有1288.8万辆和1316.8万辆两种说法？"],
    );
    expect(plan.source).toBe("rule");
    expect(plan.queries[0]).toContain("新能源汽车产量");
    expect(plan.queries.some((q) => q.includes("1288.8万辆"))).toBe(true);
    expect(plan.queries.some((q) => q.includes("1316.8万辆"))).toBe(true);
    expect(plan.queries.length).toBeLessThanOrEqual(3);
  });
  it("客户端给了多条检索式时不介入", () => {
    const plan = planFactQueries("某说法", ["检索一", "检索二"]);
    expect(plan.source).toBe("client");
    expect(plan.queries).toEqual(["检索一", "检索二"]);
  });
  it("没有具体取值时补一条官方口径检索，且不重复原句", () => {
    const plan = planFactQueries("全国氢能重卡加氢网络是不是已经全面建成？", ["全国氢能重卡加氢网络是不是已经全面建成？"]);
    expect(plan.queries.length).toBe(2);
    expect(new Set(plan.queries).size).toBe(2);
  });
});
