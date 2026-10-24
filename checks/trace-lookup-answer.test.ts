import { describe, it, expect } from "vitest";
import { findSourcedLookupAnswer, type LookupEvidence } from "../services/runtime/src/lookup-answer.ts";

const question = "2026年国庆假期全国国内出游人次官方公布了吗？具体是多少？";
const report: LookupEvidence = {
  quote: "经文化和旅游部数据中心测算，国庆节假期7天，全国国内出游 8.26 亿人次，国内出游总花费7383.75亿元",
  url: "https://www.cnr.cn/news/20261009/1234.html",
  site: "央广网",
  date: "2026-10-09",
  from: "body",
  authoritative: false,
};

describe("查询型侦探：带来源的具体回答", () => {
  it("直接回答所问人次，同时保留来源与未独立确认官方公告的限制", () => {
    const answer = findSourcedLookupAnswer(question, [report]);
    expect(answer?.value.replace(/\s+/g, "")).toBe("8.26亿人次");
    expect(answer?.quote).toContain("国内出游");
    expect(answer?.url).toBe(report.url);
    expect(answer?.limitation).toContain("原始公告");
  });

  it("不能把金额7383.75亿元错当出游人次", () => {
    expect(findSourcedLookupAnswer(question, [{
      ...report, quote: "国庆假期7天，旅游总花费 7383.75 亿元，相关数据仍在整理",
    }])).toBeNull();
  });

  it("不能用2025年的数字回答2026年的问题", () => {
    expect(findSourcedLookupAnswer(question, [
      { ...report, date: "2025-10-09", quote: "2025年国庆节假期，国内出游 8.26 亿人次" },
    ])).toBeNull();
  });

  it("网页发布日期符合但正文描述的是另一年仍然不能错配", () => {
    expect(findSourcedLookupAnswer(question, [
      { ...report, date: "2026-10-09", quote: "2025年国庆节假期，国内出游 8.26 亿人次" },
    ])).toBeNull();
  });

  it("题目是电影线索或泛泛传言时不生成数字答案", () => {
    expect(findSourcedLookupAnswer("我忘记电影的名字了，讲什么？", [report])).toBeNull();
    expect(findSourcedLookupAnswer("国庆是不是有一个传言？", [report])).toBeNull();
  });

  it("原文优先于摘要，但摘要也必须如实标注其证据层级", () => {
    const answer = findSourcedLookupAnswer(question, [
      { ...report, from: "excerpt", site: "搜索摘要站" },
      { ...report, from: "body", site: "实得原文", url: "https://example.org/original" },
    ]);
    expect(answer?.site).toBe("实得原文");
    const onlyExcerpt = findSourcedLookupAnswer(question, [{ ...report, from: "excerpt" }]);
    expect(onlyExcerpt?.from).toBe("excerpt");
  });
});

describe("实体型问句：有原句才回答", () => {
  const base: LookupEvidence = {
    quote: "",
    url: "https://www.example.com/lion.html",
    site: "示例媒体",
    date: "2024-11-12",
    from: "body",
    authoritative: false,
  };
  const question = "《狮子王》里辛巴的父亲叫什么名字？";

  it("从原句里读出答案，并保留来源与限制", async () => {
    const { collectEntityEvidence, entityQuestionParts, findSourcedEntityAnswer } = await import(
      "../services/runtime/src/lookup-answer.ts"
    );
    const parts = entityQuestionParts(question)!;
    expect(parts.relation).toBe("父亲");
    const passage = "辛巴的父亲木法沙是荣耀王国的狮王，后被弟弟刀疤设计害死。";
    const evidence = collectEntityEvidence(
      [{ id: "a", url: base.url, site: base.site, date: base.date, passage, title: "狮子王" }],
      new Map([["a", { ok: true, text: passage }]]),
      parts,
    );
    const answer = findSourcedEntityAnswer(question, evidence);
    expect(answer?.value).toBe("木法沙");
    expect(answer?.kind).toBe("entity");
    expect(answer?.limitation).toContain("人工核对");
  });

  it("原句里没有直接对应关系时不回答", async () => {
    const { findSourcedEntityAnswer } = await import("../services/runtime/src/lookup-answer.ts");
    const answer = findSourcedEntityAnswer(question, [
      { ...base, quote: "辛巴出生时被高高举起，成为狮群未来的领袖，观众记住了这个名字。" },
      { ...base, quote: "《狮子王》三十周年纪念重映，影迷再次走进影院。" },
    ]);
    expect(answer).toBeNull();
  });

  it("两处说法冲突时不硬选一个", async () => {
    const { findSourcedEntityAnswer } = await import("../services/runtime/src/lookup-answer.ts");
    const answer = findSourcedEntityAnswer(question, [
      { ...base, quote: "辛巴的父亲是木法沙，这一点在首部作品中写明。" },
      { ...base, quote: "辛巴的父亲是阿哈迪，不同版本的译制把名字翻错了。", from: "body" },
    ]);
    expect(answer).toBeNull();
  });

  it("否定表述不能当成答案", async () => {
    const { findSourcedEntityAnswer } = await import("../services/runtime/src/lookup-answer.ts");
    const answer = findSourcedEntityAnswer(question, [{ ...base, quote: "辛巴的父亲并非木法沙，这是误传。" }]);
    expect(answer).toBeNull();
  });

  it("「作者」写成「创作」也能认出答案", async () => {
    const { collectEntityEvidence, entityQuestionParts } = await import("../services/runtime/src/lookup-answer.ts");
    const parts = entityQuestionParts("《哈利·波特》的作者是谁？")!;
    expect(parts.relation).toBe("作者");
    const passage = "《哈利·波特》系列由英国作家J.K.罗琳创作，首部作品于1997年出版。";
    const evidence = collectEntityEvidence(
      [{ id: "a", url: base.url, site: base.site, date: base.date, passage, title: "哈利波特" }],
      new Map([["a", { ok: true, text: passage }]]),
      parts,
    );
    expect(evidence.length).toBeGreaterThan(0);
  });

  it("间隔号不同不影响主体匹配，单字关系不切碎人名", async () => {
    const { collectEntityEvidence, entityCandidatesIn, entityQuestionParts } = await import(
      "../services/runtime/src/lookup-answer.ts"
    );
    const parts = entityQuestionParts("《哈利·波特》的作者是谁？")!;
    const passage = "哈利波特系列小说的作者是J.K.罗琳，作品风靡全球。";
    const evidence = collectEntityEvidence(
      [{ id: "a", url: base.url, site: base.site, date: base.date, passage, title: "哈利波特" }],
      new Map([["a", { ok: true, text: passage }]]),
      parts,
    );
    expect(evidence.length).toBeGreaterThan(0);
    const candidates = entityCandidatesIn("辛巴的父亲木法沙是荣耀王国的狮王。", {
      subject: "《狮子王》里辛巴",
      relation: "父亲",
    });
    expect(candidates.map((item) => item.value)).toContain("木法沙");
    expect(candidates.some((item) => item.value.includes("亲木"))).toBe(false);
  });
});
