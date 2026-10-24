/**
 * 线索调查的「理解用户问题」这一步。
 *
 * 模型只做检索规划：把用户的模糊描述拆成调查目标、已知线索和初始检索式。
 * 模型推测出的「答案」一律不采信——这里根本没有接收答案的字段。
 * 模型不可用时退回规则拆分，并在记录里写明本次用的是哪一种。
 */
import { modelConfiguration } from "./providers.ts";
import { detectInvestigationDomain } from "@personal/capability-sdk";
export { detectInvestigationDomain } from "@personal/capability-sdk";

export interface PlannedClue {
  text: string;
  terms: string[];
  kind: "genre" | "role" | "time" | "region" | "subject" | "other";
  uncertain?: boolean;
}

export interface CluePlan {
  goal: string;
  clues: PlannedClue[];
  queries: string[];
  source: "model" | "rule";
  model?: string;
  durationMs: number;
  /** 模型原始返回（用于复查；不含用户隐私以外的额外内容） */
  raw?: string;
  fallbackReason?: string;
}

const FILLERS = /^(我记得|以前|好像|大概|似乎|想不起|记不清|不确定|可能是|有一部|一部|我|看过|曾经|那个|一个|感觉|印象中|记得)/;
const KINDS: { pattern: RegExp; kind: PlannedClue["kind"] }[] = [
  { pattern: /法医|警察|医生|律师|教师|刑警|记者|厨师|司机/, kind: "role" },
  { pattern: /国产|中国|国内|港剧|台剧|美剧|英剧|日剧|韩剧/, kind: "region" },
  { pattern: /破案|悬疑|刑侦|侦探|科幻|古装|喜剧|爱情|战争|推理/, kind: "genre" },
  { pattern: /(19|20)\d{2}|去年|前年|小时候|高中|大学|几年前|年前/, kind: "time" },
];

const ROLE_WORDS = ["法医", "警察", "医生", "律师", "教师", "刑警", "记者", "厨师", "司机"];

/** 这些词区分不了任何候选：留在线索里只会让「还没核实」永远消不掉。 */
const GENERIC_TERMS = new Set([
  "以前", "老剧", "好像", "大概", "记得", "印象", "一部", "看过", "电视剧", "剧", "片子",
  "想不起", "不记得", "可能", "男主", "女主", "主角", "有人", "名字", "名字了", "剧名",
  "国产剧", "国内", "多年前", "小时候", "最近", "情节", "大概记得",
  "早年", "较早", "早年观看", "年份", "观看", "那时候", "那会儿", "很早", "小时候看的",
]);

/** 时间类线索只有模糊词时无法核对（「较早年份观看」对不上任何候选）。 */
const VAGUE_TIME = /^(早年|较早|很早|多年前|小时候|最近|近期|那会儿|那时候|很久|以前|年份|观看|看的)$/;

/**
 * 检索词扩展：网页里很少逐字写「国产电视剧」，但会写「国产」。
 * 因此每条线索同时保留原词、去后缀词与分词结果，命中任一即可。
 */
export function expandTerms(terms: string[]): string[] {
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (!term) continue;
    out.push(term);
    for (const part of term.split(/[\s，、/]+/)) if (part.length >= 2) out.push(part);
    const stripped = term.replace(/(电视剧|网剧|连续剧|剧)$/, "");
    if (stripped.length >= 2 && stripped !== term) out.push(stripped);
  }
  return [...new Set(out)].slice(0, 5);
}


/**
 * 规则退化路径：中文长句按词边界切分，同时保留完整数值/时长。
 * 去掉“每20字一刀”的逻辑；用户说“天台对决”，网页写“天台上的对决”也能分开核验。
 * 规则只生成调查线索，不生成事实或猜测的答案。
 */
