/**
 * 线索调查的「理解用户问题」这一步。
 *
 * 模型只做检索规划：把用户的模糊描述拆成调查目标、已知线索和初始检索式。
 * 模型推测出的「答案」一律不采信——这里根本没有接收答案的字段。
 * 模型不可用时退回规则拆分，并在记录里写明本次用的是哪一种。
 */
import { modelConfiguration } from "./providers.ts";

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

/** 调查类型由用户的问题决定，不再把所有陌生问题强行引向“找电视剧”。 */
export type InvestigationDomain = "screen" | "event" | "verification" | "general";

export function detectInvestigationDomain(question: string): InvestigationDomain {
  if (/演唱会|音乐节|巡演|售票|余票|还有票|开票|门票|票务|场次/.test(question)) return "event";
  if (/网传|传言|谣言|真假|真实吗|是真的吗|官方宣布|是否属实|有没有依据|消息可靠|公告/.test(question))
    return "verification";
  if (/电影|电视剧|剧名|港片|动画|动漫|演员|法医|卧底|主角|剧情|哪部剧|哪部片|片名|看过一部/.test(question))
    return "screen";
  return "general";
}

function usableQuestionChunks(question: string) {
  const cleaned = question.replace(/[？?！!。，,、；;：:\n]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.split(/\s+/).flatMap((chunk) => {
    const simple = chunk.replace(FILLERS, "").trim();
    // 中文长问句没有空格；以前整句超过 24 字直接丢弃，导致完全无法规划检索。
    return simple.length > 20 ? simple.match(/.{1,20}/g) || [] : [simple];
  }).filter((chunk) => chunk.length >= 2);
}

/** 保留原始线索，但检索式应按调查对象扩展，而非无条件附加“电视剧”。 */
export function planByRule(question: string): CluePlan {
  const domain = detectInvestigationDomain(question);
  const chunks = usableQuestionChunks(question);
  const clues: PlannedClue[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (seen.has(chunk) || GENERIC_TERMS.has(chunk) || VAGUE_TIME.test(chunk)) continue;
    seen.add(chunk);
    const kind = KINDS.find((item) => item.pattern.test(chunk))?.kind || "other";
    clues.push({ text: chunk, terms: expandTerms([chunk]), kind });
  }
  if (!clues.length && question.trim().length >= 2)
    clues.push({ text: question.trim().slice(0, 40), terms: [question.trim().slice(0, 20)], kind: "other" });
  const trimmed = clues.slice(0, 6);
  const keywords = trimmed.map((clue) => clue.text).slice(0, 5).join(" ");
  const base = keywords.slice(0, 100);
  const context = domain === "screen"
    ? ["剧情 电影 电视剧", "剧名 主演 角色"]
    : domain === "event"
      ? ["演出日期 场次 官方售票", "主办方 售票平台 开票状态"]
      : domain === "verification"
        ? ["官方 原始声明", "来源 事实核实"]
        : ["相关事实 原始出处", "官方资料 依据"];
  const queries = [base, ...context.map((suffix) => `${base} ${suffix}`)]
    .map((query) => query.replace(/\s+/g, " ").trim().slice(0, 120))
    .filter((query) => query.length >= 2);
  return {
    goal: `查清用户给出的线索：${question.slice(0, 100)}`,
    clues: trimmed,
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
    const usable = (terms.length ? terms : [text]).filter((term) => !GENERIC_TERMS.has(term) && term.length >= 2);
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
