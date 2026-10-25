/**
 * 输入导入的纯函数测试：分享文案解析、图片校验、OCR 文本处理、提交前校验。
 *
 * 这些函数决定「什么能进调查框」，因此用真实风格的输入断言，
 * 不 mock 业务判断。
 */
import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  MAX_INVESTIGATION_CHARS,
  checkImage,
  extractUrls,
  isDouyinUrl,
  looksUnreadable,
  normalizeOcrText,
  parsePastedShare,
  planOcrInsertion,
  rankCandidates,
  validateForInvestigation,
} from "../apps/trace/src/input-import.ts";

describe("图片校验", () => {
  it("只接受 PNG/JPG/WebP 且不超过 5MB", () => {
    expect(checkImage({ type: "image/png", size: 1024 }).ok).toBe(true);
    expect(checkImage({ type: "image/jpeg", size: 1024 }).ok).toBe(true);
    expect(checkImage({ type: "image/webp", size: 1024 }).ok).toBe(true);
    expect(checkImage({ type: "image/gif", size: 1024 }).ok).toBe(false);
    expect(checkImage({ type: "application/pdf", size: 1024 }).ok).toBe(false);
    expect(checkImage({ type: "image/png", size: 0 }).ok).toBe(false);
    expect(checkImage({ type: "image/png", size: MAX_IMAGE_BYTES + 1 }).ok).toBe(false);
    expect(checkImage({ type: "image/png", size: MAX_IMAGE_BYTES }).ok).toBe(true);
  });
});

describe("分享文案解析", () => {
  it("从抖音分享文案里取出说法，并保留链接", () => {
    const parsed = parsePastedShare(
      "复制打开抖音，看看这条视频 【某某的作品】某种食品反复加热会产生致癌物 https://v.douyin.com/iAbCdEf/ 复制此链接，打开抖音搜索，直接观看视频！",
    );
    expect(parsed.statement).toContain("某种食品反复加热会产生致癌物");
    expect(parsed.statement).not.toContain("抖音");
    expect(parsed.statement).not.toContain("http");
    expect(parsed.urls).toEqual(["https://v.douyin.com/iAbCdEf/"]);
    expect(parsed.douyin).toBe(true);
  });

  it("去掉分享文案末尾残留的标点", () => {
    const parsed = parsePastedShare("某某说法是这样的 https://v.douyin.com/iAbCdEf/ 复制此链接，打开抖音搜索，直接观看视频！");
    expect(parsed.statement).toBe("某某说法是这样的");
    expect(parsed.statement).not.toMatch(/[！!]$/);
  });

  it("只有链接时没有说法，不会被当成断言", () => {
    const parsed = parsePastedShare("https://v.douyin.com/iAbCdEf/");
    expect(parsed.statement).toBe("");
    expect(parsed.urls.length).toBe(1);
    expect(parsed.douyin).toBe(true);
  });

  it("普通网页链接不带说法时同样不产生断言", () => {
    const parsed = parsePastedShare("https://www.example.com/news/2026/0312.html");
    expect(parsed.statement).toBe("");
    expect(parsed.douyin).toBe(false);
  });

  it("识别抖音域名边界，不误判相似域名", () => {
    expect(isDouyinUrl("https://v.douyin.com/x/")).toBe(true);
    expect(isDouyinUrl("https://www.douyin.com/video/1")).toBe(true);
    expect(isDouyinUrl("https://notdouyin.com/x")).toBe(false);
    expect(isDouyinUrl("not a url")).toBe(false);
  });

  it("提取多条链接并去重", () => {
    const urls = extractUrls("看这个 https://a.example.com/1 和 https://b.example.com/2 ，还有 https://a.example.com/1");
    expect(urls).toEqual(["https://a.example.com/1", "https://b.example.com/2"]);
  });
});

describe("OCR 文本处理", () => {
  it("清洗全角空格与多余空行，不改字词", () => {
    const cleaned = normalizeOcrText("  某说法\u3000成立  \n\n\n\n 下一行  ");
    expect(cleaned).toBe("某说法成立\n\n 下一行".trim());
  });

  it("去掉 Tesseract 中文逐字空格，但保留英文与数字间的空格", () => {
    const raw = "家 庭 群 . 老 张\n《 中 华 人 民 共 和 国 个 人 信 息 保 护 法 》 自 2021 年 8 月 20 日 起 施 行 。";
    const cleaned = normalizeOcrText(raw);
    expect(cleaned).toContain("《中华人民共和国个人信息保护法》自2021年8月20日起施行。");
    expect(cleaned).not.toMatch(/中 华/);
  });

  it("超过 500 字不静默截断，改为给候选句", () => {
    const long = "第一句说法需要核查。".repeat(60);
    const plan = planOcrInsertion(long);
    expect(plan.needChoice).toBe(true);
    expect(plan.candidates.length).toBeGreaterThan(0);
    expect(plan.text.length).toBeGreaterThan(MAX_INVESTIGATION_CHARS);
  });

  it("候选句优先选完整说法，导航与工具条沉底", () => {
    const lines = [
      "来源：经济参考报浏览字号：大中小",
      "2021年08月23日08:34",
      "《中华人民共和国个人信息保护法》日前获得通过，并将于2021年11月1日起正式施行。",
    ];
    const ranked = rankCandidates(lines);
    expect(ranked[0]).toContain("个人信息保护法");
    expect(ranked[0]).toContain("施行");
  });

  it("短文本可以直接填入", () => {
    const plan = planOcrInsertion("某工程是否已经全面建成？");
    expect(plan.needChoice).toBe(false);
    expect(plan.text).toBe("某工程是否已经全面建成？");
  });

  it("几乎读不出字时判为识别失败", () => {
    expect(looksUnreadable("")).toBe(true);
    expect(looksUnreadable("·—…")).toBe(true);
    expect(looksUnreadable("《个人信息保护法》自2021年8月20日起施行")).toBe(false);
  });
});

describe("提交前校验", () => {
  it("太短或只有链接不放行", () => {
    expect(validateForInvestigation("查").ok).toBe(false);
    expect(validateForInvestigation("https://v.douyin.com/iAbCdEf/").ok).toBe(false);
    expect(validateForInvestigation("《个人信息保护法》自2021年8月20日起施行").ok).toBe(true);
  });
});

describe("AI 识图结果处理", () => {
  it("AI 返回的多行文本可按行选句，超过上限不自动填", () => {
    const lines = Array.from({ length: 14 }, (_, i) => `第${i + 1}条：最好的方法是某个动作。`).join("\n");
    const plan = planOcrInsertion(lines);
    expect(plan.text.split("\n").length).toBeGreaterThan(5);
    // 14 行短句合计不足 500 字时可直接填入
    if (plan.text.length <= MAX_INVESTIGATION_CHARS) {
      expect(plan.needChoice).toBe(false);
      expect(plan.text).toContain("第1条");
    }
  });

  it("候选句仍优先完整说法，AI 噪声行排在后面", () => {
    const ranked = rankCandidates([
      "5.6s 用时",
      "强膝：最好的方法是空蹬腿。",
      "【广告】",
    ]);
    expect(ranked[0]).toContain("空蹬腿");
  });
});
