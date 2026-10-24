/**
 * 线索调查的候选发现与线索比对。
 *
 * 只做两件事：
 *  1. 从真实检索结果里取出「可能是什么」的候选名称（不预设、不写死）；
 *  2. 把候选与用户给出的线索逐条比对：命中要能在同一句里找到证据，找不到就标「尚未核实」。
 *
 * 判断不靠关键词出现次数：候选必须与线索在同一句/同一段落共现，且证据句要能展示给用户。
 */

import {
  extractRelations,
  planDisambiguation,
  relationRoleOf,
  type DirectedRelation,
  type PendingQuestion,
} from "./relations.ts";

export type { DirectedRelation, PendingQuestion };

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
  /** 证据落在什么粒度：同句 > 同段 > 同一网页（后两者只能算间接关联） */
  scope: "sentence" | "paragraph" | "page";
  /** 这条证据属于哪一类：直接支持 / 间接关联 / 未核实 / 与资料冲突 */
  relation: "direct" | "indirect" | "unverified" | "conflicts";
  /**
   * 冲突强度：
   *  - explicit：资料里有明确的否定表述（例如「并非由 X 主演」），可以算反证；
   *  - absent：只是现有资料的主演名单里没有出现这个人，不能推断用户记错。
   */
  conflictStrength?: "explicit" | "absent";
  /** 证据实际描述的主体（通常等于候选名；列举句里会是别人） */
  subject: string;
  /** 这是不是决定性线索 */
  decisive: boolean;
}

/** 用户到底在找什么：作品（剧/电影）、书、人，或还没说清。 */
export type EntityKind = "screen_work" | "book" | "person" | "other" | "unknown";

/**
 * 候选与目标的关系。竞争者才参与排名：
 *  target/competitor 可能是答案；alias/source/character/sequel 是同一部作品的关系项，不是另一部作品。
 *  unconfirmed 表示关系不明确，只展示、不参与排名。
 */
export type CandidateRelation =
  | "target"
  | "competitor"
  | "alias"
  | "source"
  | "character"
  | "sequel"
  | "remake"
  | "not_screen_work"
  | "unconfirmed";

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
  /** 与用户说法冲突的线索条数（有原文依据，才会计入） */
  conflicts?: number;
  conflictClues?: string[];
  /** 类型证据票数（电影/电视剧/动画/小说），来自真实句子 */
  typeVotes?: Partial<Record<WorkType, number>>;
  /** 归类后的作品类型（票数最多者） */
  type?: WorkType;
  /** 该候选出现过的全部类型（小说改编电影时两者都算） */
  types?: WorkType[];
  /** 身份事实：类型/年份/导演/主演，都绑定到来源与原句 */
  identity?: WorkIdentity;
  /** 是否有足够的作品身份依据（够才进入正式影视候选） */
  identityOk?: boolean;
  /** 类型是否与用户说法矛盾 */
  typeConflict?: boolean;
  /** 只有全部线索命中且明显领先时才算 confirmed */
  status: "leading" | "tied" | "partial";
  /** 与线索的差异说明（用于「为什么排除」） */
  note: string;
}

export interface ClueDecision {
  /** 决定性线索（用来定案的那些） */
  decisiveClues?: string[];
  state: "found" | "ambiguous" | "insufficient";
  headline: string;
  /** 继续检索时，为什么继续、查什么 */
  nextQueries: { query: string; reason: string }[];
  /** 无法区分时，向用户要的一条补充线索 */
  askUser: string | null;
  /** 题材/地区这类辅助线索没能同句核实：结论仍成立，但要说清楚 */
  auxiliaryClues?: string[];
  /** 用户记忆里与资料冲突的线索（附原文证据），结论里要说明 */
  conflicts?: {
    clue: string;
    candidate: string;
    quote: string;
    url: string;
    site: string;
    from: "body" | "excerpt";
    /** explicit=有明确否定表述；absent=只是资料名单里没出现 */
    strength: "explicit" | "absent";
  }[];
  /** 还无法排除其他候选时，先给出「最可能的答案」 */
  bestGuess?: string;
  /**
   * 最可能答案的证据限制（例如「这几条情节来自同一段材料」）。
   * 有它就说明：只能给到「可能性较高」，不是已经定案。
   */
  evidenceLimit?: string;
  /** 最可能答案之外，同样能解释描述的其他候选（含各自符合/缺少的情节） */
  comparison?: {
    name: string;
    matched: string[];
    missing: string[];
    type: string;
    note: string;
  }[];
  /** 用户记的年份 vs 资料里的上映/首播年份 */
  yearCheck?: {
    userYears: string[];
    candidateYears: { year: string; quote: string; url: string; site: string }[];
    note: string;
  };
  /** 类型矛盾：用户说电影，候选却是电视剧等 */
  typeConflict?: { userType: WorkType; candidateType: WorkType; candidate: string; note: string };
}

const STOP_NAMES = new Set([
  "电视剧", "国产剧", "网剧", "美剧", "韩剧", "日剧", "纪录片", "综艺",
  "法医", "破案", "悬疑", "刑侦", "侦探", "主角", "男主", "女主", "演员",
  "国产", "中国", "全部", "新闻", "视频", "百度百科", "百度知道", "知乎",
]);