const INVESTIGATION_FILLERS = new Set([
  ...GENERIC_TERMS,
  "记得", "忘记", "忘了", "以前", "好像", "大概", "似乎", "其中", "后来",
  "可以", "帮我", "请问", "什么", "哪个", "哪些", "名字", "一部", "这个", "那个",
  "里面", "最后", "可能", "其实", "自己", "一直", "每次", "只有", "重复", "进行",
  "知道", "查找", "调查", "怎么", "为什么", "是不是", "有没有", "是否", "在哪",
  "电影", "影视", "电视", "作品", "找到", "描述", "情节", "事件", "事情",
  "片名", "之前", "发生", "发生了", "好像是", "个人", "了一", "名字了", "分钟", "小时", "哪部", "男主角", "女主角",
  // 分词残留：用户写「记不起片名」时会被切成「不起」，这种串进检索式只会拉低召回。
  "不起", "记不起", "想不起", "记不清", "不知道怎么", "不知道", "不能", "不会", "不了", "不肯", "不在", "不是",
  "一部电影", "一部电视剧", "一部动画片", "一部片子", "好像是部", "记得是", "我也", "都记", "记不",
  // 时间量词没有具体年份时区分不了任何对象
  "一年", "两年", "三年", "那年", "哪年", "哪一年", "年份", "时候看",
  // 用户的口头意图词
  "我想", "想知道", "想找", "想查", "帮我找", "帮我查", "告诉我", "想知道是", "知道是",
  // 功能词/动词碎片：单独出现时不指向任何对象
  "为了", "换了", "换成", "变得", "拍了", "拍过", "还拍", "说过", "问了", "就是", "而且", "然后",
]);

/**
 * 低区分度词：量词、时间虚词、泛化名词。
 * 它们出现在网页里几乎必然（「一艘船」「那时候」），留着只会让候选永远差一条、
 * 还会把补查检索式污染成「候选名 时候」这种搜不出东西的查询。
 */
const LOW_SIGNAL = new Set([
  "时候", "当时", "那时", "这之后", "之前", "之后", "期间", "当年", "最近", "近期",
  "一个", "一艘", "一部", "一辆", "一架", "一座", "一条", "一位", "一名", "一只", "一间",
  "这种", "那种", "这个", "那个", "这位", "那位", "这些", "那些", "有些",
  "情况", "东西", "内容", "方面", "样子", "事情", "问题", "地方", "时候了",
  "然后", "后来", "最后", "一直", "反复", "每次", "自己", "感觉", "觉得",
]);

export /** 单字名词后缀：与前面的词紧邻时通常是同一个专名（美人+鱼、西游+记）。 */
const NOUN_SUFFIX = new Set(
  "鱼王记传纪片剧岛城国船车侠龙猫狗马鹰狼蛇鸟塔桥河山湖海港站校园厂店馆院楼营军队团社报网歌曲画书戏局堂门族星神魔怪仙佛僧".split(""),
);

export function lowSignal(term: string) {
  if (LOW_SIGNAL.has(term)) return true;
  // 纯否定/可能补语碎片（不起/不了/不肯）单独出现时不构成线索
  if (/^(不|没|别|未)[起得了会能肯在是的]$/.test(term)) return true;
  // 「一艘/那位/这种」这类指示词 + 量词开头的词没有区分度
  if (/^(这|那|某|一)[艘部辆架座条位名只间个种些]/.test(term)) return true;
  return false;
}

