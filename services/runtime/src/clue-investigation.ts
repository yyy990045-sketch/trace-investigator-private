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
    matches: { clue: string; decisive: boolean; found: boolean; relation?: string }[];
    missingClues: string[];
    /** 与用户说法冲突的线索（有原文依据） */
    conflictClues?: string[];
  }[];
  clues: { text: string; terms: string[] }[];
  /** 用户点名的人物类线索（主演/演员）：这类线索必须单独核实 */
  personClues?: string[];
  /** 类型矛盾：用户说的类型与现有候选不一致 */
  typeConflict?: { userType: string; candidateType: string; candidate: string; note: string };
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
  // 用户的描述与资料冲突时，先把冲突查清楚：这决定了「是记错名字」还是「另有其片」。
  // 冲突没查清就定案，等于把用户的原话悄悄改掉了。
  for (const candidate of snapshot.candidates.slice(0, 2)) {
    const clue = (candidate.conflictClues || [])[0];
    if (!clue) continue;
    const choice = offer({
      question: `「${candidate.name}」的资料里为什么没有「${clue}」？`,
      query: `${candidate.name} 主演 演员表`,
      reason: `你说的「${clue}」与该作品资料不一致；先核实它真正的演职员，再判断是记忆有误还是换了一部作品。`,
      subject: candidate.name,
      object: clue,
      kind: "relationship",
    });
    if (choice) return choice;
  }

  // 类型对不上（用户说电影、候选是电视剧）：按用户说的类型再找一轮候选，
  // 而不是继续围着类型不符的那部剧补查。
  if (snapshot.typeConflict) {
    const plotTerms = snapshot.clues
      .flatMap((clue) => clue.terms || [clue.text])
      .filter((term) => term.length >= 2 && !lowSignal(term))
      .filter((term) => !(snapshot.personClues || []).some((name) => name.includes(term) || term.includes(name)));
    const typeWord =
      snapshot.typeConflict.userType === "film"
        ? "电影"
        : snapshot.typeConflict.userType === "tv"
          ? "电视剧"
          : snapshot.typeConflict.userType === "anime"
            ? "动画"
            : "";
    if (typeWord) {
      const choice = offer({
        question: `按你描述的「${typeWord}」，还有哪部作品符合这些剧情？`,
        query: `${[...new Set(plotTerms)].slice(0, 5).join(" ")} ${typeWord}`.trim(),
        reason: `现有候选是${snapshot.typeConflict.candidateType === "tv" ? "电视剧" : snapshot.typeConflict.candidateType === "film" ? "电影" : snapshot.typeConflict.candidateType === "book" ? "小说/原著" : "其他类型"}，和你说的「${typeWord}」不一致；按类型重新找候选。`,
        subject: "",
        object: "",
        kind: "discovery",
      });
      if (choice) return choice;
    }
  }

  // 人物线索没有命中时，先去核对该作品的演职员表：
  // 这一步既能确认用户记对，也能拿到「资料写的是别人」这句可以引用的原文。
  if (snapshot.decision.state !== "found") {
    const people = new Set(snapshot.personClues || []);
    for (const candidate of snapshot.candidates.slice(0, 2)) {
      const unmatched = (candidate.matches || []).find(
        (match) => people.has(match.clue) && !match.found,
      );
      if (!unmatched) continue;
      const choice = offer({
        question: `「${unmatched.clue}」到底有没有出演《${candidate.name}》？`,
        query: `${candidate.name} 主演 演员表`,
        reason: `你提到的「${unmatched.clue}」在现有材料里没有和这部作品对上；先查它的演职员表，再判断是记错了人还是找错了片。`,
        subject: candidate.name,
        object: unmatched.clue,
        kind: "relationship",
      });
      if (choice) return choice;
    }
  }

  // 用户点名的人物对上了某个候选、但剧情线索大量没对上时，最可能的情况是：
  // 这个人演的是另一部片子，而用户把两件事记混了。此时必须先「不带这条人物线索」再查一次剧情。
  if (snapshot.decision.state !== "found") {
    const top = snapshot.candidates[0];
    const total = snapshot.clues.length;
    const coverage = top && total ? top.matchedClues / total : 0;
    const personHit = top?.matches.find((match) => match.found && match.clue.length >= 2 && match.decisive);
    if (top && personHit && coverage < 0.5) {
      const plotTerms = snapshot.clues
        .flatMap((clue) => clue.terms || [clue.text])
        .filter(
          (term) =>
            term.length >= 2 &&
            !lowSignal(term) &&
            !personHit.clue.includes(term) &&
            !term.includes(personHit.clue),
        );
      const choice = offer({
        question: `如果不看「${personHit.clue}」，这些剧情还指向哪部作品？`,
        query: [...new Set(plotTerms)].slice(0, 5).join(" "),
        reason: "你说的主演只对上了一个候选，但剧情线索大多对不上；先把主演放一边，单用剧情再查一次。",
        subject: "",
        object: personHit.clue,
        kind: "discovery",
      });
      if (choice) return choice;
    }
  }

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
