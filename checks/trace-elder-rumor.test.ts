/**
 * 长辈转发场景（辟谣/科普来源）的判定回归。
 *
 * 背景：实测「网传手机充一整夜会严重损伤电池寿命」等三条长辈传言，
 * 检索都命中了科普中国、中国互联网联合辟谣平台等高相关来源，但判定一律
 * 落成「不确定」，理由写「没有任何来源与待核查事实形成可比对表述」。
 * 这组用例锁定三件事：前缀要剥离、辟谣句要能定方向、标题级答疑页不许猜方向。
 */
import { describe, expect, it } from "vitest";
import { parseClaim, compareSentence } from "../services/runtime/adapters/trace/claim-semantics.ts";
import { deriveClaims } from "../services/runtime/src/query-plan.ts";

describe("转发说法归一化", () => {
  it("去掉「网传/听说/转发提醒」前缀，保留中间那句断言", () => {
    expect(deriveClaims("网传手机充一整夜会严重损伤电池寿命").claims[0]).toBe(
      "手机充一整夜会严重损伤电池寿命",
    );
    expect(deriveClaims("听说反复烧开的水不能喝").claims[0]).toBe("反复烧开的水不能喝");
    expect(deriveClaims("转发提醒！冰箱里的鸡蛋不能放在门架上").claims[0]).toBe(
      "冰箱里的鸡蛋不能放在门架上",
    );
  });

  it("原有问句改写不受影响", () => {
    expect(deriveClaims("《个人信息保护法》是不是2021年8月20日施行？").claims[0]).toBe(
      "《个人信息保护法》2021年8月20日施行",
    );
    const two = deriveClaims("为什么2024年新能源汽车产量有1288.8万辆和1316.8万辆两种说法？");
    expect(two.claims.length).toBe(2);
  });
});

describe("辟谣/科普来源的方向判定", () => {
  const case1 = parseClaim("手机充一整夜会严重损伤电池寿命");

  it("正文里明确的相反结论算否证", () => {
    const refute = compareSentence(case1, "即便整夜插着充电器，电池也不会“过饱”");
    expect(refute.verdict).toBe("direct_refute");
    const refute2 = compareSentence(
      case1,
      "所以只要手机的电池管理系统没有出故障，基本不会出现过度充电把电池充坏的现象",
    );
    expect(refute2.verdict).toBe("direct_refute");
  });

  it("承认有影响但程度很轻的，只能算部分", () => {
    const partial = compareSentence(
      case1,
      "先破个最大的谣言：手机充一整夜确实比随充随用更伤电池，但是这种充电方式对电池的损伤非常轻",
    );
    expect(partial.verdict).toBe("partial");
    expect(partial.sufficient).toBe(false);
  });

  it("标题级答疑页没有结论时不许猜方向", () => {
    const q = compareSentence(parseClaim("反复烧开的水不能喝"), "是真的吗：隔夜水不能喝？反复烧开的水不能喝？");
    expect(q.verdict).not.toBe("direct_refute");
  });

  it("只是提到「谣言」两个字的普通新闻不算否证", () => {
    const news = compareSentence(case1, "网上流传某地发生一起谣言事件，警方已介入");
    expect(news.verdict).not.toBe("direct_refute");
  });

  it("「没有证据证明」不等于「已被推翻」", () => {
    const epistemic = compareSentence(case1, "目前没有证据证明手机充电会损伤电池");
    expect(epistemic.verdict).not.toBe("direct_refute");
  });
});
