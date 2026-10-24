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
