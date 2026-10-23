/**
 * 候选之间的有向关系：谁改编自谁、谁是谁的续集、谁是翻拍、谁只是别名。
 *
 * 设计约束（对应真实缺陷）：
 *  - 关系必须有方向：A ——改编自——> B，不能把「改编自」写成「别名」；
 *  - 每条关系都要绑定一条真实检索到的句子与可打开的来源；
 *  - 同一对对象出现互相冲突的说法时，保留两边证据并标 conflicting，不静默覆盖；
 *  - 判断不出来的关系留空（unconfirmed），由主动消歧去真实搜索补证。
 */
import type { BodyLike, PageLike } from "./clues.ts";

export type RelationType =
  | "alias"        // 同一对象的不同写法（繁简、又名）
  | "adaptation"   // 影视改编自原著
  | "sequel"       // 续集 / 前传
  | "remake"       // 翻拍
  | "character_of" // 角色出自某作品
  | "competitor";  // 彼此独立的竞争候选（没有关系，只是同类）

export interface RelationEvidence {
  quote: string;
  url: string;
  site: string;
  from: "body" | "excerpt";
}

export interface DirectedRelation {
  /** 关系主语（作品 / 角色 / 人） */
  subject: string;
  /** 关系类型；competitor 表示"确认没有关系，属于同类竞争" */
  relation: RelationType;
  /** 关系宾语 */
  object: string;
  /** 判定依据（人话） */
  reason: string;
  /** 状态：confirmed 有明确句子；conflicting 同一对出现矛盾说法；unconfirmed 只是推测 */
  status: "confirmed" | "conflicting" | "unconfirmed";
  evidence: RelationEvidence[];
  /** 冲突时的另一侧证据 */
  conflicts: RelationEvidence[];
}

