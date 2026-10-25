import { describe, it, expect } from "vitest";
import { compareSentence, parseClaim } from "../services/runtime/adapters/trace/claim-semantics.ts";
import { findSourcedLookupAnswer } from "../services/runtime/src/lookup-answer.ts";
import { comparePossession } from "../services/runtime/adapters/trace/proposition.ts";
import { dateRoles, assessSource } from "../services/runtime/adapters/trace/analyze.ts";
import { assessmentChanged } from "../services/runtime/adapters/trace/assessment-version.ts";
import { traceScopeReason } from "../services/runtime/adapters/trace/scope.ts";

function verdicts(claimText: string, sentences: string[]) {
  const claim = parseClaim(claimText);
  return sentences.map((sentence) => compareSentence(claim, sentence).verdict);
}

describe("原句绑定、极性与范围", () => {
  const proof = "金星和水星是太阳系中仅有的两颗没有卫星的行星。";
  it("同向否定支持，相反肯定被反驳", () => {
    expect(comparePossession("水星和金星都没有天然卫星。", proof)?.verdict).toBe("direct_support");
    expect(comparePossession("水星和金星都有天然卫星。", proof)?.verdict).toBe("direct_refute");
    const page = { id: "p", title: "太阳系", url: "https://example.com/planets", site: "示例", date: "", passage: proof };
    const source = assessSource(page, { fact: { id: "f", text: "水星和金星都没有天然卫星。", queries: [] }, pages: [page], bodies: new Map(), clusterOf: new Map(), duplicatePages: new Set() });
    expect(source.relation).toBe("supports");
  });
  it("单一主体不能支持全部，属性不能自动支持唯一", () => {
    expect(comparePossession("水星和金星都没有天然卫星。", "水星没有天然卫星。")?.sufficient).toBe(false);
    expect(comparePossession("水星是太阳系唯一没有天然卫星的行星。", "水星没有天然卫星。")?.sufficient).toBe(false);
    expect(comparePossession("水星是太阳系唯一没有天然卫星的行星。", proof)?.verdict).toBe("direct_refute");
    expect(comparePossession("地球是太阳系唯一拥有天然卫星的行星", "太阳系中，地球拥有天然卫星，火星也拥有天然卫星")?.verdict).toBe("direct_refute");
    expect(comparePossession("水星有天然卫星。", "没有证据证明水星有天然卫星。")?.sufficient).toBe(false);
  });
  it("可识别行为也比较说法本身的否定方向", () => {
    expect(compareSentence(parseClaim("PS4没有停产"), "索尼表示PS4并未停产").verdict).toBe("direct_support");
    expect(compareSentence(parseClaim("PS4没有停产"), "索尼宣布PS4停产").verdict).toBe("direct_refute");
    expect(compareSentence(parseClaim("PS4没有停产"), "PS4没有停产").verdict).toBe("direct_support");
    expect(compareSentence(parseClaim("PS4已经停产"), "PS4没有停产").verdict).toBe("direct_refute");
    for (const text of ["PS4可能停产", "PS4可能没有停产", "PS4没有证据证明停产"])
      expect(["partial", "related_only"]).toContain(compareSentence(parseClaim("PS4已经停产"), text).verdict);
  });
  it("实施情况报告不是法律施行日", () => {
    expect([...dateRoles("2021年8月20日《个人信息保护法》实施情况报告通过。")][0][1].has("effect")).toBe(false);
    expect([...dateRoles("自2021年11月1日起施行。")][0][1].has("effect")).toBe(true);
    expect([...dateRoles("2021年8月20日《个人信息保护法》实施成效报告通过。")][0][1].has("effect")).toBe(false);
    expect([...dateRoles("2021年8月20日《个人信息保护法》施行状况报告通过。")][0][1].has("effect")).toBe(false);
    expect([...dateRoles("2021年11月1日起施行的《个人信息保护法》")][0][1].has("effect")).toBe(true);
  });
  it("指纹识别关键证据变化，忽略读取时刻和字段顺序", () => {
    const a = { facts: [{ factId: "f", fact: "事实", relation: "none", sources: [{ pageId: "p", url: "https://example.com", keySentence: "旧原句" }] }], verdict: { outcome: "partial" } };
    expect(assessmentChanged(a, { ...a, at: "new-read-time" })).toBe(false);
    const b = structuredClone(a); b.facts[0].sources[0].keySentence = "新原句";
    expect(assessmentChanged(a, b)).toBe(true);
    expect(assessmentChanged(a, { ...a, facts: [{ ...a.facts[0], sources: [{ ...a.facts[0].sources[0], title: "新标题" }] }] })).toBe(true);
  });
  it("范围限制保留作品线索、法律和统计查询", () => {
    for (const question of ["查询某明星家庭住址", "这个演员最近有什么绯闻", "调查政治人物动态", "张三是谁", "王菲近况", "特朗普最新动态", "张三的家庭地址在哪里", "公司员工张三的手机号是多少", "《某电影》演员的恋情", "《花样年华》梁朝伟近况", "法律上王菲离婚了吗", "王菲离婚传闻统计", "某公司电话 张三手机号"])
      expect(traceScopeReason(question)).not.toBeNull();
    for (const question of ["找一部马特达蒙主演的火星电影", "电影里辛巴的父亲叫什么名字", "个人信息保护法施行日期", "2024年新能源汽车产量", "2024年全国离婚登记数量", "法律规定夫妻离婚登记程序是什么", "《红楼梦》贾宝玉的妻子是谁"])
      expect(traceScopeReason(question)).toBeNull();
    expect(traceScopeReason("贾宝玉的妻子是谁", "《红楼梦》中的角色查询")).toBeNull();
    expect(traceScopeReason("梁朝伟近况", "《花样年华》演员查询")).not.toBeNull();
  });
});

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