function clueTokens(question: string): string[] {
  const seg = new Intl.Segmenter("zh", { granularity: "word" });
  const cleaned = question.replace(/[？?！!。，,、；;：:\n]/g, " ").replace(FILLERS, "").trim();
  // 数字与时间单位必须完整保留，分词器可能把“八”和“分钟”拆开。
  // 只有「数字 + 单位」才算可核对的时间/数量；「一年」「两年」这种没有具体数值的说法
  // 区分不了任何对象，反而会被当成决定性线索而卡住结论。
  const durations = [...cleaned.matchAll(/(?:\d+|[一二三四五六七八九十百两]+)\s*(?:分钟|小时|年|个月|天|次|公里|米)/g)]
    .map((match) => match[0].replace(/\s+/g, ""))
    .filter((value) => /^\d/.test(value) || value.length >= 3)
    .filter((value) => !INVESTIGATION_FILLERS.has(value) && !lowSignal(value));
  const parts = [...seg.segment(cleaned)].filter((part) => part.isWordLike);
  const words = parts
    .map((part) => part.segment.trim())
    .filter((term) => term.length >= 2 && term.length <= 20)
    .filter((term) => !INVESTIGATION_FILLERS.has(term) && !VAGUE_TIME.test(term))
    .filter((term) => !lowSignal(term))
    .filter((term) => /[\p{L}\p{N}]/u.test(term));
  // 分词器会把专名切碎（「美人鱼」→「美人」+「鱼」）：只在「单字名词后缀」紧邻时合并，
  // 避免把「爱情 用」「声音 换」这类跨词组片段当成线索。
  const merged: string[] = [];
  for (let index = 0; index < parts.length - 1; index++) {
    const left = parts[index].segment.trim();
    const right = parts[index + 1].segment.trim();
    if (!left || right.length !== 1) continue;
    if (!NOUN_SUFFIX.has(right)) continue;
    const combined = left + right;
    if (combined.length < 3 || combined.length > 8) continue;
    if (!cleaned.includes(combined)) continue;
    if (INVESTIGATION_FILLERS.has(combined) || lowSignal(combined)) continue;
    merged.push(combined);
  }
  // 子串去重：「美人鱼」已经在线索里时，「美人」不再单列（它区分不了任何东西）。
  const ordered = [...new Set([...durations, ...merged, ...words])];
  const kept = ordered.filter(
    (term) =>
      !ordered.some(
        (other) => other !== term && other.length > term.length && other.includes(term),
      ),
  );
  return kept.slice(0, 16);
}

/** 模型未授权或不可用时，仍能从陌生中文句子生成可核验的短线索和检索式。 */
/**
 * 从「好像 X 演的 / 由 X 主演 / 主演是 X」里取出完整人名。
 *
 * 中文分词会把外国人名切碎（布拉德·皮特 → 拉德），一旦切碎，系统就没法去核对
 * 「这个人到底演没演这部片」，记忆错误也就无法被发现。
 */
const PERSON_SPAN = /([\u4e00-\u9fa5·]{2,10})(?:主演|演的|出演|饰演|饰)/g;
const PERSON_AFTER = /主演(?:是|为|由)?([\u4e00-\u9fa5·]{2,10})/g;
const NAME_LEAD = /^(好像|像是|似乎|应该是|可能是|由|是|主角|男主角|女主角|男主演|女主演|演员|记得|大概)/;

function personSpans(question: string): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    // 反复剥掉口头前缀（「主角好像是布拉德·皮特」→「布拉德·皮特」）。
    let name = raw.trim();
    for (let i = 0; i < 6; i++) {
      const next = name
        .replace(NAME_LEAD, "")
        .replace(/^角(?=好像|像是|是|似乎|应该|可能|由)/, "")
        .trim();
      if (next === name) break;
      name = next;
    }
    if (name.length < 2 || name.length > 10) return;
    if (INVESTIGATION_FILLERS.has(name) || lowSignal(name)) return;
    if (GENERIC_TERMS.has(name)) return;
    out.push(name);
  };
  for (const match of question.matchAll(PERSON_SPAN)) push(match[1]);
  for (const match of question.matchAll(PERSON_AFTER)) push(match[1]);
  return [...new Set(out)];
}

