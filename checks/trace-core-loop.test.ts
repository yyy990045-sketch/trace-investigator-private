import { describe, it, expect } from "vitest";
import { needsDetectiveFollowup, type DetectiveGapState } from "../apps/trace/src/clue-followup-policy.ts";

const gap: DetectiveGapState = {
  status: "completed",
  decision: { state: "insufficient", nextQueries: [] },
  pendingCount: 0,
  followupCount: 0,
  candidates: [{ matches: [
    { decisive: true, found: false },
    { decisive: false, found: true },
  ] }],
};

describe("侦探核心闭环：缺口能推动下一步行动", () => {
  it("有候选但决定性情节尚未证明，自动启动补查", () => {
    expect(needsDetectiveFollowup(gap)).toBe(true);
  });
  it("初次搜索仍在运行时不能提前启动补查", () => {
    expect(needsDetectiveFollowup({ ...gap, status: "running" })).toBe(false);
  });
  it("已经找到答案时不为增加搜索次数而追查", () => {
    expect(needsDetectiveFollowup({ ...gap, decision: { state: "found" } })).toBe(false);
  });
  it("达到既有检索轮次上限后必须停止", () => {
    expect(needsDetectiveFollowup({ ...gap, followupCount: 4 })).toBe(false);
  });
  it("无候选时应尝试不同检索词，不应直接认定不存在", () => {
    expect(needsDetectiveFollowup({ ...gap, candidates: [] })).toBe(true);
  });
  it("没有未解决证据时无需发起浪费预算的请求", () => {
    expect(needsDetectiveFollowup({ ...gap, candidates: [{
      matches: [{ decisive: true, found: true }],
    }] })).toBe(false);
  });
});
