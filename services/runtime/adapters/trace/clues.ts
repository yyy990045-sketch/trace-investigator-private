/**
 * 线索调查的候选发现与线索比对。
 *
 * 只做两件事：
 *  1. 从真实检索结果里取出「可能是什么」的候选名称（不预设、不写死）；
 *  2. 把候选与用户给出的线索逐条比对：命中要能在同一句里找到证据，找不到就标「尚未核实」。
 *
 * 判断不靠关键词出现次数：候选必须与线索在同一句/同一段落共现，且证据句要能展示给用户。
 */

export interface ClueItem {
  id: string;
  /** 线索原文（用户原话或规划出的短句） */
  text: string;
  /** 用于比对的检索词（已去除通用词） */
  terms: string[];
  /** 线索类型：题材/职业/角色/时间/地区/其他 */
  kind: "genre" | "role" | "time" | "region" | "subject" | "other";
  /** 用户自己说「不确定」的线索 */
  uncertain?: boolean;
  /** 来自用户补充 */
  addedByUser?: boolean;
}

export interface PageLike {
  id: string;
  url: string;
  site: string;
  title: string;
  date: string;
  passage: string;
}

export interface BodyLike {
  ok: boolean;
  text: string;
}

export interface CandidateMatch {
  clueId: string;
  clue: string;
  found: boolean;
  /** 命中时用于展示的证据句（原文，不改写） */
  sentence: string;
  url: string;
  site: string;
  title: string;
  /** 证据句来自网页正文还是搜索摘要（摘要不能冒充全文） */
  from: "body" | "excerpt";
  /** 证据强度：同句 > 同段 > 同一网页（地区/题材这类线索常不与片名同句） */
  scope: "sentence" | "paragraph" | "page";
}

/** 用户到底在找什么：作品（剧/电影）、书、人，或还没说清。 */
export type EntityKind = "screen_work" | "book" | "person" | "unknown";

/**
 * 候选与目标的关系。竞争者才参与排名：
 *  target/competitor 可能是答案；alias/source/character/sequel 是同一部作品的关系项，不是另一部作品。
 *  unconfirmed 表示关系不明确，只展示、不参与排名。
 */
export type CandidateRelation = "target" | "competitor" | "alias" | "source" | "character" | "sequel" | "unconfirmed";

export interface EntityInfo {
  kind: EntityKind;
  role: CandidateRelation;
  /** 判定依据（人话） */
  reason: string;
  /** 支撑这条关系的原句 */
  sentence: string;
  url: string;
  site: string;
}

export interface Candidate {
  name: string;
  entity?: EntityInfo;
  /** 是否以书名号形式出现（更像作品名，而不是角色名或句子） */
  quoted: boolean;
  /** 被多少个不同来源提到 */
  mentions: number;
  /** 有多少条网页标题里直接写了这个名字 */
  titleHits: number;
  /** 综合分：线索命中为主，标题指认与来源数为辅 */
  score: number;
  sites: number;
  pages: { url: string; site: string; title: string; date: string }[];
  matches: CandidateMatch[];
  matchedClues: number;
  missingClues: string[];
  /** 只有全部线索命中且明显领先时才算 confirmed */
  status: "leading" | "tied" | "partial";
  /** 与线索的差异说明（用于「为什么排除」） */
  note: string;
}

export interface ClueDecision {
  state: "found" | "ambiguous" | "insufficient";
  headline: string;
  /** 继续检索时，为什么继续、查什么 */
  nextQueries: { query: string; reason: string }[];
  /** 无法区分时，向用户要的一条补充线索 */
  askUser: string | null;
  /** 题材/地区这类辅助线索没能同句核实：结论仍成立，但要说清楚 */
  auxiliaryClues?: string[];
}

const STOP_NAMES = new Set([
  "电视剧", "国产剧", "网剧", "美剧", "韩剧", "日剧", "纪录片", "综艺",
  "法医", "破案", "悬疑", "刑侦", "侦探", "主角", "男主", "女主", "演员",
  "国产", "中国", "全部", "新闻", "视频", "百度百科", "百度知道", "知乎",
]);