export function planByRule(question: string): CluePlan {
  const domain = detectInvestigationDomain(question);
  const terms = clueTokens(question);
  const people = personSpans(question);
  const clues: PlannedClue[] = [
    // 人名线索优先：它是最容易被记错、也最值得单独核对的一类线索。
    ...people.map((name) => ({
      text: name,
      terms: [name],
      kind: "role" as const,
    })),
    ...terms.slice(0, 6).map((text) => ({
      text,
      terms: expandTerms([text]),
      kind: (KINDS.find((item) => item.pattern.test(text))?.kind || "other") as PlannedClue["kind"],
    })),
  ];
  // 人名已经完整时，去掉被切碎的残片（「拉德」⊂「布拉德·皮特」）。
  const deduped = clues.filter(
    (item) =>
      !people.some(
        (name) => name !== item.text && name.includes(item.text),
      ),
  );
  clues.length = 0;
  clues.push(...deduped.slice(0, 6));

  if (!clues.length && question.trim().length >= 2)
    clues.push({ text: question.trim().slice(0, 40), terms: [question.trim().slice(0, 20)], kind: "other" });
  // 年份不能进主检索式：用户说「我记得是2005年」时，年份本身可能就是错的，
  // 带上它会把真正的那部片子直接筛掉。年份留作后面核对的条件。
  const isYear = (term: string) => /^(19|20)\d{2}\s*年?$/.test(term) || /^\d{2,4}年代$/.test(term);
  const base = [...new Set(
    clues
      .flatMap((item) => item.terms)
      .filter((term) => term.length >= 2 && !isYear(term)),
  )]
    .slice(0, 9)
    .join(" ")
    .slice(0, 100);
  const context = domain === "screen"
    ? ["剧情 电影 电视剧", "剧名 主演 角色"]
    : domain === "event"
      ? ["演出日期 场次 官方售票", "主办方 售票平台 开票状态"]
      : domain === "verification"
        ? ["官方 原始声明", "来源 事实核实"]
        : ["相关事实 原始出处", "官方资料 依据"];
  // 分离检索：一条带全部线索，一条只用剧情（去掉用户点名的人物）。
  // 用户把主演记错时，只有「不带主演」的那条检索才可能找到真正的作品。
  const plotBase = [...new Set(clues.flatMap((item) => item.terms))]
    .filter(
      (term) =>
        term.length >= 2 &&
        !people.some((name) => name.includes(term) || term.includes(name)),
    )
    .slice(0, 9)
    .join(" ")
    .slice(0, 100);
  const queries = [
    base || question.slice(0, 90),
    ...(people.length && plotBase && plotBase !== base ? [plotBase] : []),
    ...context.map((suffix) => `${base || question.slice(0, 80)} ${suffix}`),
  ]
    .map((query) => query.replace(/\s+/g, " ").trim().slice(0, 120))
    .filter((query) => query.length >= 2);
  return {
    goal: `查清用户给出的线索：${question.slice(0, 100)}`,
    clues,
    queries: [...new Set(queries)].slice(0, 3),
    source: "rule",
    durationMs: 0,
    fallbackReason: `按${{screen:"影视线索",event:"演出信息",verification:"消息查证",general:"开放问题"}[domain]}制定检索式；未使用模型规划。`,
  };
}

const SYSTEM = [
  "你是调查助手，负责把用户的模糊描述整理成检索计划。",
  "只做三件事：1) 写清用户到底想知道什么；2) 列出已知线索（每条给出用于检索的短词）；3) 给出 2-4 条真实可用的中文检索式。",
  "禁止在输出里给出你猜测的答案；禁止把猜测写成事实；不要编造来源。",
  "线索要尽量短（2-8 字），检索式要能直接丢进搜索引擎：不要出现「请问」「帮我」这类词。",
  '只输出 JSON：{"goal":string,"clues":[{"text":string,"terms":[string],"kind":"genre|role|time|region|subject|other","uncertain":boolean}],"queries":[string]}',
].join("\n");

interface RawPlan {
  goal?: unknown;
  clues?: unknown;
  queries?: unknown;
}