/** 从一段文本里找「可能是名字」的候选：书名号优先，其次标题主干。 */
const tidyName = (value: string) => value.replace(/^[〈《「『"“'‘（(\s]+/, "").replace(/[〉》」』"”'’）)\s]+$/, "").trim();

/**
 * 作品类型：电影 / 电视剧 / 动画 / 小说。
 * 只从真实句子里读，不根据名字猜——「用户说电影，候选是电视剧」这类判断必须能指回原句。
 */
export type WorkType = "film" | "tv" | "anime" | "book" | "other";

const TYPE_PATTERNS: { pattern: RegExp; type: WorkType }[] = [
  { pattern: /(电视剧|电视连续剧|剧集|网剧|连续剧|共\s*\d+\s*集|每集|开播)/, type: "tv" },
  { pattern: /(电影|影片|院线|上映|公映)/, type: "film" },
  { pattern: /(动画片|动画电影|动画剧集|番剧|动画)/, type: "anime" },
  { pattern: /(小说|原著|长篇小说|文学作品)/, type: "book" },
];

export function workTypeOf(question: string): WorkType {
  const text = String(question || "");
  if (/(动画|动漫)/.test(text)) return "anime";
  if (/(电视剧|剧集|网剧|连续剧|每集|集数)/.test(text)) return "tv";
  if (/(电影|影片|院线|片名)/.test(text)) return "film";
  return "other";
}

const typeLabel: Record<WorkType, string> = {
  film: "电影",
  tv: "电视剧",
  anime: "动画",
  book: "小说/原著",
  other: "作品",
};

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
  碼: "码", 際: "际", 間: "间", 製: "制", 發: "发", 開: "开", 關: "关", 戲: "戏",
  眾: "众", 聲: "声", 語: "语", 財: "财", 運: "运", 輸: "输", 練: "练", 習: "习",
  題: "题", 樣: "样", 麼: "么", 為: "为", 與: "与", 這: "这", 對: "对", 點: "点",
  產: "产", 銷: "销", 車: "车", 長: "长", 門: "门", 東: "东", 們: "们", 個: "个",
};
const normalized = (value: string) =>
  value
    .replace(/[\s"'“”‘’·・\-—_()（）]/g, "")
    .replace(/[醫學劇國電視偵證據網絡殺懸線廳級員節碼際間製發開關戲眾聲語財運輸練習題樣麼為與這對點產銷車長門東們個]/g, (char) => TRADITIONAL[char] || char);

/**
 * 从检索结果中提取候选。
 * 只保留「至少两个来源提到」或「出现在网页标题里」的名字，避免把偶然出现的词当候选。
 */
export function extractCandidates(
  pages: PageLike[],
  bodies: Map<string, BodyLike>,
  clueTerms: string[] = [],
  limit = 24,
): Candidate[] {
  const byName = new Map<string, Candidate>();
  for (const page of pages) {
    const body = bodies.get(page.id);
    const text = [page.title, page.passage, body?.ok ? body.text.slice(0, 6000) : ""].join("\n");
    const quotedNames = new Set(namesIn(text));
    const names = new Set(quotedNames);
    // 第一阶段（召回）：不只认书名号。正文里「电视剧《X》」「X 是一部电影」这类
    // 明确的类型标记也说明它是一个作品名，漏掉它们会直接导致候选召回不足。
    for (const match of text.matchAll(/(?:电影|电视剧|影片|剧集|网剧|动画片|动画|纪录片)\s*《([^》]{2,24})》/g))
      names.add(tidyName(match[1]));
    for (const match of text.matchAll(/《([^》]{2,24})》\s*(?:是|为)?\s*一部?\s*(电影|电视剧|影片|剧集|网剧|动画片|动画|纪录片)/g))
      names.add(tidyName(match[1]));
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
    // 身份事实：类型/年份/导演/主演，都必须是「同一小句里点了这个名字」的陈述。
    const identity = identityFacts(candidate.name, pages, bodies);
    candidate.identity = identity;
    const inTitle = pages.some((page) => page.title.includes(candidate.name));
    // 第一阶段是「尽量发现」：名字只被提到一次，只要它和关键剧情出现在同一句里，
    // 也先收进候选（很多作品是在「类似作品」段落里被提到的）。
    const plotRelated = pages.some((page) => {
      const body = bodies.get(page.id);
      const text = [page.title, page.passage, body?.ok ? body.text.slice(0, 6000) : ""].join("\n");
      const at = text.indexOf(candidate.name);
      if (at < 0) return false;
      const window = text.slice(Math.max(0, at - 120), at + 160);
      return clueTerms.some((term) => term.length >= 2 && window.includes(term));
    });
    if (candidate.mentions < 2 && !inTitle && !plotRelated) continue;
    candidate.sites = new Set(candidate.pages.map((page) => page.site)).size;
    candidate.titleHits = pages.filter((page) => page.title.includes(candidate.name)).length;
    const identityTypes = (candidate.identity?.types || []).map((item) => item.value as WorkType);
    const uniqueTypes = [...new Set(identityTypes)].filter((type) => type !== "other");
    candidate.type = uniqueTypes[0] || "other";
    candidate.types = uniqueTypes.length ? uniqueTypes : ["other"];
    // 有身份依据（类型/年份/导演/主演或书名号）才算正式影视候选；其余只能当资料。
    candidate.identityOk =
      uniqueTypes.length > 0 ||
      (candidate.identity?.years.length || 0) > 0 ||
      (candidate.identity?.directors.length || 0) > 0 ||
      (candidate.identity?.cast.length || 0) > 0 ||
      candidate.quoted;
    candidates.push(candidate);
  }
  // 作品上下文：名字附近出现「电影/电视剧/上映/主演/导演/豆瓣…」才像一部作品，
  // 否则只是新闻标题里的短语（例如「国内首个可以睡觉的列车」）。
  for (const candidate of candidates) {
    let signals = 0;
    for (const page of pages) {
      const body = bodies.get(page.id);
      const text = [page.title, page.passage, body?.ok ? body.text.slice(0, 6000) : ""].join("\n");
      const at = text.indexOf(candidate.name);
      if (at < 0) continue;
      const window = text.slice(Math.max(0, at - 40), at + candidate.name.length + 60);
      if (/(电影|电视剧|影片|剧集|网剧|动画|上映|首播|主演|导演|编剧|豆瓣|评分|剧情|讲述|改编)/.test(window))
        signals += 1;
    }
    (candidate as Candidate & { workSignals?: number }).workSignals = signals;
  }

  // 不是作品名的东西不要当候选：疑问句标题、角色名（含用户给的线索词）、明显是句子片段。
  const workLike = candidates.filter((item) => {
    // 没有身份依据（类型/年份/导演/主演，且不是书名号里的名字）的对象不进正式候选，
    // 歌曲、文章、评论标题就停在这里，只作为资料。
    if (!item.identityOk) return false;
    if (!item.quoted && ((item as Candidate & { workSignals?: number }).workSignals || 0) === 0) return false;
    if (/(首个|可以|我们|怎样|多少|揭秘|真相|最新|回应|公布)/.test(item.name)) return false;
    if (/[？?]|哪|怎么|多少|为什么|如何/.test(item.name)) return false;
    // 科普/教程类标题不是作品名
    if (/(方法|原理|教程|攻略|介绍|是什么|解析|揭秘|盘点|排行榜|合集|大全|指南)/.test(item.name)) return false;
    if (item.name.length > 16) return false;
    if (!item.quoted && candidateLooksLikeClue(item.name, clueTerms)) return false;
    if (!item.quoted && /(剧|电视剧|影片|电影)$/.test(item.name)) return false;
    return true;
  });

  // 不再因为「名字被更长的候选包含」就丢掉短名：
  // 《无间道》与《无间道风云》是两个作品，包含关系不等于同一对象，是否合并交给关系判断。
  const kept = workLike;
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
  /** 不是影视作品的写法：歌名、小说、游戏、漫画。 */
  const nonScreenSignal = /(演唱|歌曲|主题曲|插曲|片尾曲|作词|作曲|音乐专辑|小说|漫画|游戏|文学作品)/;
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
      else if (nonScreenSignal.test(sentence) && !/(电视剧|电影)/.test(sentence))
        consider(1, {
          kind: "other",
          role: "not_screen_work",
          reason: "同句说明它是歌曲/小说/游戏，不是影视作品",
          ...base,
        });
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
  if (
    role === "alias" ||
    role === "source" ||
    role === "character" ||
    role === "sequel" ||
    role === "remake" ||
    role === "not_screen_work"
  )
    return true;
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

/** 题材/身份/地区这类词区分不了候选，不能算决定性线索。 */
const GENERIC_CLUE_TERMS = new Set([
  "男主角", "女主角", "男主", "女主", "主角", "演员", "电影", "影片", "电视剧", "剧集", "剧",
  "科幻", "悬疑", "惊悚", "破案", "刑侦", "警匪", "警匪片", "国产", "香港", "中国", "美国", "英国",
  "现代", "古装", "场景", "剧情", "情节", "故事",
  "破案剧", "刑侦剧", "悬疑剧", "警匪剧", "类型片", "男主", "女主", "双男主", "双女主",
  "结局", "结局场景", "两个主角", "主角设定", "男一号", "女一号", "演员表", "卡司",
  // 泛化剧情词：几乎每部作品都写得出来，不能当作「区分作品的核心情节」。
  "动画", "动画片", "影片", "男孩", "女孩", "爸爸", "妈妈", "父亲", "母亲", "朋友",
  "成为", "变成", "故事", "最后", "后来", "开始", "遇到", "生活", "地方", "事情", "时间",
  "一对", "船上", "男人", "女人", "一段", "男女", "两人", "二人",
]);

/** 排他性/绝对化表述：一辈子、从未、唯一、直到……这类描述辨识度极高。 */
const EXCLUSIVE_PHRASE =
  /(一辈子|一生都|一生|从未|从来没|从不|始终|再也|再也没有|唯一|唯有|只有他|只有她|只有它|直到|永远|总之就是)/;

/** 具体情节词：这些词一出现，线索就把候选区分开了。 */
const PLOT_TERMS =
  /(爆炸|炸弹|拆弹|循环|穿越|重生|卧底|天台|对决|复仇|谋杀|凶杀|失踪|绑架|越狱|监狱|法庭|审判|医院|校园|丧尸|外星|机器人|人工智能|时间倒流|失忆|双胞胎|火灾|地震|海难|空难|列车|火车|飞机|潜艇|沙漠|荒岛|雪山|赛车|拳击|足球|比赛|赌场|黑帮|法医|侦探|律师|医生|刑警|警察|教师|学生|歌手|舞蹈|档案|密码|密室)/;

/**
 * 决定性线索：带数字时长，或带具体情节词，才算能把候选区分开。
 * 题材（科幻/悬疑）、地区（国产/香港）、泛身份（男主角）都不算。
 */
export function isDecisiveClue(clue: ClueItem, question = ""): boolean {
  const text = `${clue.text} ${(clue.terms || []).join(" ")}`;
  // 用户在问题里点名的人名/角色名（「男主叫张东升」）本身就是决定性线索。
  if (question && (clue.terms || []).some((term) => term.length >= 2 && new RegExp(`(叫|名叫|叫做|名字叫)\\s*${term}`).test(question)))
    return true;
  if (/\d|([一二三四五六七八九十百千两]+)\s*(分钟|小时|次|天|年|层|万个|万辆|万|亿)/.test(text)) return true;
  if (PLOT_TERMS.test(text)) return true;
  // 排他性/绝对化表述：这类描述几乎只对应唯一对象（「一辈子没离开过船」），
  // 泛线索（科幻/国产/男主角）不含这种词，因此仍不会被当成决定性依据。
  if (EXCLUSIVE_PHRASE.test(text)) return true;
  // 用户记得足够具体（≥8 字的实词描述）时，这条线索本身就有区分度。
  const concrete = (clue.terms || []).filter(
    (term) => term.length >= 2 && !GENERIC_CLUE_TERMS.has(term),
  );
  if (clue.text.replace(/\s/g, "").length >= 8 && concrete.length > 0) return true;
  return (
    clue.kind === "subject" &&
    (clue.terms || []).some((term) => term.length >= 2 && !GENERIC_CLUE_TERMS.has(term))
  );
}

/**
 * 这句话到底在讲谁？
 *  - subject：候选名就是句子的主语（书名号里的第一个片名，或句首）
 *  - listed：候选只是被列举出来的片名之一（《A》《B》《C》等）
 *  - comparison：句子主语是别的候选，本候选只是被拿来对比
 *  - unclear：判断不了
 */
export function attributeSentence(sentence: string, name: string, others: string[] = []): {
  attribution: "subject" | "listed" | "comparison" | "unclear";
  subject: string;
} {
  const quoted = [...sentence.matchAll(/《([^》]{2,24})》/g)].map((match) => match[1].trim());
  const key = normalized(name);
  const firstQuoted = quoted[0];
  const inSentence = normalized(sentence).includes(key);
  if (!inSentence) return { attribution: "unclear", subject: firstQuoted || "" };

  const listLike =
    quoted.length >= 2 &&
    /》\s*[、和及与]\s*《/.test(sentence) &&
    /(等|影子|借鉴|类似|相比|系列|盘点|十大|推荐|片单)/.test(sentence);
  const isFirst = firstQuoted ? normalized(firstQuoted) === key : sentence.trimStart().startsWith(name);
  if (listLike) {
    // 列举句里只有「第一个被提到的片名 + 随后讲述剧情」才算它的证据。
    const narrative = /(讲述|讲述的是|剧情|故事梗概|主角是|男主是)/.test(sentence);
    if (!(isFirst && narrative)) return { attribution: "listed", subject: firstQuoted || "" };
  }
  if (firstQuoted && normalized(firstQuoted) !== key) {
    const mentionsOther = others.some((other) => normalized(other) === normalized(firstQuoted));
    if (mentionsOther) return { attribution: "comparison", subject: firstQuoted };
  }
  return isFirst ? { attribution: "subject", subject: name } : { attribution: "unclear", subject: firstQuoted || "" };
}

/** 候选名与线索词要在同一小段里，避免「整段提到多处」被当成一条证据。 */
function nearClue(sentence: string, name: string, terms: string[]): boolean {
  const flat = normalized(sentence);
  const at = flat.indexOf(normalized(name));
  if (at < 0) return false;
  return terms.some((term) => {
    const value = normalized(term);
    if (!value) return false;
    return [...flat.matchAll(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))].some(
      (match) => Math.abs((match.index || 0) - at) <= 60,
    );
  });
}

/**
 * 用户在问题里「点名」的人物类线索（主演/演员/主角叫什么）。
 *
 * 只有这种线索才允许被判「与资料冲突」：说错主演是最常见的记忆错误，
 * 而「剧情/场景」类线索没有客观名单可以对照，不能凭一句没命中就说用户记错。
 */
const PERSON_FRAME =
  /(主演|演员|领衔|出演|演的|由[^，。；]{0,8}主演|男主演|女主演|男主(?:角)?(?:叫|是)|女主(?:角)?(?:叫|是)|主角(?:好像|像是|是|叫)?)/;

export function personClueTexts(question: string, clues: ClueItem[]): Set<string> {
  const found = new Set<string>();
  if (!question) return found;
  for (const clue of clues) {
    for (const term of clue.terms.length ? clue.terms : [clue.text]) {
      if (term.length < 2) continue;
      const at = question.indexOf(term);
      if (at < 0) continue;
      // 只看紧贴在人名前面的那几个字：「主演是X」「由X主演」「主角好像是X」。
      // 放宽成「前面 12 字里出现过主演」会把「主演A，剧情讲密码」里的「密码」也算成人名。
      // 人名必须长得像人名：纯中文（可含·）、2-6 字、不含数字或量词。
      if (!/^[\u4e00-\u9fa5·]{2,6}$/.test(term)) continue;
      if (/(年|月|日|部|集|次|个|时间|时候|上映|左右)/.test(term)) continue;
      const prefix = question.slice(Math.max(0, at - 10), at);
      const suffix = question.slice(at + term.length, at + term.length + 4);
      // 只认明确的「谁演的/谁主演」句式；裸的「男主角」后面跟任何词都不是人名。
      const framed =
        /(主演是|主演为|演员是|演员表有|由|饰演|扮演|主角是|主角叫|男主角是|女主角是|男主是|女主是|叫做|名叫)\s*$/.test(prefix) ||
        // 「主演好像是X」「主角似乎是X」同样是明确的人名位，不能漏。
        /(?:主演|主角|男主|女主)(?:好像|似乎|大概|貌似|可能)?(?:是|为)?\s*$/.test(prefix) ||
        /^(主演|演的|出演|饰演|饰)/.test(suffix);
      if (framed) {
        found.add(clue.text);
        break;
      }
    }
  }
  return found;
}

/** 演员表/主演名单类句子：用它来判断「用户说的人是不是真的演了这部」。 */
const CAST_SENTENCE = /(主演|领衔主演|演员表|演员阵容|出演|由[^。；]{0,20}主演)/;

/** 把一个候选与线索逐条比对：同句优先，退一步到同段落共现，都保留原句。 */
export function matchCandidate(
  candidate: Candidate,
  clues: ClueItem[],
  pages: PageLike[],
  bodies: Map<string, BodyLike>,
  otherNames: string[] = [],
  question = "",
  personTexts: Set<string> = new Set(),
): Candidate {
  const matches: CandidateMatch[] = [];
  const others = otherNames.filter((name) => normalized(name) !== normalized(candidate.name));
  for (const clue of clues) {
    // 用户点名的人物（主演/演员）就是身份线索：作品对不上这个人，就不能算「完全符合」。
    const decisive = isDecisiveClue(clue, question) || personTexts.has(clue.text);
    let hit: CandidateMatch | null = null;
    /** 只提到候选名、但证据不属于它的句子，留作「间接关联」备查。 */
    let indirect: CandidateMatch | null = null;
    const hasTerm = (value: string) => clue.terms.some((term) => normalized(value).includes(normalized(term)));

    for (const page of pages) {
      if (!page.url) continue;
      const body = bodies.get(page.id);
      const blocks: { from: "body" | "excerpt"; text: string }[] = [
        ...(body?.ok ? [{ from: "body" as const, text: body.text.slice(0, 20_000) }] : []),
        { from: "excerpt" as const, text: [page.title, page.passage].join("\n") },
      ];
      for (const block of blocks) {
        for (const sentence of block.text.split(/(?<=[。！？!?\n])/).map((item) => item.trim()).filter(Boolean)) {
          if (!normalized(sentence).includes(normalized(candidate.name)) || !hasTerm(sentence)) continue;
          // 关键：先判断这句话到底在讲谁，再决定算不算证据。
          const { attribution, subject } = attributeSentence(sentence, candidate.name, others);
          const base = {
            clueId: clue.id,
            clue: clue.text,
            sentence: snippetAround(sentence, candidate.name),
            url: page.url,
            site: page.site,
            title: page.title,
            from: block.from,
            decisive,
          };
          if (attribution === "subject" && nearClue(sentence, candidate.name, clue.terms)) {
            hit = { ...base, found: true, scope: "sentence", relation: "direct", subject: candidate.name };
            break;
          }
          if (!indirect && (attribution === "subject" || attribution === "unclear")) {
            indirect = { ...base, found: false, scope: "sentence", relation: "indirect", subject: subject || candidate.name };
          }
        }
        if (hit) break;
      }
      if (hit) break;
    }
    // 人物线索没有命中时，先看资料里的主演名单：名单里没有这个人，就是有据可查的冲突，
    // 不是「没查到」。原文句子一起存下来，页面上要能点开核对。
    let conflict: CandidateMatch | null = null;
    if (!hit && personTexts.has(clue.text)) {
      for (const page of pages) {
        if (!page.url) continue;
        const body = bodies.get(page.id);
        const blocks: { from: "body" | "excerpt"; text: string }[] = [
          ...(body?.ok ? [{ from: "body" as const, text: body.text.slice(0, 20_000) }] : []),
          { from: "excerpt" as const, text: [page.title, page.passage].join("\n") },
        ];
        for (const block of blocks) {
          for (const sentence of block.text.split(/(?<=[。！？!?\n])/).map((item) => item.trim()).filter(Boolean)) {
            if (!CAST_SENTENCE.test(sentence)) continue;
            if (!normalized(sentence).includes(normalized(candidate.name))) continue;
            if (hasTerm(sentence)) continue;
            const { attribution } = attributeSentence(sentence, candidate.name, others);
            if (attribution !== "subject" && attribution !== "unclear") continue;
            // 冲突证据要能直接看出「主演是谁」：截取主演关键词附近的窗口，
            // 而不是整段网页信息栏。
            const castAt = sentence.search(CAST_SENTENCE);
            const castSnippet =
              castAt >= 0
                ? `${castAt > 20 ? "…" : ""}${sentence.slice(Math.max(0, castAt - 20), castAt + 80).trim()}${castAt + 80 < sentence.length ? "…" : ""}`
                : snippetAround(sentence, candidate.name);
            const explicitDenial = /(并非|不是|未出演|没有出演|并没有|并非由)/.test(sentence);
            conflict = {
              clueId: clue.id,
              clue: clue.text,
              found: false,
              conflictStrength: explicitDenial ? "explicit" : "absent",
              sentence: castSnippet,
              url: page.url,
              site: page.site,
              title: page.title,
              from: block.from,
              scope: "sentence",
              relation: "conflicts",
              subject: candidate.name,
              decisive: true,
            };
            break;
          }
          if (conflict) break;
        }
        if (conflict) break;
      }
    }
    matches.push(
      hit ||
        conflict ||
        indirect || {
          clueId: clue.id,
          clue: clue.text,
          found: false,
          sentence: "",
          url: candidate.pages[0]?.url || "",
          site: "",
          title: "",
          from: "excerpt" as const,
          scope: "sentence" as const,
          relation: "unverified" as const,
          subject: "",
          decisive,
        },
    );
  }
  const matchedClues = matches.filter((item) => item.found).length;
  const conflictMatches = matches.filter((item) => item.relation === "conflicts");
  const missingClues = matches.filter((item) => !item.found && item.relation !== "conflicts").map((item) => item.clue);
  // 命中线索最重要；标题里被直接指认、以及被多个不同来源提到，作为区分依据（不是排序玄学）。
  const score = matchedClues * 10 + Math.min(candidate.titleHits, 5) * 2 + Math.min(candidate.sites, 6);
  // 冲突线索不再当作「没查到的缺口」，它已经是查清楚了的：资料和用户说法不一致。
  return {
    ...candidate,
    matches,
    matchedClues,
    missingClues,
    conflicts: conflictMatches.length,
    conflictClues: conflictMatches.map((item) => item.clue),
    score: score - conflictMatches.length * 6,
  };
}

/** 汇总所有候选，并给出「继续查 / 问用户 / 结束」的判断。 */
export function evaluateCandidates(
  raw: Candidate[],
  clues: ClueItem[],
  pages: PageLike[],
  bodies: Map<string, BodyLike>,
  targetKind: EntityKind = "unknown",
  question = "",
): {
  candidates: Candidate[];
  relations: Candidate[];
  graph: DirectedRelation[];
  pending: PendingQuestion[];
  decision: ClueDecision;
} {
  // 先抽有向关系（谁改编自谁、谁是谁的续集/翻拍/别名），再由关系决定候选在竞争里的身份。
  const graph = extractRelations(pages, bodies, raw.map((item) => item.name));
  const personTexts = personClueTexts(question, clues);
  const classified = raw.map((candidate) => {
    const byRelation = relationRoleOf(candidate.name, graph);
    const heuristic = classifyEntity(candidate.name, pages, bodies);
    // 如果关系图已经说明它是「被改编/被翻拍的原作」，那它本身就是一部作品，
    // 不能因为某页信息框写了「别名」就把它并掉。
    const isOriginalWork = graph.some(
      (relation) =>
        relation.status === "confirmed" &&
        (relation.relation === "adaptation" || relation.relation === "remake") &&
        normalized(relation.object) === normalized(candidate.name),
    );
    const entity =
      byRelation.role === "work"
        ? isOriginalWork && heuristic.role === "alias"
          ? { ...heuristic, role: "competitor" as const, reason: "关系图显示它是被改编/被翻拍的原作，本身就是一部作品" }
          : heuristic
        : {
            kind: byRelation.role === "alias" || byRelation.role === "sequel" || byRelation.role === "remake"
              ? ("screen_work" as const)
              : byRelation.role === "source"
                ? ("book" as const)
                : heuristic.kind,
            role: byRelation.role === "source"
              ? ("source" as const)
              : byRelation.role === "alias"
                ? ("alias" as const)
                : byRelation.role === "sequel"
                  ? ("sequel" as const)
                  : byRelation.role === "remake"
                    ? ("remake" as const)
                    : heuristic.role,
            reason: byRelation.relation?.reason || heuristic.reason,
            sentence: byRelation.relation?.evidence[0]?.quote || heuristic.sentence,
            url: byRelation.relation?.evidence[0]?.url || heuristic.url,
            site: byRelation.relation?.evidence[0]?.site || heuristic.site,
          };
    return matchCandidate({ ...candidate, entity }, clues, pages, bodies, raw.map((item) => item.name), question, personTexts);
  });
  const relations = classified.filter((item) => isRelation(item, targetKind));
  // 第二阶段：把「作品类型」纳入比较。用户说电影时，电视剧不能仅凭主题词相近就排第一；
  // 但允许它留在候选里，只标注这处矛盾，不直接抹掉。
  const userType = workTypeOf(question);
  const typeCompatible = (a: WorkType, b: WorkType) =>
    a === b ||
    a === "other" ||
    b === "other" ||
    (a === "anime" && (b === "film" || b === "tv")) ||
    (b === "anime" && (a === "film" || a === "tv"));
  for (const item of classified) {
    const candidateType = (item.type || "other") as WorkType;
    if (userType === "other" || candidateType === "other") continue;
    const types = (item.types || [candidateType]) as WorkType[];
    // 一部作品可以同时是小说与电影（改编）；只要有一种类型对得上，就以对得上的那个为准，
    // 不再算类型矛盾（否则《解密》会一直被标成「小说」）。
    const compatibleType = types.find((type) => type !== "other" && typeCompatible(userType, type));
    if (compatibleType) {
      item.type = compatibleType;
      continue;
    }
    item.typeConflict = true;
    item.score -= 8;
  }
  const screenQuestion = ["film", "tv", "anime"].includes(userType);
  const candidates = classified
    .filter((item) => !isRelation(item, targetKind))
    // 影视问题里，歌曲/文章/评论/来源不明的条目不能进入候选排名（仍可作为资料）。
    .filter(
      (item) =>
        !screenQuestion ||
        (item.types || [item.type || "other"]).some((type) =>
          ["film", "tv", "anime"].includes(String(type)),
        ),
    )
    // 用户已经说了「电影/电视剧」时，类型不符的候选不能只凭多命中两个泛词就排第一：
    // 类型相符优先，再比命中线索数。
    .sort(
      (a, b) =>
        Number(Boolean(a.typeConflict)) - Number(Boolean(b.typeConflict)) ||
        Number(Boolean(b.identityOk)) - Number(Boolean(a.identityOk)) ||
        b.matchedClues - a.matchedClues ||
        b.score - a.score,
    )
    // 一条线索都没对上的名字（正文里的栏目名、标语）不占候选位，避免把噪声摆到用户面前。
    .filter((item, index) => item.matchedClues > 0 || index === 0);
  const pending = planDisambiguation(
    candidates.map((item) => ({ name: item.name, matchedClues: item.matchedClues, missingClues: item.missingClues })),
    graph,
    clues.map((item) => ({ text: item.text, terms: item.terms || [] })),
  );
  if (!candidates.length)
    return {
      candidates,
      relations,
      graph,
      pending,
      decision: {
        state: "insufficient",
        headline: "这次没有从检索结果里找到可核对的候选",
        nextQueries: [],
        askUser: "能再补充一个特征吗？比如大概的上映时间、主角名字的另一个字，或你记得的一句台词。",
      },
    };

  // 头名仍按「线索命中 + 类型是否相符」排序的结果取；但要并列比较时，
  // 只和类型相符的候选比——用户说电影，就不该拿电视剧来判「并列无法区分」。
  const best = candidates[0];
  const comparableRunners = userType !== "other"
    ? candidates.slice(1).filter((item) => !item.typeConflict)
    : candidates.slice(1);
  const runnerUp = comparableRunners[0] || candidates[1];
  const total = clues.length;
  // 与资料冲突的线索：有原文依据才算，结论里必须点名说明，不能悄悄改用户的描述。
  const conflicts = (best?.matches || [])
    .filter((match) => match.relation === "conflicts")
    .map((match) => ({
      clue: match.clue,
      candidate: best.name,
      quote: match.sentence,
      url: match.url,
      site: match.site,
      from: match.from,
      strength: (match.conflictStrength || "absent") as "explicit" | "absent",
    }));
  const explicitConflicts = conflicts.filter((item) => item.strength === "explicit");
  // 只有明确的否定表述才能说「与资料不符」；名单里没出现只能说「现有资料里没有」。
  const conflictNote = explicitConflicts.length
    ? `资料明确写到「${explicitConflicts.map((item) => item.clue).join("」「")}」不成立，这里以原文为准`
    : conflicts.length
      ? `现有资料的主演名单里没有出现「${conflicts.map((item) => item.clue).join("」「")}」（这不等于他没参演）`
      : "";
  const conflictFields = conflicts.length ? { conflicts } : {};
  // 决定性线索才决定答案：题材/身份/地区这类词命中多少都不足以定案。
  const decisiveOf = (candidate: Candidate | undefined) =>
    (candidate?.matches || []).filter((match) => match.decisive);
  // 与资料冲突的线索不算「缺证据」：它已经查过，结论是资料里没有这个人/这一条。
  const decisiveMissing = decisiveOf(best)
    .filter((match) => !match.found && match.relation !== "conflicts")
    .map((match) => match.clue);
  const decisiveHit = decisiveOf(best).filter((match) => match.found).length;
  // 有区分度的剧情线索命中数（泛词不算）：判断「身份能不能确定」看的是这个。
  const concreteHit = best.matches.filter((match) => {
    if (!match.found) return false;
    const clue = clues.find((item) => item.text === match.clue);
    if (clue?.kind === "genre" || clue?.kind === "region") return false;
    // 单字具体名词（龙、猪、船）同样是区分度很高的剧情对象，不能因为只有一个字就不算数。
    return (clue?.terms || [match.clue]).some(
      (term) => term.length >= 1 && !GENERIC_CLUE_TERMS.has(term) && !/^[的了和在与及或也很就都而其之为把被]$/.test(term),
    );
  }).length;
  const runnerDecisiveMissing = runnerUp
    ? decisiveOf(runnerUp).filter((match) => !match.found).length
    : Number.POSITIVE_INFINITY;
  const tie = Boolean(
    runnerUp &&
      runnerUp.matchedClues === best.matchedClues &&
      best.score - runnerUp.score < 2 &&
      runnerDecisiveMissing === 0,
  );
  // 题材/地区这类线索常常只出现在网页别处：它们没同句命中时不算决定性缺口，但必须写进结论。
  const auxiliary = clues.filter((clue) => clue.kind === "genre" || clue.kind === "region").map((clue) => clue.text);
  const auxiliaryMissing = best.missingClues.filter((text) => auxiliary.includes(text));
  // 「重要剧情缺口」：具体（非泛词）线索在没有同句证据时，就不能说整段描述已经核实。
  // 泛词（主角/电影/悬疑这类）和题材/地区线索不在其中——它们本来就只做辅助。
  const plotMissing = best.missingClues.filter((text) => {
    if (auxiliary.includes(text)) return false;
    const clue = clues.find((item) => item.text === text);
    const terms = clue?.terms?.length ? clue.terms : [text];
    return terms.some((term) => term.length >= 2 && !GENERIC_CLUE_TERMS.has(term));
  });
  // 只有「决定性线索全部有直接证据」才算找到答案；普通线索缺一两条不影响。
  const coverage = total ? best.matchedClues / total : 0;
  const lead = best.matchedClues - (runnerUp?.matchedClues ?? 0);
  // 同一条来源同时对上多条线索时，说明这段材料整体讲的就是这件事——
  // 这是「证据组合」意义上的决定性佐证，不是靠关键词出现次数堆出来的。
  const bySource = new Map<string, Set<string>>();
  const bySourceConcrete = new Map<string, number>();
  for (const match of best.matches)
    if (match.found) {
      const key = match.url || match.site || "";
      if (!key) continue;
      const set = bySource.get(key) || new Set<string>();
      set.add(match.clue);
      bySource.set(key, set);
      // 泛线索（题材/身份/地区）不参与「同源共现」的强度认定。
      const clue = clues.find((item) => item.text === match.clue);
      const concrete = (clue?.terms || [match.clue]).some(
        (term) => term.length >= 2 && !GENERIC_CLUE_TERMS.has(term),
      );
      if (concrete) bySourceConcrete.set(key, (bySourceConcrete.get(key) || 0) + 1);
    }
  // 两条以上不同类型的线索出现在同一条来源里，已经足以说明这段材料讲的就是这件事；
  // 单条线索命中再多也只是关键词巧合，所以门槛不按次数、按线索种类。
  // 强证据 = 决定性线索命中 或 同句直接命中的具体情节；泛词只算弱证据。
  const strongMatches = best.matches.filter(
    (match) => match.found && (match.decisive || (match.scope === "sentence" && match.relation === "direct")),
  );
  const strongHits = strongMatches.length;
  // 同一句里出现三个相关词，只证明「这句话提到这三件事」，不能算三段独立剧情。
  const strongSentences = new Set(
    strongMatches.map((match) => `${match.url}::${match.sentence}`),
  ).size;
  const genericHits = best.matchedClues - strongHits;
  const coOccurrence = [...bySource.entries()].some(
    ([key, set]) => set.size >= 2 && (bySourceConcrete.get(key) || 0) >= 2,
  );
  const bestSourceCount = Math.max(0, ...[...bySource.values()].map((set) => set.size));
  // 定案要点：决定性线索全部对上，且满足下面任一条件——
  //  a) 至少两条决定性线索命中；b) 一条决定性线索 + 覆盖率过半；
  //  c) 覆盖率≥75% 且比第二名多出至少两条（排除「只是关键词出现得多」）。
  // 同源共现必须配合覆盖率：只对上「用户说的主演 + 一个泛词」不算证据组合，
  // 否则一旦用户把主演记错，错误候选反而更容易被当成答案。
  // 剧情线索命中来自多少个不同来源：只靠一篇网页的巧合不足以定案。
  const foundSources = new Set(
    best.matches.filter((match) => match.found && match.url).map((match) => match.url),
  );
  const enough =
    decisiveHit >= 2 ||
    (decisiveHit >= 1 && coverage >= 0.5) ||
    (coverage >= 0.75 && lead >= 2) ||
    (coOccurrence && coverage >= 0.5 && lead >= 1) ||
    // 剧情证据足够且领先，同时唯一「对不上」的人物线索只是资料里没出现（不是明确反证）：
    // 这种情形应当给出答案，并把那条记忆标注出来，而不是假装没有结论。
    (coverage >= 0.5 &&
      lead >= 1 &&
      foundSources.size >= 2 &&
      explicitConflicts.length === 0) ||
    // 两段以上不同句子分别印证剧情（哪怕覆盖的线索条数不到一半）
    (strongSentences >= 2 && lead >= 1 && explicitConflicts.length === 0);
  // 作品上下文与证据广度：只有一条线索命中、或名字只是被顺带提到的，不能算答案。
  // 「像一部作品」的证据：附近有作品类字样，或它本身就是标题里点到 / 书名号里的名字。
  const workSignal =
    ((best as Candidate & { workSignals?: number }).workSignals || 0) > 0 ||
    (best.titleHits || 0) > 0 ||
    best.quoted === true;
  // 一句里出现多个相关词仍然只算一段证据（V20）：一句话不能同时充当三条独立剧情。
  const breadthGate = best.matchedClues >= 2 && strongSentences >= 2;
  const typeGate = !(userType !== "other" && best.typeConflict) && workSignal && breadthGate;
  const typeConflictInfo =
    userType !== "other" && best.typeConflict
      ? {
          typeConflict: {
            userType,
            candidateType: (best.type || "other") as WorkType,
            candidate: best.name,
            note: `你说的是一部${typeLabel[userType]}，但现有资料显示《${best.name}》是${typeLabel[(best.type || "other") as WorkType]}`,
          },
        }
      : {};
  // 竞争者：同类型、同句直接命中 ≥2 条情节，且差距不超过一条——它同样能解释用户的描述。
  const directHits = (candidate: Candidate) =>
    candidate.matches.filter((match) => match.found && match.scope === "sentence").length;
  const competitor = candidates
    .slice(1)
    .filter((candidate) => (userType === "other" || ["film", "tv", "anime"].includes(String(candidate.type))))
    .find((candidate) => directHits(candidate) >= 2 && best.matchedClues - candidate.matchedClues <= 1);
  const comparison = competitor
    ? [best, competitor].map((candidate) => ({
        name: candidate.name,
        matched: candidate.matches.filter((match) => match.found).map((match) => match.clue),
        missing: candidate.missingClues,
        type: typeLabel[(candidate.type || "other") as WorkType],
        note:
          directHits(candidate) >= 2
            ? `同句直接命中 ${directHits(candidate)} 条情节`
            : `只命中 ${directHits(candidate)} 条情节`,
      }))
    : undefined;
  const userYears = [...new Set(question.match(/(19|20)\d{2}/g) || [])];
  const identityYears = (best.identity?.years || []).map((item) => ({
    year: item.value,
    quote: item.quote,
    url: item.url,
    site: item.site,
  }));
  const years = identityYears.length ? identityYears : releaseYears(best.name, pages, bodies);
  const yearCheck =
    userYears.length && best
      ? {
          userYears,
          candidateYears: years.map((item) => ({
            year: item.year,
            quote: item.quote,
            url: item.url,
            site: item.site,
          })),
          note: years.length
            ? years.some((item) => userYears.includes(item.year))
              ? `资料里《${best.name}》的年份包含你说过的 ${userYears.join("、")}，年份不矛盾`
              : `资料里《${best.name}》是 ${years.map((item) => item.year).join(" / ")} 年上映或首播，与你说过的 ${userYears.join("、")} 不同（可能是你看的时间，也可能是记错了）`
            : "现有资料没有写清这部作品的年份，不能据此说年份记错",
        }
      : undefined;

  // 「解释得足够全」：有区分度的情节覆盖过半，或至少两条决定性线索命中。
  // 用「具体线索」而不是「全部线索」算覆盖率：线索拆得越细，泛词越多，
  // 用总条数算会把已经答对的案子压在 0.6 以下。
  const concreteTotal = clues.filter((clue) => {
    if (clue.kind === "genre" || clue.kind === "region") return false;
    return (clue.terms || [clue.text]).some(
      (term) => term.length >= 1 && !GENERIC_CLUE_TERMS.has(term) && !/^[的了和在与及或也很就都而其之为把被]$/.test(term),
    );
  }).length;
  const concreteCoverage = concreteTotal ? concreteHit / concreteTotal : 0;
  const explainsEnough = concreteCoverage >= 0.6 || coverage >= 0.6 || decisiveHit >= 2;
  // 两条判断分开：
  //  ① 作品身份：有区分度的核心情节对上 ≥2 条，且没有合理竞争者 → 可以给答案；
  //  ② 用户每条记忆：核到哪些、哪些还没核到（unverified）、哪些与资料不符（conflicts）。
  // 不能因为「动画」「主角」这类泛词缺同句证据就卡住回答，也不能把两条关键词共现当成完整剧情。
  const identityEnough =
    !decisiveMissing.length &&
    (decisiveHit > 0 || coOccurrence || concreteHit >= 2) &&
    enough &&
    explainsEnough &&
    !tie &&
    typeGate &&
    !competitor;
  if (identityEnough)
    return {
      candidates,
      relations,
      graph,
      pending,
      decision: {
        state: "found",
        ...conflictFields,
        ...(yearCheck ? { yearCheck } : {}),
        decisiveClues: clues.filter((clue) => isDecisiveClue(clue, question)).map((clue) => clue.text),
        // 身份已经能确定，但没核到的具体情节要单独列出来，不能默认都成立。
        ...(plotMissing.length ? { unverified: plotMissing } : {}),
        headline: plotMissing.length
          ? `答案基本可以确定：${best.name}；还有 ${plotMissing.length} 条情节没在资料里核到${conflictNote ? `；${conflictNote}` : ""}`
          : `你说的剧情线索都在资料里找到了：${best.name}${conflictNote ? `；${conflictNote}` : ""}`,
        nextQueries: [],
        askUser: null,
        ...(auxiliaryMissing.length ? { auxiliaryClues: auxiliaryMissing } : {}),
      },
    };

  const missingTerms = [...new Set(best.missingClues.flatMap((text) => {
    const clue = clues.find((item) => item.text === text);
    return clue ? clue.terms : [text];
  }))].slice(0, 3);

  // 有强证据但还没解释到足够多情节：给「最可能答案」，把差异和待查点摊开，
  // 不为了得到 found 而降低标准。
  if (!explainsEnough && strongSentences >= 2 && !best.typeConflict) {
    const rivals = candidates
      .slice(1, 3)
      .filter(
        (candidate) =>
          directHits(candidate) >= 2 &&
          // 影视问题里不拿小说/来源不明条目当「需要排除的竞争作品」
          (userType === "other" || ["film", "tv", "anime"].includes(String(candidate.type))),
      )
      .map((candidate) => ({
        name: candidate.name,
        matched: candidate.matches.filter((match) => match.found).map((match) => match.clue),
        missing: candidate.missingClues,
        type: typeLabel[(candidate.type || "other") as WorkType],
        note: `同句直接命中 ${directHits(candidate)} 条情节`,
      }));
    return {
      candidates,
      relations,
      graph,
      pending,
      decision: {
        state: "ambiguous",
        ...conflictFields,
        ...(yearCheck ? { yearCheck } : {}),
        bestGuess: best.name,
        ...(rivals.length ? { comparison: [best, candidates.find((c) => c.name === rivals[0].name)!].map((candidate) => ({
          name: candidate.name,
          matched: candidate.matches.filter((match) => match.found).map((match) => match.clue),
          missing: candidate.missingClues,
          type: typeLabel[(candidate.type || "other") as WorkType],
          note: `同句直接命中 ${directHits(candidate)} 条情节`,
        })) } : {}),
        decisiveClues: clues.filter((clue) => isDecisiveClue(clue, question)).map((clue) => clue.text),
        headline: `最可能是「${best.name}」，但还有 ${best.missingClues.length} 条情节没在资料里核到${rivals.length ? `；「${rivals[0].name}」也需要排除` : ""}`,
        nextQueries: best.missingClues.slice(0, 2).map((clue) => ({
          query: `${best.name} ${clue}`.trim(),
          reason: `核对《${best.name}》是否真的包含「${clue}」`,
        })),
        askUser: `还记得《${best.name}》里更具体的一幕吗？比如主角做过什么、发生在哪里。`,
      },
    };
  }

  if (competitor) {
    return {
      candidates,
      relations,
      graph,
      pending,
      decision: {
        state: "ambiguous",
        ...conflictFields,
        ...typeConflictInfo,
        ...(comparison ? { comparison } : {}),
        ...(yearCheck ? { yearCheck } : {}),
        bestGuess: best.name,
        decisiveClues: clues.filter((clue) => isDecisiveClue(clue, question)).map((clue) => clue.text),
        headline: `两个候选都能解释你的描述：「${best.name}」与「${competitor.name}」；还缺一条能区分它们的情节`,
        nextQueries: [best, competitor].map((candidate) => ({
          query: `${candidate.name} ${candidate.missingClues[0] || "剧情"}`.trim(),
          reason: `核对《${candidate.name}》能否解释「${candidate.missingClues[0] || "剩余情节"}」`,
        })),
        askUser: `还记得这两部作品里哪一部的具体场景吗？比如「${best.name}」或「${competitor.name}」里主角做过的事。`,
      },
    };
  }

  if (tie || (runnerUp && best.matchedClues - runnerUp.matchedClues <= 0)) {
    const nextQueries = candidates.slice(0, 2).map((candidate) => ({
      query: [candidate.name, ...missingTerms.slice(0, 2)].join(" ").trim(),
      reason: `${candidate.name} 还缺「${(candidate.missingClues[0] || "关键线索").slice(0, 20)}」，查它能否补上`,
    }));
    const askClue = best.missingClues[0] || runnerUp?.missingClues[0] || "";
    return {
      candidates,
      relations,
      graph,
      pending,
      decision: {
        state: "ambiguous",
        ...conflictFields,
        ...typeConflictInfo,
        decisiveClues: clues.filter((clue) => isDecisiveClue(clue, question)).map((clue) => clue.text),
        headline: `找到 ${candidates.length} 个可能候选，还差一条能区分的线索`,
        nextQueries,
        askUser: askClue
          ? `目前有两个比较接近的作品，你还记得「${askClue.slice(0, 24)}」相关的细节吗？`
          : "还记得别的细节吗？比如主角名字、播出年份，或一句台词。",
      },
    };
  }

  // 单句强匹配：同一句里同时出现多条具体剧情关系（「她掉进兔子洞，遇到会说话的猫和疯帽子」），
  // 足以说明「这部作品很可能就是它」，但这一句只算一份材料——
  // 可以给最可能答案，不能当成多条独立证据，也不能据此说情节都已核实。
  const concretePerSentence = new Map<string, number>();
  for (const match of strongMatches) {
    const clue = clues.find((item) => item.text === match.clue);
    if (clue?.kind === "genre" || clue?.kind === "region") continue;
    const concrete = (clue?.terms || [match.clue]).some(
      (term) => term.length >= 1 && !GENERIC_CLUE_TERMS.has(term) && !/^[的了和在与及或也很就都而其之为把被]$/.test(term),
    );
    if (!concrete) continue;
    const key = `${match.url}::${match.sentence}`;
    concretePerSentence.set(key, (concretePerSentence.get(key) || 0) + 1);
  }
  const strongestSentence = Math.max(0, ...concretePerSentence.values());
  const singleSourceLikely =
    strongestSentence >= 3 &&
    concreteHit >= 3 &&
    lead >= 2 &&
    !competitor &&
    !tie &&
    workSignal &&
    !(userType !== "other" && best.typeConflict);
  if (singleSourceLikely) {
    const pendingClues = best.missingClues.slice(0, 3);
    return {
      candidates,
      relations,
      graph,
      pending,
      decision: {
        state: "ambiguous",
        ...conflictFields,
        ...typeConflictInfo,
        ...(yearCheck ? { yearCheck } : {}),
        bestGuess: best.name,
        decisiveClues: clues.filter((clue) => isDecisiveClue(clue, question)).map((clue) => clue.text),
        evidenceLimit: `${strongestSentence} 条具体情节都出自同一段材料，只能算一份证据，不能当成多条独立来源`,
        headline: `最可能是《${best.name}》：同一段资料里对上了 ${concreteHit} 条具体情节，但这段材料只有一份${pendingClues.length ? `，还有 ${pendingClues.length} 条情节没核到` : ""}${conflictNote ? `；${conflictNote}` : ""}`,
        nextQueries: pendingClues.map((clue) => ({
          query: `${best.name} ${clue}`.trim(),
          reason: `核对《${best.name}》是否真的包含「${clue}」，把单份证据变成两份`,
        })),
        askUser: `还记得《${best.name}》里另一处具体场景吗？比如主角之外的人、地点或结局。`,
      },
    };
  }

  const nextQueries = missingTerms.length
    ? [{ query: [best.name, ...missingTerms].join(" "), reason: `${best.name} 还有线索没核实` }]
    : [];
  return {
    candidates,
    relations,
    graph,
    pending,
    decision: {
      // 能否定案只取决于上面的“决定性直接证据 + 覆盖率 + 排除竞争者”条件。
      // 检索式耗尽不能反过来证明答案成立，特别是只有“科幻/悬疑”之类泛线索时。
      state: "insufficient",
      ...conflictFields,
      ...typeConflictInfo,
      // 不能定案时也要把「最可能的是哪一个」摆出来，并配合已确认/待确认一起看：
      // 只写一句「证据不足」会让用户不知道系统到底查到哪一步。
      // 只有在「至少一条决定性线索真的对上」时才敢说「最可能的答案是它」。
      // 只靠覆盖率（动画/男孩/朋友这类泛词凑出来的）会把检索噪声当成最可能答案。
      ...(best && decisiveHit > 0 && !(userType !== "other" && best.typeConflict)
        ? { bestGuess: best.name }
        : {}),
      decisiveClues: clues.filter((clue) => isDecisiveClue(clue, question)).map((clue) => clue.text),
      headline: userType !== "other" && best.typeConflict
        ? `${typeLabel[userType]}与${typeLabel[(best.type || "other") as WorkType]}对不上：「${best.name}」是${typeLabel[(best.type || "other") as WorkType]}，暂不能按你的说法定案`
        : decisiveHit === 0
          ? `「${best.name}」有部分特征符合，但没有能够确定身份的关键证据`
          : `比较接近的是「${best.name}」，但关键证据仍不足以定案`,
      nextQueries,
      askUser: nextQueries.length
        ? null
        : "目前这些线索还不足以排除其他答案。你还记得一个具体情节、人物姓名、台词或时间吗？",
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

/**
 * 同一部作品的「同名不同版本」（原版动画 / 真人翻拍 / 续集 / 不同年份剧集）。
 *
 * 用户说「小时候看的动画片」，答案就必须落在动画版，而不是同名真人版。
 * 这里只从真实句子里抽「年份 + 形态」的组合，不推断任何没写过的东西。
 */
export interface WorkVariant {
  label: string;
  year: string;
  form: string;
  quote: string;
  url: string;
  site: string;
  from: "body" | "excerpt";
}

const FORM_WORDS =
  /(动画电影|动画片|动画|真人电影|真人版|真人|电视剧|剧集|网络剧|纪录片|舞台剧|话剧|游戏|小说|原著)/;
const YEAR_NEAR_FORM = /((?:19|20)\d{2})\s*年?[^。；;]{0,12}?(动画电影|动画片|动画|真人电影|真人版|真人|电视剧|剧集|网络剧|纪录片)/;
const FORM_NEAR_YEAR = /(动画电影|动画片|动画|真人电影|真人版|真人|电视剧|剧集|网络剧|纪录片)[^。；;]{0,12}?((?:19|20)\d{2})\s*年?/;

export function extractVariants(
  pages: PageLike[],
  bodies: Map<string, BodyLike>,
  name: string,
): WorkVariant[] {
  const key = normalized(name);
  const found = new Map<string, WorkVariant>();
  const consider = (sentence: string, page: PageLike, from: "body" | "excerpt") => {
    if (!key || !normalized(sentence).includes(key)) return;
    const hit = YEAR_NEAR_FORM.exec(sentence) || FORM_NEAR_YEAR.exec(sentence);
    if (!hit) return;
    // 一句话里出现多个年份时，年份很可能说的是别的版本（例如「根据1989年动画改编的2023年
    // 真人电影」）。这种句子不能用来给「1989 · 动画」作证，否则引文和版本对不上。
    const years = [...new Set(sentence.match(/(?:19|20)\d{2}/g) || [])];
    if (years.length > 1) return;
    // 「根据 1989 年动画改编的 2023 年真人电影」这类句子，年份说的是改编来源而不是本条，
    // 拿它给「1989 · 动画」作证会把引文和版本搞错。版本证据只认直接陈述。
    if (/根据|改编|翻拍|续集|基于|原版|致敬/.test(sentence)) return;
    // 年份与「形态」必须和作品名出现在同一小段里，避免从无关的长页面里摘出别的年份。
    const at = normalized(sentence).indexOf(key);
    const yearAt = sentence.search(/(?:19|20)\d{2}/);
    if (at < 0 || yearAt < 0) return;
    if (Math.abs(yearAt - at) > 40) return;
    const year = /^(19|20)\d{2}$/.test(hit[1]) ? hit[1] : hit[2];
    const form = /^(19|20)\d{2}$/.test(hit[1]) ? hit[2] : hit[1];
    if (!year || !form || !FORM_WORDS.test(form)) return;
    const kind = /动画/.test(form) ? "动画" : /真人/.test(form) ? "真人" : /剧集|电视剧|网络剧/.test(form) ? "剧集" : form;
    const id = `${year}-${kind}`;
    if (found.has(id)) return;
    found.set(id, {
      label: `${year} 年 · ${kind}`,
      year,
      form,
      quote: sentence.trim().slice(0, 160),
      url: page.url || "",
      site: page.site || "",
      from,
    });
  };
  for (const page of pages) {
    const body = bodies.get(page.id);
    const text = body?.ok ? String(body.text || "") : "";
    const source = text || String(page.passage || "");
    for (const sentence of source.split(/[。！？\n]/)) consider(sentence, page, text ? "body" : "excerpt");
  }
  return [...found.values()].sort((a, b) => a.year.localeCompare(b.year));
}

/**
 * 候选作品的上映/首播年份：只从「上映/首播/公映/播出」这类表述旁边取，
 * 不拿用户说的观看时间当发行时间。
 */
export function releaseYears(
  name: string,
  pages: PageLike[],
  bodies: Map<string, BodyLike>,
): { year: string; quote: string; url: string; site: string; kind: string }[] {
  const key = normalized(name);
  const found = new Map<string, { year: string; quote: string; url: string; site: string; kind: string }>();
  const PATTERN = /(?:上映|首播|公映|播出|发行|开播)[^。；]{0,12}?((?:19|20)\d{2})|((?:19|20)\d{2})\s*年[^。；]{0,8}?(?:上映|首播|公映|播出|发行)/;
  for (const page of pages) {
    const body = bodies.get(page.id);
    const text = [page.title, page.passage, body?.ok ? body.text.slice(0, 8000) : ""].join("\n");
    if (!key || !normalized(text).includes(key)) continue;
    for (const sentence of text.split(/[。！？\n]/)) {
      if (!normalized(sentence).includes(key)) continue;
      const hit = PATTERN.exec(sentence);
      if (!hit) continue;
      const year = hit[1] || hit[2];
      if (!year) continue;
      const kind = /首播|播出|开播/.test(sentence) ? "tv" : "film";
      if (found.has(year)) continue;
      found.set(year, {
        year,
        quote: sentence.trim().slice(0, 140),
        url: page.url || "",
        site: page.site || "",
        kind,
      });
    }
  }
  return [...found.values()].sort((a, b) => a.year.localeCompare(b.year));
}

/**
 * 作品身份事实：类型 / 年份 / 导演 / 主演。
 *
 * 关键约束：只接受「同一小句里点了这个名字」的陈述。
 * 一篇文章里同时提到好几部作品时，泛泛出现的「电影」「上映」不能算到当前候选头上——
 * 这正是《源代码》被误标成电视剧、年份被张冠李戴的原因。
 */
export interface IdentityFact {
  value: string;
  quote: string;
  url: string;
  site: string;
  from: "body" | "excerpt";
}

export interface WorkIdentity {
  types: IdentityFact[];
  years: IdentityFact[];
  directors: IdentityFact[];
  cast: IdentityFact[];
  /** 同一属性出现互相冲突的取值（例如既是电影又是电视剧、年份有两个） */
  conflicts: string[];
}

const CLAUSE_SPLIT = /[，,；;。！？!?\n]/;

/** 名字所在的那一小句（属性词必须落在同一小句里才算这条作品的）。 */
function clauseWith(sentence: string, name: string): string {
  const key = normalized(name);
  if (!key) return "";
  // 先按标点切成小句，再找包含名字的那一句；确保「《A》是电影，《B》是电视剧」不会串。
  let offset = 0;
  for (const clause of sentence.split(CLAUSE_SPLIT)) {
    const at = normalized(clause).indexOf(key);
    if (at >= 0) return clause;
    offset += clause.length;
  }
  return "";
}

export function identityFacts(
  name: string,
  pages: PageLike[],
  bodies: Map<string, BodyLike>,
): WorkIdentity {
  const types = new Map<string, IdentityFact>();
  const years = new Map<string, IdentityFact>();
  const directors = new Map<string, IdentityFact>();
  const cast = new Map<string, IdentityFact>();
  const push = (target: Map<string, IdentityFact>, key: string, fact: IdentityFact) => {
    if (!key.trim()) return;
    if (!target.has(key)) target.set(key, fact);
  };
  for (const page of pages) {
    const body = bodies.get(page.id);
    const blocks: { from: "body" | "excerpt"; text: string }[] = [
      ...(body?.ok ? [{ from: "body" as const, text: body.text.slice(0, 12_000) }] : []),
      { from: "excerpt" as const, text: [page.title, page.passage].join("\n") },
    ];
    for (const block of blocks) {
      for (const sentence of block.text.split(/(?<=[。！？!?\n])/).map((item) => item.trim()).filter(Boolean)) {
        if (!normalized(sentence).includes(normalized(name))) continue;
        const clause = clauseWith(sentence, name);
        if (!clause) continue;
        // 名字必须紧挨着这句陈述（同小句），并且这句确实在讲这部作品。
        const { attribution } = attributeSentence(sentence, name, []);
        if (attribution === "listed" || attribution === "comparison") continue;
        // 同一小句里出现两个以上书名号，说明这句话在并列谈论多部作品，
        // 里面的「开播」「电影」不能直接算到当前候选头上。
        const quotedInClause = [...clause.matchAll(/《([^》]{2,24})》/g)].map((match) => normalized(match[1]));
        if (quotedInClause.length >= 2) continue;
        const base = { quote: clause.trim().slice(0, 140), url: page.url || "", site: page.site || "", from: block.from };
        const typeHit = TYPE_PATTERNS.find((item) => item.pattern.test(clause));
        if (typeHit) push(types, typeHit.type, { value: typeHit.type, ...base });
        const yearHit = /((?:19|20)\d{2})\s*年?/.exec(clause);
        if (yearHit && /(上映|首播|公映|播出|发行|开播|片|剧|电影|电视剧)/.test(clause))
          push(years, yearHit[1], { value: yearHit[1], ...base });
        const directorHit = /(导演|执导)[:：]?\s*([\u4e00-\u9fa5·]{2,10})/.exec(clause);
        if (directorHit) push(directors, directorHit[2], { value: directorHit[2], ...base });
        const castHit = /主演[:：]?\s*([\u4e00-\u9fa5·]{2,10})/.exec(clause);
        if (castHit) push(cast, castHit[1], { value: castHit[1], ...base });
      }
    }
  }
  const conflicts: string[] = [];
  const typeValues = [...types.keys()].filter((type) => type !== "other");
  if (typeValues.length > 1) conflicts.push(`类型有两种说法：${typeValues.map((type) => typeLabel[type as WorkType]).join(" / ")}`);
  if (years.size > 1) conflicts.push(`年份有两种说法：${[...years.keys()].join(" / ")}`);
  return {
    types: [...types.values()],
    years: [...years.values()],
    directors: [...directors.values()],
    cast: [...cast.values()],
    conflicts,
  };
}
