/**
 * 侦探下一步：根据当前候选的证据缺口制定“下一次值得搜索什么”。
 * 这是调查决策，不能使用预置答案、网页命中次数或用户没有给出的事实。
 * 真正的检索由 TRACE 的 SearchPro 适配器执行。
 */
import { lowSignal } from "./clue-plan.ts";

export interface SearchQuestion {
  question: string;
  query: string;
  reason: string;
  subject: string;
  object: string;
  kind: "relationship" | "decisive_clue" | "discovery";
}

export interface InvestigationSnapshot {
  decision: {
    state: "found" | "ambiguous" | "insufficient";
    nextQueries?: { query: string; reason: string }[];
  };
  pending: { question: string; query: string; reason: string; subject: string; object: string }[];
  candidates: {
    name: string;
    matchedClues: number;
    matches: { clue: string; decisive: boolean; found: boolean }[];
    missingClues: string[];
  }[];
  clues: { text: string; terms: string[] }[];
}

const normal = (value: string) => value.normalize("NFKC").replace(/[\s“”"'《》：:，,、]+/g, "").toLowerCase();
const short = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 120);

/** 只规划对当前结论有影响、且从未搜索过的问题。 */
export function nextClueSearch(
  snapshot: InvestigationSnapshot,
  searched: string[],
): SearchQuestion | null {
  const seen = new Set(searched.map(normal));
  const offer = (q: SearchQuestion): SearchQuestion | null =>
    q.query.length >= 2 && !seen.has(normal(q.query)) ? { ...q, query: short(q.query) } : null;
  const top = snapshot.candidates[0];
  const challenger = snapshot.candidates[1];
  const gap = top && challenger ? top.matchedClues - challenger.matchedClues : Infinity;
  const unresolved = snapshot.pending.filter((item) => {
    if (!top) return false;
    return [item.subject, item.object].includes(top.name) &&
      (gap <= 1 || snapshot.decision.state !== "found");
  });
  // 首先查清能改变答案的候选关系，避免把翻拍、续作或原著当成独立答案。
  for (const item of unresolved) {
    const choice = offer({ ...item, kind: "relationship" });
    if (choice) return choice;
  }
  // 关键证据没有证明时，必须搜索候选与这条具体线索的组合。
  if (snapshot.decision.state !== "found") {
    for (const candidate of snapshot.candidates.slice(0, 2)) {
      const missing = candidate.matches.find((match) => match.decisive && !match.found);
      if (!missing) continue;
      const clue = snapshot.clues.find((item) => item.text === missing.clue);
      const terms = (clue?.terms || [missing.clue])
        .filter((item) => item.length >= 2 && !lowSignal(item))
        .slice(0, 2);
      const query = [candidate.name, ...terms, "原始资料"].join(" ");
      const choice = offer({
        question: `「${candidate.name}」是否真正符合「${missing.clue}」？`,
        query,
        reason: "尚无直接证据证明这个候选满足关键线索；需核实后才能定案。",
        subject: candidate.name,
        object: missing.clue,
        kind: "decisive_clue",
      });
      if (choice) return choice;
    }
    // 如果没有明确的关键线索，复用原有的候选对照查询。
    for (const query of snapshot.decision.nextQueries || []) {
      const choice = offer({
        question: "已有候选还缺少什么决定性证据？",
        query: query.query,
        reason: query.reason,
        subject: top?.name || "",
        object: "",
        kind: "discovery",
      });
      if (choice) return choice;
    }
    // 无候选时，主动换检索策略；不得通过“没找到片名”就认定没有答案。
    if (!snapshot.candidates.length) {
      const terms = snapshot.clues.flatMap((clue) => clue.terms || [clue.text])
        .filter((term) => term.length >= 2);
      for (const suffix of ["来源 相关介绍", "关键细节 原始资料"]) {
        const q = [...new Set(terms)].slice(0, 4).join(" ") + " " + suffix;
        const choice = offer({
          question: "当前检索没有可核验的候选，能否通过另一组关键词发现答案？",
          query: q,
          reason: "改用线索关键词重新检索，寻找未被初始查询发现的对象。",
          subject: "",
          object: "",
          kind: "discovery",
        });
        if (choice) return choice;
      }
    }
  }
  // 找到有足够证据的答案，不因无关候选而无休止地搜索。
  return null;
}