function sanitize(raw: RawPlan, question: string): { goal: string; clues: PlannedClue[]; queries: string[] } | null {
  const goal = typeof raw.goal === "string" ? raw.goal.trim().slice(0, 120) : "";
  const clueList = Array.isArray(raw.clues) ? raw.clues : [];
  const clues: PlannedClue[] = [];
  for (const item of clueList.slice(0, 6)) {
    const source = item as { text?: unknown; terms?: unknown; kind?: unknown; uncertain?: unknown };
    const text = typeof source.text === "string" ? source.text.trim().slice(0, 40) : "";
    if (!text) continue;
    const terms = (Array.isArray(source.terms) ? source.terms : [])
      .map((term) => (typeof term === "string" ? term.trim().slice(0, 20) : ""))
      .filter(Boolean)
      .slice(0, 4);
    // 用户原话里没有的「线索」很可能是模型自己的推断，直接丢弃。
    const grounded = [text, ...terms].some((value) => question.includes(value) || value.includes(text));
    if (!grounded) continue;
    const kind = ["genre", "role", "time", "region", "subject", "other"].includes(String(source.kind))
      ? (source.kind as PlannedClue["kind"])
      : "other";
    const usable = (terms.length ? terms : [text]).filter(
      (term) => !GENERIC_TERMS.has(term) && !lowSignal(term) && term.length >= 2,
    );
    // 全是「以前/大概」这类词，说明这条不是有效线索，直接丢掉，避免永远停在「尚未核实」。
    if (!usable.length) continue;
    if (usable.every((term) => VAGUE_TIME.test(term))) continue;
    clues.push({ text, terms: expandTerms(usable), kind, ...(source.uncertain === true ? { uncertain: true } : {}) });
  }
  const queries = (Array.isArray(raw.queries) ? raw.queries : [])
    .map((query) => (typeof query === "string" ? query.trim().slice(0, 60) : ""))
    .filter((query) => query.length >= 2);
  if (!clues.length || !queries.length) return null;
  return { goal: goal || `找出符合这些线索的答案：${clues.map((clue) => clue.text).join("、")}`, clues, queries: [...new Set(queries)].slice(0, 4) };
}

/** 模型规划；任何异常都退回规则规划，并把原因记录下来。 */
export async function planClueInvestigation(question: string, signal: AbortSignal): Promise<CluePlan> {
  const config = modelConfiguration();
  const base = planByRule(question);
  if (!config.available)
    return { ...base, fallbackReason: `模型不可用：${config.reason}` };
  const started = Date.now();
  try {
    const response = await fetch(
      process.env.PLATFORM_MODEL_BASE_URL!.replace(/\/$/, "") + "/chat/completions",
      {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + process.env.PLATFORM_MODEL_API_KEY,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: question },
          ],
        }),
      },
    );
    const text = await response.text();
    if (!response.ok)
      return { ...base, durationMs: Date.now() - started, fallbackReason: `模型返回 HTTP ${response.status}，已退回规则拆分。` };
    const payload = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content || "";
    const parsed = sanitize(JSON.parse(content) as RawPlan, question);
    if (!parsed)
      return { ...base, durationMs: Date.now() - started, raw: content.slice(0, 2000), fallbackReason: "模型输出缺少线索或检索式，已退回规则拆分。" };
    return {
      ...parsed,
      source: "model",
      model: config.model,
      durationMs: Date.now() - started,
      raw: content.slice(0, 4000),
    };
  } catch (error) {
    return {
      ...base,
      durationMs: Date.now() - started,
      fallbackReason: `模型规划失败（${error instanceof Error ? error.message : String(error)}），已退回规则拆分。`,
    };
  }
}

/** 供 UI 展示：这条线索为什么算线索（角色词、题材词等）。 */
export function clueKindLabel(kind: PlannedClue["kind"]) {
  return { genre: "题材", role: "职业/身份", time: "时间", region: "地区", subject: "对象", other: "其他" }[kind];
}

export { ROLE_WORDS };