const TRADITIONAL: Record<string, string> = {
  醫: "医", 學: "学", 劇: "剧", 國: "国", 電: "电", 視: "视", 偵: "侦",
  證: "证", 據: "据", 網: "网", 絡: "络", 殺: "杀", 懸: "悬", 線: "线",
};
/** 归一化：去空白与书名号、繁转简。只有归一化后完全相同的名字才算同一对象。 */
const clean = (value: string) =>
  value
    .replace(/\s+/g, "")
    .replace(/[《》"“”''〈〉「」]/g, "")
    .replace(/[醫學劇國電視偵證據網絡殺懸線]/g, (char) => TRADITIONAL[char] || char);

/** 关系抽取用到的句子级规则：每条都必须能指出主语与宾语。 */
const PATTERNS: { test: RegExp; type: RelationType; reason: string }[] = [
  {
    // 《A》改编自《B》 / 《A》根据《B》改编
    test: /《([^》]{2,24})》[^。]{0,20}(?:改编自|取材自|根据)[^。]{0,12}《([^》]{2,24})》/,
    type: "adaptation",
    reason: "同句写明改编关系",
  },
  {
    // 《A》是《B》的续集 / 《B》的续集《A》
    test: /《([^》]{2,24})》[^。]{0,8}(?:是|为)[^。]{0,8}《([^》]{2,24})》[^。]{0,6}(?:的)?(?:续集|续作|前传)|《([^》]{2,24})》[^。]{0,6}(?:的)?(?:续集|续作|前传)[^。]{0,8}《([^》]{2,24})》/,
    type: "sequel",
    reason: "同句写明续集/前传关系",
  },

];

function evidenceOf(page: PageLike, sentence: string, from: "body" | "excerpt"): RelationEvidence {
  return { quote: sentence.slice(0, 160), url: page.url, site: page.site, from };
}

/** 从检索到的网页里抽取有向关系；同名不同写法（繁简/去符号）按同一对象处理。 */
export function extractRelations(
  pages: PageLike[],
  bodies: Map<string, BodyLike>,
  names: string[] = [],
): DirectedRelation[] {
  // 只保留「两端都是候选」的关系：正文里随便出现的书名号不是我们需要的关系。
  const isCandidate = (value: string) => {
    if (!names.length) return true;
    const key = clean(value);
    return names.some((name) => clean(name) === key);
  };
  const byKey = new Map<string, DirectedRelation>();
  const push = (relation: DirectedRelation) => {
    const key = `${clean(relation.subject)}|${relation.relation}|${clean(relation.object)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, relation);
      return;
    }
    const same = relation.evidence[0]?.url;
    if (same && !existing.evidence.some((item) => item.url === same)) existing.evidence.push(...relation.evidence);
  };

  for (const page of pages) {
    const body = bodies.get(page.id);
    const sources: { text: string; from: "body" | "excerpt" }[] = [
      ...(body?.ok ? [{ text: body.text.slice(0, 20_000), from: "body" as const }] : []),
      { text: [page.title, page.passage].join("\n"), from: "excerpt" as const },
    ];
    for (const source of sources) {
      for (const sentence of source.text.split(/(?<=[。！？!?\n])/).map((item) => item.trim()).filter(Boolean)) {
        for (const pattern of PATTERNS) {
          const match = sentence.match(pattern.test);
          if (!match) continue;
          const [a, b] = pattern.type === "adaptation" && match[3]
            ? [match[4], match[3]]
            : [match[1], match[2]];
          const subject = (a || "").trim();
          const object = (b || "").trim();
          if (!subject || !object || clean(subject) === clean(object)) continue;
          push({
            subject,
            relation: pattern.type,
            object,
            reason: pattern.reason,
            status: "confirmed",
            evidence: [evidenceOf(page, sentence, source.from)],
            conflicts: [],
          });
        }
        // 翻拍：只在句子把方向说清楚时才记，避免把「A 翻拍 V.S B 原版」这类对比标题读成关系。
        const remakeBy = sentence.match(/根据[^。]{0,12}《([^》]{2,24})》[^。]{0,12}(?:翻拍|改编)[^。]{0,12}《([^》]{2,24})》/);
        const remakeOf = sentence.match(/《([^》]{2,24})》[^。]{0,8}(?:翻拍自|重拍自)[^。]{0,10}《([^》]{2,24})》/);
        const remakeBe = sentence.match(/《([^》]{2,24})》[^。]{0,6}(?:是|为)[^。]{0,8}《([^》]{2,24})》[^。]{0,4}(?:的)?(?:翻拍|重拍)/);
        const remakePair = remakeBy
          ? [remakeBy[2], remakeBy[1]]           // 根据《A》翻拍的《B》：B 是翻拍
          : remakeOf
            ? [remakeOf[1], remakeOf[2]]         // 《A》翻拍自《B》：A 是翻拍
            : remakeBe
              ? [remakeBe[1], remakeBe[2]]
              : null;
        if (remakePair && !/V\.?S|对比|差距|原版/.test(sentence)) {
          const [subject, object] = remakePair.map((item) => item.trim());
          if (clean(subject) !== clean(object))
            push({
              subject,
              relation: "remake",
              object,
              reason: "同句写明它翻拍自该作品",
              status: "confirmed",
              evidence: [evidenceOf(page, sentence, source.from)],
              conflicts: [],
            });
        }

        // 「改编自…《B》」这种句子主语常写作「该剧」，用同一网页里出现的片名补主语。
        const adapted = sentence.match(/(?:改编自|取材自|原著|文学作品|小说)[^。]{0,14}《([^》]{2,24})》/);
        if (adapted) {
          const object = adapted[1].trim();
          // 主语只能来自网页标题（「该剧改编自…」这类句子的主语不在句子里）。
          const titleName =
            page.title.match(/《([^》]{2,24})》/)?.[1] ||
            page.title.split(/[（(_|，,·\s]/)[0];
          const subject = (titleName || "").trim();
          if (subject && subject.length >= 2 && clean(subject) !== clean(object))
            push({
              subject,
              relation: "adaptation",
              object,
              reason: "同句写明改编自该作品",
              status: "confirmed",
              evidence: [evidenceOf(page, sentence, source.from)],
              conflicts: [],
            });
        }

        // 「《A》就是《B》」「《A》是《B》第一部」这类写法，说明是同指（同一部作品的不同叫法）。
        const sameRef = sentence.match(
          /《([^》]{2,24})》[^。]{0,8}(?:就是|即|也就是|亦作|又称)[^。]{0,8}《([^》]{2,24})》|《([^》]{2,24})》[^。]{0,6}(?:第一部|第1部|首部)[^。]{0,8}《([^》]{2,24})》/,
        );
        if (sameRef) {
          const [a, b] = sameRef[3] ? [sameRef[4], sameRef[3]] : [sameRef[1], sameRef[2]];
          const subject = (a || "").trim();
          const object = (b || "").trim();
          if (subject && object && clean(subject) !== clean(object))
            push({
              subject,
              relation: "alias",
              object,
              reason: "同句说明两者指的是同一部作品",
              status: "confirmed",
              evidence: [evidenceOf(page, sentence, source.from)],
              conflicts: [],
            });
        }

        // 别名：同一页写「别名：X」时，主语取页面里出现的作品名（标题或中文名）
        const alias = sentence.match(/(?:中文名|片名|剧名)\s*[:：]?\s*([^\s，。]{2,20})[^。]{0,20}别名\s*[:：]?\s*([^\s，。,]{2,20})/);
        if (alias) {
          const subject = alias[1].trim();
          const object = alias[2].trim();
          if (clean(subject) !== clean(object))
            push({
              subject,
              relation: "alias",
              object,
              reason: "同一页把它写成别名",
              status: "confirmed",
              evidence: [evidenceOf(page, sentence, source.from)],
              conflicts: [],
            });
        }
      }
    }
  }

  // 同一对对象既有「改编自」又有「别名」时，按原著处理：别名只是信息框的写法，不能把原著说成别名。
  const relations = [...byKey.values()].filter(
    (item) => isCandidate(item.subject) && isCandidate(item.object),
  );
  for (const adaptation of relations.filter((item) => item.relation === "adaptation")) {
    const alias = relations.find(
      (item) =>
        item.relation === "alias" &&
        clean(item.subject) === clean(adaptation.subject) &&
        clean(item.object) === clean(adaptation.object),
    );
    if (!alias) continue;
    // 已经有同一对对象的改编关系时，别名条目只补充证据，不再单列。
    alias.evidence = [...adaptation.evidence, ...alias.evidence];
    alias.relation = "adaptation";
    alias.reason = "改编关系的辅助写法：信息框把它写成别名，另有来源写明改编自该作品";
    const duplicate = relations.find(
      (item) =>
        item !== alias &&
        item.relation === "adaptation" &&
        clean(item.subject) === clean(alias.subject) &&
        clean(item.object) === clean(alias.object),
    );
    if (duplicate) {
      duplicate.evidence = [...duplicate.evidence, ...alias.evidence].slice(0, 4);
      const index = relations.indexOf(alias);
      if (index >= 0) relations.splice(index, 1);
    }
  }
  for (const relation of relations) {
    const reverse = relations.find(
      (other) =>
        other !== relation &&
        clean(other.subject) === clean(relation.object) &&
        clean(other.object) === clean(relation.subject),
    );
    // 方向相反就是冲突：无论是关系类型不同，还是同一类型却把主宾调了个头
    // （例如「《A》翻拍自《B》」和「《B》翻拍自《A》」同时出现）。
    if (reverse) {
      relation.status = "conflicting";
      relation.conflicts = reverse.evidence;
      relation.reason = `${relation.reason}；另有来源写成相反方向（${reverse.reason}），方向未确认，保留两种说法`;
    }
  }
  return relations;
}

/** 某个候选在关系网里的角色：别名 / 原著 / 续作 / 翻拍 / 作品本体。 */
export function relationRoleOf(
  name: string,
  relations: DirectedRelation[],
): { role: "alias" | "source" | "sequel" | "remake" | "work"; partner?: string; relation?: DirectedRelation } {
  const key = clean(name);
  for (const relation of relations) {
    if (relation.status !== "confirmed") continue;
    const isSubject = clean(relation.subject) === key;
    const isObject = clean(relation.object) === key;
    if (!isSubject && !isObject) continue;
    if (relation.relation === "alias") {
      const partner = isSubject ? relation.object : relation.subject;
      const works = relations.some(
        (other) =>
          other.relation !== "alias" &&
          [clean(other.subject), clean(other.object)].sort().join("|") ===
            [clean(name), clean(partner)].sort().join("|"),
      );
      // 同一对对象已经写明是改编/翻拍/续集时，不能又按「别名」把它并掉。
      if (!works) return { role: "alias", partner, relation };
    }
    if (relation.relation === "adaptation" && isObject)
      return { role: "source", partner: relation.subject, relation };
    if (relation.relation === "sequel" && isSubject)
      return { role: "sequel", partner: relation.object, relation };
    if (relation.relation === "remake" && isSubject)
      return { role: "remake", partner: relation.object, relation };
  }
  return { role: "work" };
}

export interface PendingQuestion {
  /** 待解决的关系问题（自然语言，先想清楚再搜） */
  question: string;
  /** 真实检索词 */
  query: string;
  /** 为什么要查 */
  reason: string;
  subject: string;
  object: string;
}

/**
 * 找出「必须补查」的关系疑点，并给出检索式。
 * 只在关系不明确、且它会影响答案时提出，不为了凑轮数发问。
 */
export function planDisambiguation(
  competitors: { name: string; matchedClues: number; missingClues: string[] }[],
  relations: DirectedRelation[],
  clues: { text: string; terms: string[] }[],
): PendingQuestion[] {
  const questions: PendingQuestion[] = [];
  const known = (a: string, b: string) =>
    relations.some(
      (relation) =>
        relation.status === "confirmed" &&
        [clean(relation.subject), clean(relation.object)].sort().join("|") === [clean(a), clean(b)].sort().join("|"),
    );

  // 1) 头部候选和任何「也对上至少 2 条线索」的候选之间，只要关系不明就先问清：
  //    它们可能是同一部、续集、翻拍，也可能是彼此无关的同类作品。
  const bestCandidate = competitors[0];
  if (bestCandidate)
    for (const other of competitors.slice(1)) {
      if (other.matchedClues < 2) continue;
      if (known(bestCandidate.name, other.name)) continue;
      questions.push({
        question: `《${bestCandidate.name}》与《${other.name}》是什么关系：同一部作品、续集、翻拍，还是彼此无关？`,
        query: `${bestCandidate.name} ${other.name} 区别 关系 是同一部吗`,
        reason: `《${other.name}》也对上 ${other.matchedClues} 条线索，但检索结果里没有说明它和《${bestCandidate.name}》的关系`,
        subject: bestCandidate.name,
        object: other.name,
      });
      if (questions.length >= 2) return questions;
    }

  // 2) 头部候选仍有没核实的关键线索时，针对那条线索单独查。
  const best = competitors[0];
  if (best && best.missingClues.length) {
    const clue = clues.find((item) => item.text === best.missingClues[0]);
    questions.push({
      question: `《${best.name}》是否对应线索「${best.missingClues[0]}」？`,
      query: `${best.name} ${(clue?.terms || [best.missingClues[0]]).slice(0, 2).join(" ")}`,
      reason: `最接近的候选还缺这条线索的直接证据`,
      subject: best.name,
      object: best.missingClues[0],
    });
  }
  return questions.slice(0, 2);
}
