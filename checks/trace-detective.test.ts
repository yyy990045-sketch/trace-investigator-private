import { describe, expect, it } from "vitest";
import { detectInvestigationDomain, planByRule } from "../services/runtime/src/clue-plan.ts";
import { nextClueSearch, type InvestigationSnapshot } from "../services/runtime/src/clue-investigation.ts";
import { evaluateCandidates, extractCandidates, type PageLike, type ClueItem } from "../services/runtime/adapters/trace/clues.ts";
import { investigationFlow } from "@personal/capability-sdk";

describe("侦探赛道：查询类型与调查决策", () => {
  it("实际入口：演出票务不送进影视候选器；找剧仍走线索追查", () => {
    expect(investigationFlow("我想找一部港片，卧底在天台对决", "clue")).toBe("clue");
    expect(investigationFlow("某歌手周六的演唱会还有票吗？", "clue")).toBe("verification");
    expect(investigationFlow("网传某商品已经停产", "clue")).toBe("verification");
    expect(investigationFlow("这个问题在哪里能找到官方资料", "clue")).toBe("verification");
    expect(investigationFlow("电视剧谁主演", "verification")).toBe("verification");
  });

  it("演出余票不再被错误规划成电视剧搜索", () => {
    const input = "想知道这场演唱会周六还有没有余票，官方售票渠道在哪里";
    const plan = planByRule(input);
    expect(detectInvestigationDomain(input)).toBe("event");
    expect(plan.queries.some((query) => /剧名|电视剧|主演/.test(query))).toBe(false);
    expect(plan.queries.some((query) => /官方售票|开票状态/.test(query))).toBe(true);
  });

  it("传言查证不被错误规划成电视剧搜索", () => {
    const plan = planByRule("网传某款商品已经停产，官方宣布过吗？");
    expect(plan.queries.some((query) => /电视剧|剧名/.test(query))).toBe(false);
    expect(plan.queries.some((query) => /原始声明/.test(query))).toBe(true);
  });

  it("模糊找剧仍有面向剧情和角色的检索", () => {
    const plan = planByRule("以前看过一部港片，警察和卧底在天台对决，想不起名字");
    expect(plan.queries.some((query) => /剧情|剧名/.test(query))).toBe(true);
    expect(plan.clues.length).toBeGreaterThan(0);
  });

  it("没有标点的长中文问题不再被整个丢弃", () => {
    const plan = planByRule("我记得有一部电影主角在列车里不断重复八分钟调查爆炸但我忘记这部作品的片名了");
    expect(plan.clues.length).toBeGreaterThan(0);
    expect(plan.queries.length).toBeGreaterThan(0);
  });

  const uncertain: InvestigationSnapshot = {
    decision: { state: "insufficient", nextQueries: [] },
    pending: [],
    candidates: [
      { name: "候选甲", matchedClues: 1, missingClues: ["天台对决"], matches: [
        { clue: "天台对决", decisive: true, found: false },
      ] },
    ],
    clues: [{ text: "天台对决", terms: ["天台", "对决"] }],
  };

  it("缺少决定性证据时针对候选与线索继续搜索", () => {
    const next = nextClueSearch(uncertain, []);
    expect(next?.kind).toBe("decisive_clue");
    expect(next?.query).toContain("候选甲");
    expect(next?.query).toContain("天台");
  });

  it("同一检索式不重复，已确认答案不再无意义追查", () => {
    const plan = nextClueSearch(uncertain, ["候选甲 天台 对决 原始资料"]);
    expect(plan).toBeNull();
    expect(nextClueSearch({ ...uncertain, decision: { state: "found" } }, [])).toBeNull();
  });

  it("接近候选的关系优先于再次匹配普通关键词", () => {
    const pair: InvestigationSnapshot = {
      ...uncertain,
      decision: { state: "ambiguous" },
      candidates: [
        uncertain.candidates[0],
        { name: "候选乙", matchedClues: 1, matches: [], missingClues: [] },
      ],
      pending: [{ question: "二者是否为翻拍关系", query: "候选甲 候选乙 翻拍", reason: "排除翻拍版", subject: "候选甲", object: "候选乙" }],
    };
    expect(nextClueSearch(pair, [])?.kind).toBe("relationship");
  });

  it("仅题材符合时不得定案，即使不再有可用检索式", () => {
    const pages: PageLike[] = [{
      id: "p0", url: "https://example.org/work", site: "公开资料",
      title: "《夜色谜局》：悬疑电视剧", date: "",
      passage: "《夜色谜局》是一部悬疑电视剧。",
    }];
    const clues: ClueItem[] = [{ id: "c0", text: "悬疑", terms: ["悬疑"], kind: "genre" }];
    const raw = extractCandidates(pages, new Map(), ["悬疑"]);
    const { decision, candidates } = evaluateCandidates(raw, clues, pages, new Map(), "screen_work", "我记得一部悬疑电视剧");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].matchedClues).toBe(1);
    expect(decision.state).toBe("insufficient");
    expect(decision.askUser).toMatch(/具体情节|人物姓名/);
  });

  it("候选已提到但关键线索没得到证明时保持未确认", () => {
    const pages: PageLike[] = [{
      id: "p1", url: "https://example.org/mystery", site: "公开资料",
      title: "《夜色谜局》：悬疑电视剧", date: "",
      passage: "《夜色谜局》是一部悬疑电视剧。",
    }];
    const clues: ClueItem[] = [
      { id: "g", text: "悬疑", terms: ["悬疑"], kind: "genre" },
      { id: "d", text: "火车爆炸", terms: ["火车", "爆炸"], kind: "other" },
    ];
    const raw = extractCandidates(pages, new Map(), ["悬疑", "火车"]);
    const { decision } = evaluateCandidates(raw, clues, pages, new Map(), "screen_work", "悬疑电视剧里发生火车爆炸");
    expect(decision.state).toBe("insufficient");
    expect(decision.headline).not.toContain("线索全部对上");
  });

  it("初始没有候选时主动改变查询词，而非直接宣布无答案", () => {
    const empty: InvestigationSnapshot = {
      decision: { state: "insufficient" }, pending: [], candidates: [],
      clues: [{ text: "八分钟火车爆炸", terms: ["八分钟", "火车爆炸"] }],
    };
    const first = nextClueSearch(empty, []);
    expect(first?.kind).toBe("discovery");
    const second = nextClueSearch(empty, [first!.query]);
    expect(second?.query).not.toBe(first?.query);
  });
});