/** 从一段文本里找「可能是名字」的候选：书名号优先，其次标题主干。 */
const tidyName = (value: string) => value.replace(/^[〈《「『"“'‘（(\s]+/, "").replace(/[〉》」』"”'’）)\s]+$/, "").trim();

function namesIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/《([^》]{2,24})》/g)) found.push(tidyName(match[1]));
  for (const match of text.matchAll(/(?:剧名|片名)[:：]\s*([^\s，。、；]{2,24})/g)) found.push(tidyName(match[1]));
  for (const match of text.matchAll(/【([^】]{2,24})】/g)) found.push(tidyName(match[1]));
  return found.filter(Boolean);
}

const TRADITIONAL: Record<string, string> = {
  醫: "医", 學: "学", 劇: "剧", 國: "国", 電: "电", 視: "视", 偵: "侦", 探: "探",
  證: "证", 據: "据", 網: "网", 絡: "络", 殺: "杀", 懸: "悬", 線: "线",
  廳: "厅", 級: "级", 員: "员", 節: "节",
};
const normalized = (value: string) =>
  value
    .replace(/[\s"'“”‘’·・\-—_()（）]/g, "")
    .replace(/[醫學劇國電視偵證據網絡殺懸線廳級員節]/g, (char) => TRADITIONAL[char] || char);

/**
 * 从检索结果中提取候选。
 * 只保留「至少两个来源提到」或「出现在网页标题里」的名字，避免把偶然出现的词当候选。
 */
export function extractCandidates(
  pages: PageLike[],
  bodies: Map<string, BodyLike>,
  clueTerms: string[] = [],
  limit = 6,
): Candidate[] {
  const byName = new Map<string, Candidate>();
  for (const page of pages) {
    const body = bodies.get(page.id);
    const text = [page.title, page.passage, body?.ok ? body.text.slice(0, 6000) : ""].join("\n");
    const quotedNames = new Set(namesIn(text));
    const names = new Set(quotedNames);
    // 标题常常就是「XX 第1集」这类，补一条：标题开头到第一个分隔符
    const titleHead = page.title.split(/[_|｜:：\-—]/)[0].trim();
    if (titleHead.length >= 2 && titleHead.length <= 24 && namesIn(titleHead).length === 0) names.add(titleHead);
    for (const raw of names) {
      const name = raw.trim();
      if (name.length < 2 || STOP_NAMES.has(name)) continue;
      if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(name)) continue;
      const key = normalized(name);
      const existing = byName.get(key) || {
        name,
        quoted: quotedNames.has(name),
        mentions: 0,
        titleHits: 0,
        score: 0,
        sites: 0,
        pages: [],
        matches: [],
        matchedClues: 0,
        missingClues: [],
        status: "partial" as const,
        note: "",
      };
      if (quotedNames.has(name)) existing.quoted = true;
      if (!existing.pages.some((item) => item.url === page.url)) {
        existing.mentions += 1;
        existing.pages.push({ url: page.url, site: page.site, title: page.title, date: page.date });
      }
      byName.set(key, existing);
    }
  }

  const candidates: Candidate[] = [];
  for (const candidate of byName.values()) {
    const inTitle = pages.some((page) => page.title.includes(candidate.name));
    if (candidate.mentions < 2 && !inTitle) continue;
    candidate.sites = new Set(candidate.pages.map((page) => page.site)).size;
    candidate.titleHits = pages.filter((page) => page.title.includes(candidate.name)).length;
    candidates.push(candidate);
  }
  // 不是作品名的东西不要当候选：疑问句标题、角色名（含用户给的线索词）、明显是句子片段。
  const workLike = candidates.filter((item) => {
    if (/[？?]|哪|怎么|多少|为什么|如何/.test(item.name)) return false;
    if (item.name.length > 16) return false;
    if (!item.quoted && candidateLooksLikeClue(item.name, clueTerms)) return false;
    if (!item.quoted && /(剧|电视剧|影片|电影)$/.test(item.name)) return false;
    return true;
  });

  // 名称被更长候选包含时，保留更具体的那个（例如「法医秦明之幸存者」与「法医秦明」并存）
  const kept = workLike.filter(
    (item) => !candidates.some((other) => other !== item && other.name.includes(item.name) && other.mentions >= item.mentions),
  );
  // 书名号里的名字优先（更可能是作品名），其余按被提到的次数排。
  return kept
    .sort((a, b) => Number(b.quoted) - Number(a.quoted) || b.mentions - a.mentions)
    .slice(0, limit);
}

/**
 * 从用户原话判断他想找哪类实体。
 * 只说「那部剧」就按作品处理；明确说「原著/小说」才按书处理。
 */
export function detectTargetKind(question: string): EntityKind {
  const text = String(question || "");
  if (/(原著|小说|书名叫|书名|哪本书|文学作品)/.test(text)) return "book";
  if (/(演员|谁演的|谁扮演|扮演者|哪个人|叫什么的演员)/.test(text)) return "person";
  if (/(电视剧|剧名|剧集|网剧|连续剧|片子|电影|动画|综艺|看过一部|一部.*剧)/.test(text)) return "screen_work";
  return "unknown";
}

const escapeName = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 候选名带着线索词（例如「李大宝」里的「大宝」），更像角色名。 */
function candidateLooksLikeClue(name: string, clueTerms: string[]): boolean {
  return clueTerms.some((term) => term.length >= 2 && name.includes(term));
}

/**
 * 判断一个候选到底是「目标作品」「原著」「角色」「续作」还是关系不明。
 * 依据是同一句里的谓语：出品/主演 → 作品；改编自/文学作品 → 原著；饰演/女主角 → 角色。
 * 判断不了就返回 unconfirmed，不猜。
 */
export function classifyEntity(
  name: string,
  pages: PageLike[],
  bodies: Map<string, BodyLike>,
): EntityInfo {
  const escaped = escapeName(name);
  const aliasSignal = new RegExp(`(别名|又名|英文名|原名)\\s*[:：]?\\s*[^。]{0,12}${escaped}`);
  const workSubject = new RegExp(
    `(《${escaped}》|${escaped})[^。]{0,24}(出品|制作|开播|首播|播出|上映|执导|导演|的[^。]{0,6}(电视剧|网络剧|剧集|连续剧|电影|动画))`,
  );
  const workMention = /电视剧|网络剧|剧集|连续剧|电影|动画|综艺/;
  const sourceSignal = /(改编自|取材自|原著|文学作品|小说)/;
  const characterSignal = new RegExp(
    `(${escaped}\\s*[（(][^）)]{0,16}(女主角|男主角|角色|饰)|由[^。]{0,8}饰演[^。]{0,8}${escaped}|${escaped}\\s*饰演)`,
  );
  const sequelSignal = /(续集|番外|第[二三四五六七八九十2-9]季|Ⅱ|II)/;
  /** 翻拍/改编版本：是另一部作品，但不是用户要找的那一部。 */
  const remakeSignal = /(翻拍|改编自|重拍|美版|日版|韩版|remake)/i;

  // 优先级：别名 > 作品主体 > 原著 > 角色 > 续作 > 泛提。数值越小越可信。
  const state: { priority: number; info: EntityInfo | null } = { priority: Number.POSITIVE_INFINITY, info: null };
  const consider = (priority: number, info: EntityInfo) => {
    if (priority < state.priority) {
      state.priority = priority;
      state.info = info;
    }
  };

  for (const page of pages) {
    const body = bodies.get(page.id);
    const text = [page.title, page.passage, body?.ok ? body.text.slice(0, 20_000) : ""].join("\n");
    if (!text.includes(name)) continue;
    for (const sentence of text.split(/(?<=[。！？!?\n])/).map((item) => item.trim()).filter(Boolean)) {
      if (!sentence.includes(name)) continue;
      const base = { sentence: snippetAround(sentence, name, 120), url: page.url, site: page.site };
      if (aliasSignal.test(sentence)) {
        // 只展示「别名：X」这一小段，不要把整块百科信息一起搬过来。
        const fragment = sentence.match(/(别名|又名)\s*[:：]?\s*[^\s。，,]{1,16}/)?.[0];
        consider(0, {
          kind: "screen_work",
          role: "alias",
          reason: "同一页把它写成别名",
          ...base,
          ...(fragment ? { sentence: fragment } : {}),
        });
      }
      else if (workSubject.test(sentence))
        consider(1, { kind: "screen_work", role: "competitor", reason: "同句说明它是一部剧/电影（出品、播出、主演等）", ...base });
      else if (sourceSignal.test(sentence) && sentence.includes(`《${name}》`))
        consider(2, { kind: "book", role: "source", reason: "同句把它写成原著/文学作品", ...base });
      else if (characterSignal.test(sentence) && !sentence.includes(`《${name}》`))
        consider(3, { kind: "person", role: "character", reason: "同句把它写成剧中角色", ...base });
      else if (sequential(name) && sequelSignal.test(sentence))
        consider(4, { kind: "screen_work", role: "sequel", reason: "同句提到它是续集/某一季", ...base });
      else if (remakeSignal.test(sentence) && (sentence.includes(`《${name}》`) || sentence.includes(name)))
        consider(4, { kind: "screen_work", role: "sequel", reason: "同句说明它是翻拍/改编版本", ...base });
      else if (workMention.test(sentence) && sentence.includes(`《${name}》`))
        consider(5, { kind: "screen_work", role: "competitor", reason: "同句把它和剧集放在一起称呼", ...base });
    }
  }
  // 别名项如果同时有「改编自…」的说法，把原著关系一并写出来（两种都是真的）。
  if (state.info?.role === "alias") {
    const adapted = pages
      .flatMap((page) => {
        const body = bodies.get(page.id);
        return [page.title, page.passage, body?.ok ? body.text.slice(0, 6000) : ""].join("\n").split(/(?<=[。！？!?\n])/);
      })
      .map((item) => item.trim())
      .find((item) => sourceSignal.test(item) && item.includes(`《${name}》`));
    if (adapted)
      state.info = { ...state.info, reason: "同一页把它写成别名；另有来源写明它是该剧改编所依据的原著" };
  }
  return (
    state.info || {
      kind: "unknown",
      role: "unconfirmed",
      reason: "搜索结果里没有能说明它是什么的句子",
      sentence: "",
      url: pages.find((page) => page.title.includes(name))?.url || pages[0]?.url || "",
      site: "",
    }
  );
}

/**
 * 这个候选是不是「关系项」而不是竞争作品。
 * 用户找剧时：别名、原著、角色、续作都不和其它剧竞争。
 */
function isRelation(candidate: Candidate, targetKind: EntityKind): boolean {
  const role = candidate.entity?.role || "unconfirmed";
  if (role === "alias" || role === "source" || role === "character" || role === "sequel") return true;
  if (targetKind === "unknown") return role === "unconfirmed";
  const kind = candidate.entity?.kind || "unknown";
  return kind !== "unknown" && kind !== targetKind;
}

function sequential(name: string) {
  return /(之|第[二三四五六七八九十2-9]季|Ⅱ|II|2)$/.test(name);
}

/** 长句/长段落只显示命中位置附近的窗口，保证展示出来的句子里真的能看到候选名。 */
function snippetAround(text: string, name: string, size = 160) {
  const plain = text.trim();
  const at = normalized(plain).indexOf(normalized(name));
  if (at < 0 || plain.length <= size) return plain.slice(0, size);
  // 归一化会去掉标点，按比例映射回原串位置
  const ratio = plain.length / Math.max(1, normalized(plain).length);
  const center = Math.round(at * ratio);
  const start = Math.max(0, center - Math.floor(size / 3));
  return `${start > 0 ? "…" : ""}${plain.slice(start, start + size).trim()}${start + size < plain.length ? "…" : ""}`;
}

/** 把一个候选与线索逐条比对：同句优先，退一步到同段落共现，都保留原句。 */
export function matchCandidate(
  candidate: Candidate,
  clues: ClueItem[],
  pages: PageLike[],
  bodies: Map<string, BodyLike>,
): Candidate {
  const matches: CandidateMatch[] = [];
  for (const clue of clues) {
    let hit: CandidateMatch | null = null;
    const hasTerm = (value: string) => clue.terms.some((term) => normalized(value).includes(normalized(term)));
    for (const page of pages) {
      if (!page.url) continue;
      const body = bodies.get(page.id);
      // 正文优先，其次搜索摘要：命中位置要标清楚，摘要不能冒充全文。
      const blocks: { from: "body" | "excerpt"; text: string }[] = [
        ...(body?.ok ? [{ from: "body" as const, text: body.text.slice(0, 20_000) }] : []),
        { from: "excerpt" as const, text: [page.title, page.passage].join("\n") },
      ];
      for (const block of blocks) {
        for (const sentence of block.text.split(/(?<=[。！？!?\n])/).map((item) => item.trim()).filter(Boolean)) {
          const pure = normalized(sentence);
          if (!pure.includes(normalized(candidate.name)) || !hasTerm(sentence)) continue;
          hit = { clueId: clue.id, clue: clue.text, found: true, sentence: snippetAround(sentence, candidate.name), url: page.url, site: page.site, title: page.title, from: block.from, scope: "sentence" };
          break;
        }
        if (hit) break;
        for (const paragraph of block.text.split(/\n+/).map((item) => item.trim()).filter(Boolean)) {
          const pure = normalized(paragraph);
          if (pure.length > 600) continue;
          if (!pure.includes(normalized(candidate.name)) || !hasTerm(paragraph)) continue;
          hit = { clueId: clue.id, clue: clue.text, found: true, sentence: snippetAround(paragraph, candidate.name), url: page.url, site: page.site, title: page.title, from: block.from, scope: "paragraph" };
          break;
        }
        if (hit) break;
      }
      if (hit) break;
    }
    // 地区/题材这类线索通常不会和片名出现在同一句里：退到「同一网页内出现」，
    // 但把强度明确标成 page，界面上会写清「同一网页内出现，未同句」。
    if (!hit && (clue.kind === "region" || clue.kind === "genre")) {
      for (const page of pages) {
        if (!page.url) continue;
        const mentioned = page.title.includes(candidate.name) || page.passage.includes(candidate.name);
        if (!mentioned) continue;
        const body = bodies.get(page.id);
        const haystack = [page.title, page.passage, body?.ok ? body.text.slice(0, 4000) : ""].join("\n");
        if (!hasTerm(haystack)) continue;
        const sentence = haystack.split(/(?<=[。！？!?\n])/).map((item) => item.trim()).find((item) => hasTerm(item)) || "";
        hit = {
          clueId: clue.id,
          clue: clue.text,
          found: true,
          sentence: sentence.slice(0, 160),
          url: page.url,
          site: page.site,
          title: page.title,
          from: body?.ok ? "body" : "excerpt",
          scope: "page",
        };
        break;
      }
    }
    matches.push(
      hit || {
        clueId: clue.id,
        clue: clue.text,
        found: false,
        sentence: "",
        url: candidate.pages[0]?.url || "",
        site: "",
        title: "",
        from: "excerpt" as const,
        scope: "sentence" as const,
      },
    );
  }
  const matchedClues = matches.filter((item) => item.found).length;
  const missingClues = matches.filter((item) => !item.found).map((item) => item.clue);
  // 命中线索最重要；标题里被直接指认、以及被多个不同来源提到，作为区分依据（不是排序玄学）。
  const score = matchedClues * 10 + Math.min(candidate.titleHits, 5) * 2 + Math.min(candidate.sites, 6);
  return { ...candidate, matches, matchedClues, missingClues, score };
}

/** 汇总所有候选，并给出「继续查 / 问用户 / 结束」的判断。 */
export function evaluateCandidates(
  raw: Candidate[],
  clues: ClueItem[],
  pages: PageLike[],
  bodies: Map<string, BodyLike>,
  targetKind: EntityKind = "unknown",
): { candidates: Candidate[]; relations: Candidate[]; decision: ClueDecision } {
  // 先判断每个候选是什么：只有和目标同类的才参与排名，原著/角色/别名作为关系展示。
  const classified = raw.map((candidate) => {
    const entity = classifyEntity(candidate.name, pages, bodies);
    return matchCandidate({ ...candidate, entity }, clues, pages, bodies);
  });
  const relations = classified.filter((item) => isRelation(item, targetKind));
  const candidates = classified
    .filter((item) => !isRelation(item, targetKind))
    .sort((a, b) => b.matchedClues - a.matchedClues || b.score - a.score);
  if (!candidates.length)
    return {
      candidates,
      relations,
      decision: {
        state: "insufficient",
        headline: "这次没有从检索结果里找到可核对的候选",
        nextQueries: [],
        askUser: "能再补充一个特征吗？比如大概的上映时间、主角名字的另一个字，或你记得的一句台词。",
      },
    };

  const best = candidates[0];
  const runnerUp = candidates[1];
  const total = clues.length;
  const tie = Boolean(runnerUp && runnerUp.matchedClues === best.matchedClues && best.score - runnerUp.score < 2);
  // 题材/地区这类线索常常只出现在网页别处：它们没同句命中时不算决定性缺口，但必须写进结论。
  const auxiliary = clues.filter((clue) => clue.kind === "genre" || clue.kind === "region").map((clue) => clue.text);
  const auxiliaryMissing = best.missingClues.filter((text) => auxiliary.includes(text));
  const decisiveMissing = best.missingClues.filter((text) => !auxiliary.includes(text));
  if (!decisiveMissing.length && !tie)
    return {
      candidates,
      relations,
      decision: {
        state: "found",
        headline: `线索全部对上：${best.name}`,
        nextQueries: [],
        askUser: null,
        ...(auxiliaryMissing.length ? { auxiliaryClues: auxiliaryMissing } : {}),
      },
    };

  const missingTerms = [...new Set(best.missingClues.flatMap((text) => {
    const clue = clues.find((item) => item.text === text);
    return clue ? clue.terms : [text];
  }))].slice(0, 3);

  if (tie || (runnerUp && best.matchedClues - runnerUp.matchedClues <= 0)) {
    const nextQueries = candidates.slice(0, 2).map((candidate) => ({
      query: [candidate.name, ...missingTerms.slice(0, 2)].join(" ").trim(),
      reason: `${candidate.name} 还缺「${(candidate.missingClues[0] || "关键线索").slice(0, 20)}」，查它能否补上`,
    }));
    const askClue = best.missingClues[0] || runnerUp?.missingClues[0] || "";
    return {
      candidates,
      relations,
      decision: {
        state: "ambiguous",
        headline: `找到 ${candidates.length} 个可能候选，还差一条能区分的线索`,
        nextQueries,
        askUser: askClue
          ? `目前有两个比较接近的作品，你还记得「${askClue.slice(0, 24)}」相关的细节吗？`
          : "还记得别的细节吗？比如主角名字、播出年份，或一句台词。",
      },
    };
  }

  const nextQueries = missingTerms.length
    ? [{ query: [best.name, ...missingTerms].join(" "), reason: `${best.name} 还有线索没核实` }]
    : [];
  return {
    candidates,
    relations,
    decision: {
      state: nextQueries.length ? "insufficient" : "found",
      headline: nextQueries.length
        ? `比较接近的是「${best.name}」，但还缺证据`
        : `线索全部对上：${best.name}`,
      nextQueries,
      askUser: nextQueries.length ? null : null,
    },
  };
}

/** 线索文本 → 结构化线索。规则部分只做最低限度拆分，语义交给模型规划。 */
export function clueItemsFrom(texts: { text: string; terms?: string[]; kind?: ClueItem["kind"] }[]): ClueItem[] {
  return texts
    .map((item, index) => ({
      id: `clue-${index + 1}`,
      text: item.text.trim(),
      terms: (item.terms && item.terms.length ? item.terms : [item.text]).map((term) => term.trim()).filter(Boolean),
      kind: item.kind || ("other" as const),
    }))
    .filter((item) => item.text.length > 0);
}
