import { describe, it, expect } from "vitest";
import { compareSentence, parseClaim } from "../services/runtime/adapters/trace/claim-semantics.ts";
import { findSourcedLookupAnswer } from "../services/runtime/src/lookup-answer.ts";

function verdicts(claimText: string, sentences: string[]) {
  const claim = parseClaim(claimText);
  return sentences.map((sentence) => compareSentence(claim, sentence).verdict);
}

describe("说法核验：缺证据不等于被证伪", () => {
  const coffee = "每天喝咖啡能延长寿命，有科学依据吗？";

  it("只说观察到相关性、没有因果证明时，只能算部分支持", () => {
    expect(
      verdicts(coffee, [
        "研究结论只是发现喝咖啡与寿命延长之间存在相关性，并未证明因果关系",
        "该研究并没有说喝咖啡能延长寿命，只是发现相关性",
      ]),
    ).toEqual(["partial", "partial"]);
  });

  it("明确否定事实本身的说法才判为反驳", () => {
    const claim = parseClaim("索尼已停产PS4");
    expect(compareSentence(claim, "索尼否认PS4停产").verdict).toBe("direct_refute");
  });
});

describe("禁令类说法：有条件的限制不是全面禁止", () => {
  const ban = "网传从2026年起，国内航司全面禁止携带充电宝登机。";

  it("禁止的是「没有 3C 标识」这类情形时不能当成全面禁止", () => {
    const claim = parseClaim(ban);
    expect(claim.predicate).toBe("禁止携带");
    expect(claim.object).toBe("充电宝");
    expect(claim.subject).toBe("国内航司");
    const verdict = compareSentence(
      claim,
      "自2025年6月28日起，禁止旅客携带没有3C标识、3C标识不清晰的充电宝乘坐境内航班",
    );
    expect(verdict.verdict).toBe("partial");
    expect(verdict.reason).toContain("有条件");
  });

  it("同一页里既有禁止又有允许，不产生「相反来源」", () => {
    const claim = parseClaim(ban);
    expect(
      compareSentence(claim, "符合条件的充电宝仍可携带，每名旅客限带两个，且额定能量不超过100Wh").verdict,
    ).toBe("partial");
  });

  it("只有某一承运人的规定时不能推成全部航司", () => {
    const claim = parseClaim(ban);
    expect(
      compareSentence(claim, "自2026年8月4日起，国航对所有航班实行充电宝禁运，旅客一律不得携带充电宝乘机").verdict,
    ).toBe("partial");
  });

  it("明确否认全面禁止时判为反驳", () => {
    const claim = parseClaim(ban);
    expect(compareSentence(claim, "民航局并未全面禁止携带充电宝登机").verdict).toBe("direct_refute");
  });
});

describe("数值答案绑定统计年份", () => {
  const question = "2026年国庆假期全国国内出游人次官方公布了吗？具体是多少？";
  const base = {
    quote: "经文化和旅游部数据中心测算，国庆节假期7天，全国国内出游 8.26 亿人次",
    url: "https://www.cnr.cn/news/20261009/1234.html",
    site: "央广网",
    date: "2026-10-09",
    from: "body" as const,
    authoritative: false,
  };

  it("原句写明年份时标注为原句写明", () => {
    const answer = findSourcedLookupAnswer(question, [
      { ...base, quote: "2026年国庆节假期7天，全国国内出游 8.26 亿人次" },
    ]);
    expect(answer?.dataYear).toBe("2026年");
    expect(answer?.yearBasis).toBe("stated");
    expect(answer?.period).toBe("7天");
    expect(answer?.scope).toBe("全国");
  });

  it("标题写的是别的年份时，即使发布日期落在今年也不能采用", () => {
    expect(
      findSourcedLookupAnswer(question, [{ ...base, title: "2023年国庆假期国内出游8.26亿人次" }]),
    ).toBeNull();
  });

  it("答案附带发布机构身份，和结论页用同一套分类", () => {
    const answer = findSourcedLookupAnswer(question, [base]);
    expect(answer?.profile?.kind).toBe("media");
  });
});
