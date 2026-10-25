/**
 * 查询型问题的证据式回答：从已经真实取得的原句中提取“问题所问的那个数字”。
 *
 * 与事实真伪裁决分开：一篇新闻引述某机构数字，只能回答“该报道写了什么”，
 * 不能据此声称已独立验证官方原始公告或统计口径。没有直接对应的原句就不作答。
 */
import { sourceProfile, type SourceProfile } from "../adapters/trace/analyze.ts";

export interface LookupEvidence {
  quote: string;
  url: string;
  site: string;
  date: string;
  from: "body" | "excerpt";
  authoritative: boolean;
  /** 网页标题：用来识别「2026 年的文章里讲的是 2025 年的数据」 */
  title?: string;
}
export interface SourcedLookupAnswer extends LookupEvidence {
  value: string;
  label: string;
  limitation: string;
  /** 该数值所属的统计年份 */
  dataYear?: string;
  /** 年份是怎么确定的：原句写明 / 只能靠发布日期推断 */
  yearBasis?: "stated" | "publish_date";
  /** 统计期间（如「7天」） */
  period?: string;
  /** 统计范围（如「全国」） */
  scope?: string;
  /** 发布这份资料的机构身份（政府/期刊/媒体…），与结论页显示同一套分类 */
  profile?: SourceProfile;
}

const METRICS = [
  { question: /国内出游|出游人次|游客人次|旅游人次/, focus: /(?:国内出游|出游人次|游客人次|旅游人数|国内游客|出游|游客)/, unit: /\d+(?:\.\d+)?\s*(?:亿|万)?\s*人次/ },
  { question: /票房/, focus: /票房/, unit: /\d+(?:\.\d+)?\s*(?:亿|万)?\s*元/ },
  { question: /销量|销售量/, focus: /销量|销售量/, unit: /\d+(?:\.\d+)?\s*(?:亿|万)?\s*(?:辆|台|件|套|个)/ },
  { question: /产量/, focus: /产量/, unit: /\d+(?:\.\d+)?\s*(?:亿|万)?\s*(?:辆|台|吨|件|套)/ },
  { question: /总花费|旅游花费|消费金额/, focus: /花费|消费金额|总消费/, unit: /\d+(?:\.\d+)?\s*(?:亿|万)?\s*元/ },
  { question: /收入|营收/, focus: /营收|收入/, unit: /\d+(?:\.\d+)?\s*(?:亿|万)?\s*元/ },
] as const;

/** 选中带同一指标及其数值的短原句；年份与题目冲突则拒绝。 */
export function findSourcedLookupAnswer(question: string, evidence: LookupEvidence[]): SourcedLookupAnswer | null {
  if (!/多少|几多|是多少|具体是|具体多少|公布了吗|发布了吗|有多少/.test(question)) return null;
  const metric = METRICS.find((item) => item.question.test(question));
  if (!metric) return null;

  const requestedYear = question.match(/(?:19|20)\d{2}年/)?.[0] || "";
  const topic = /国庆|春节|五一|暑期|元旦|中秋|清明|端午/.exec(question)?.[0] || "";
  const candidates: { evidence: LookupEvidence; value: string; weight: number }[] = [];

  for (const item of evidence) {
    const sentence = item.quote.replace(/\s+/g, " ").trim();
    if (!item.url.startsWith("http")) continue;
    if (!metric.focus.test(sentence)) continue;
    if (topic && !sentence.includes(topic)) continue;
    // 数据年份必须能被这句原文本身证明：
    //  - 句子里写明了要问的年份 → 可用；
    //  - 句子里没写年份，只有网页发布日期 → **不能**据此认定是该年数据
    //    （2026 年的文章完全可能引用 2023 年的数字，国庆出游人次就出现过两年同为 8.26 亿）。
    // 例外：句子里出现「今年/本年度/当年/同期」这类相对时间，且发布日期在目标年份内。
    if (requestedYear) {
      const statedYears = sentence.match(/(?:19|20)\d{2}\s*年/g)?.map((year) => year.replace(/\s/g, "")) || [];
      const hasRequested = statedYears.some((year) => year === `${requestedYear}`);
      if (!hasRequested) {
        // 句子里出现别的年份：只有当那个年份是「同比/相比」的对照年份时才不算冲突，
        // 例如「同比2025年增长6.3%」说的是今年的数据；「2025年国庆…8.26亿」说的是那一年的数据。
        const otherYears = statedYears.filter((year) => year !== `${requestedYear}`);
        const comparative = otherYears.every((year) =>
          new RegExp(`(?:同比|相比|较|比)${year.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(sentence),
        );
        if (otherYears.length && !comparative) continue;
        // 句子没写年份时，用来源自己的发布日期兜底，但标题里出现别的年份就拒绝
        // （2026 年的文章经常引用 2023 年的数字）。
        const titleYear = item.title?.match(/(?:19|20)\d{2}/)?.[0] || "";
        if (titleYear && `${titleYear}年` !== requestedYear) continue;
        if (!item.date.startsWith(requestedYear.slice(0, 4))) continue;
      }
    }

    const focus = sentence.search(metric.focus);
    if (focus < 0) continue;
    // 在指标之后的同一个语义片段找数值，避免把“花费 7383 亿元”错当“出游人次”。
    const after = sentence.slice(focus + sentence.slice(focus).match(metric.focus)![0].length, focus + 70);
    // 表格型原文常见「总产量（万吨） 71487.6」：数值与单位被表头隔开，
    // 这时只要指标后面 40 字内出现带千分位/小数的数字，也认作该指标的取值。
    // 只在「数字紧挨着问题里问的单位」时才取值（例如问的是万吨，就必须是 71487.6 万吨），
    // 表格里裸数字（119408.9 71487.6 5986.8）无法确认真实归属，宁可不答也不编。
    const unitInQuestion = /(万人次|万人次|万吨|亿元|万辆|万台|亿|万|吨|元|辆|台|%|％)/.exec(question)?.[0] || "";
    const unitPattern = unitInQuestion
      ? new RegExp(`(\\d[\\d,.]*)\\s*${unitInQuestion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
      : null;
    const match = unitPattern ? sentence.match(unitPattern) : after.match(metric.unit);
    if (!match) continue;
    // 数字前不允许跨过其它统计指标，否则可能误把别的数值配到当前指标。
    const prefix = after.slice(0, match.index || 0);
    if (/花费|总收入|票房|产量|销量|总支出/.test(prefix)) continue;
    const value = match[0].replace(/\s+/g, " ").trim();
    candidates.push({
      evidence: item,
      value,
      // 原句自己写明要问的年份，比靠发布日期推断可靠得多，权重更高。
      weight: (item.from === "body" ? 4 : 0) +
        (item.authoritative ? 2 : 0) +
        (sentence.includes(requestedYear) && requestedYear ? 3 : 0),
    });
  }
  candidates.sort((a, b) => b.weight - a.weight);
  const first = candidates[0];
  if (!first) return null;
  const originalOffice = /\.gov\.cn(?:\/|$)/.test(new URL(first.evidence.url).hostname + "/");
  const period = /(\d+)\s*天/.exec(first.evidence.quote)?.[0] || "";
  const scope = /(全国|国内|全省|全市)/.exec(first.evidence.quote)?.[0] || "";
  const stated = Boolean(requestedYear) && first.evidence.quote.includes(requestedYear);
  return {
    ...first.evidence,
    value: first.value,
    ...(requestedYear ? { dataYear: requestedYear, yearBasis: stated ? "stated" as const : "publish_date" as const } : {}),
    ...(period ? { period } : {}),
    ...(scope ? { scope } : {}),
    profile: sourceProfile(first.evidence.url, first.evidence.site, first.evidence.quote),
    label: `找到来源中的对应数值：${first.value}`,
    limitation: originalOffice
      ? "该数值来自政府网站的公开页面，仍需核对该页面的统计主体与适用范围。"
      : "该数值来自公开报道或搜索摘要；是否存在主管部门原始公告、统计口径是否一致，尚未独立核实。",
  };
}

/**
 * 已经把数值放进场时的结论句。
 *
 * 「答了一部分」的档案不能只写「没有任何来源……」，用户明明已经看到一个带来源的数字：
 * 必须把数值本身、统计期间、范围、年份依据和还没核实的那部分写在同一句话里。
 */
export function lookupStatement(answer: SourcedLookupAnswer): string {
  const year = answer.dataYear
    ? `统计年份 ${answer.dataYear}${answer.yearBasis === "stated" ? "（原句写明）" : "（原句未写年份，按来源发布时间推断，仍需核对）"}`
    : "";
  const period = answer.period ? `统计期间 ${answer.period}` : "";
  const scope = answer.scope ? `统计范围 ${answer.scope}` : "";
  const detail = [period, scope, year].filter(Boolean).join("，");
  return `已经查到公开来源中的对应数值：${answer.value}${
    detail ? `（${detail}）` : ""
  }。数字出自 ${answer.site || "公开网页"}${answer.date ? ` ${answer.date.slice(0, 10)} 的页面` : ""}，是该页原文记录；主管部门原始公告与统计口径尚未独立核实，不据此下「已确认」的结论。`;
}

/** 是否是「查数值/日期」的问题。 */
export function isLookupQuestion(question: string): boolean {
  return /多少|几多|是多少|具体是|具体多少|公布|发布了吗|什么时候|哪一天|几月几号|日期/.test(
    String(question || ""),
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return String(url || "").toLowerCase();
  }
}

/**
 * 从已取得的网页里收集「带数值或日期」的原句。
 *
 * 插件（首次核验）与 buildAssessment（补查后重新读取）必须用同一个函数，
 * 否则同一份材料会在不同读取路径下得到不同的直接答案。
 */
export function collectLookupEvidence(
  pages: { id: string; url: string; site: string; date: string; passage: string; title?: string }[],
  bodies: Map<string, { ok: boolean; text: string }>,
  options: { limit?: number; authoritative?: RegExp } = {},
): LookupEvidence[] {
  // 只在域名边界上匹配：news.cnr.cn 不是 news.cn（央广网不等于新华网）。
  const authoritative =
    options.authoritative ||
    /(?:^|\.)(?:gov\.cn|nbs\.gov|people\.com\.cn|news\.cn|xinhuanet\.com|cctv\.com|chinanews\.com\.cn)$/;
  const limit = options.limit ?? 12;
  const seen = new Set<string>();
  const hits: LookupEvidence[] = [];
  for (const page of pages) {
    const body = bodies.get(page.id);
    const text = body?.ok ? String(body.text || "") : "";
    const source = text || String(page.passage || "");
    for (const sentence of source.split(/[。！？\n]/)) {
      const line = sentence.trim();
      if (line.length < 12 || line.length > 160) continue;
      if (!/(\d+(?:\.\d+)?\s*(?:亿|万|万人次|万人|%|％|元)|\d{4}\s*年|\d{1,2}\s*月\s*\d{1,2}\s*日)/.test(line)) continue;
      const key = line.slice(0, 30);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        quote: line,
        url: page.url || "",
        site: page.site || "",
        date: page.date || "",
        title: page.title || "",
        from: text ? "body" : "excerpt",
        authoritative: authoritative.test(hostOf(page.url || "")),
      });
      if (hits.length >= limit) break;
    }
    if (hits.length >= limit) break;
  }
  return hits.sort((a, b) => Number(b.authoritative) - Number(a.authoritative)).slice(0, 3);
}

/* ------------------------------------------------------------------ *
 * 实体型问句（谁 / 叫什么名字 / 在哪里）
 *
 * 数值与日期之外，用户最常问的是「某个实体叫什么」。这类问题的答案同样必须
 * 绑在一句真实原文上：只在原句里读到「X 的父亲是 Y」这样的表述才回答 Y，
 * 读不到就说读不到，不靠词语共现猜。
 * ------------------------------------------------------------------ */

export interface SourcedEntityAnswer extends LookupEvidence {
  value: string;
  label: string;
  limitation: string;
  kind: "entity";
  /** 问句里被问的关系，例如「父亲」「导演」；为空表示问实体本身 */
  relation?: string;
  profile?: SourceProfile;
}

const ENTITY_STOP = new Set([
  "他", "她", "它", "其", "这个", "那个", "一位", "这些", "那些", "谁", "什么",
  "名字", "本人", "角色", "人物", "一名", "两个", "几个", "我们", "他们",
]);

/** 问的是不是一个实体取值（人名、角色名、机构名、地点）。 */
export function isEntityQuestion(question: string): boolean {
  const text = String(question || "").trim();
  if (!text) return false;
  return /(是谁|叫什么名字|叫什么|是哪位|是什么|在哪里|在哪)/.test(text);
}

interface EntityParts { subject: string; relation: string; kind?: "location" | "identity" }

/** 拆出「主体 + 关系」：`A 的 B 是谁` → subject=A，relation=B。 */
export function entityQuestionParts(question: string): EntityParts | null {
  const text = String(question || "")
    .trim()
    .replace(/^(请问|想问一下|想查一下)[，,]?/, "")
    .replace(/[？?]\s*$/, "");
  const asking = /(是谁|叫什么名字|叫什么|是哪位|是什么|在哪里|在哪)/.exec(text);
  if (!asking) return null;
  const kind = /在哪里|在哪/.test(asking[0]) ? "location" as const : "identity" as const;
  const head = text.slice(0, asking.index).trim();
  if (head.length < 2) return null;
  const of = head.lastIndexOf("的");
  if (of > 0 && of < head.length - 1) {
    return { subject: head.slice(0, of).trim(), relation: head.slice(of + 1).trim(), kind };
  }
  return { subject: head, relation: "", kind };
}

/** 主体里的检索词：去掉书名号、方位词与疑问装饰。 */
function subjectTerms(subject: string) {
  return subject
    .replace(/[《》「」“”『』]/g, " ")
    .replace(/里面|当中|之中|里|中/g, " ")
    .split(/[\s,，、]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

const ENTITY_QUOTE_SPLIT = /[。！？\n]/;

/**
 * 收集可能含实体答案的原句。
 *
 * 与数值收集的区别：不要求句子里有数字，但必须同时出现主体检索词与所问关系，
 * 否则就只是同一页面上的无关句子。
 */
export function collectEntityEvidence(
  pages: { id: string; url: string; site: string; date: string; passage: string; title?: string }[],
  bodies: Map<string, { ok: boolean; text: string }>,
  parts: EntityParts,
  options: { limit?: number } = {},
): LookupEvidence[] {
  const limit = options.limit ?? 12;
  const terms = subjectTerms(parts.subject);
  const relation = parts.relation;
  const seen = new Set<string>();
  const hits: LookupEvidence[] = [];
  for (const page of pages) {
    const body = bodies.get(page.id);
    const text = body?.ok ? String(body.text || "") : "";
    const source = text || String(page.passage || "");
    for (const sentence of source.split(ENTITY_QUOTE_SPLIT)) {
      const line = sentence.trim();
      if (line.length < 8 || line.length > 200) continue;
      if (terms.length && !line.includes(terms.at(-1)!)) continue;
      if (relation && !line.includes(relation)) continue;
      const key = line.slice(0, 30);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        quote: line,
        url: page.url || "",
        site: page.site || "",
        date: page.date || "",
        title: page.title || "",
        from: text ? "body" : "excerpt",
        authoritative: false,
      });
      if (hits.length >= limit) break;
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

/** 普通名词：紧跟在关系词后面时不是答案（「父亲的训练」不是人名）。 */
const ENTITY_COMMON = new Set([
  "分别", "分别为", "可能", "也许", "应该", "例如", "比如", "这就", "这便", "不仅", "包括", "以及",
  "训练", "带领", "教导", "帮助", "影响", "身边", "保护", "陪伴", "要求", "安排",
  "故事", "影片", "作品", "角色", "设定", "身份", "名字", "介绍", "描述", "讲述",
  "孩子", "儿子", "女儿", "妻子", "丈夫", "家人", "兄弟", "朋友", "同伴", "对手",
]);

/** 一句原文里的候选答案，以及它是不是「强句式」得来的。 */
export function entityCandidatesIn(
  quote: string,
  parts: EntityParts,
): { value: string; strong: boolean }[] {
  const line = quote.replace(/\s+/g, " ").trim();
  const terms = subjectTerms(parts.subject);
  const relation = parts.relation;
  const out: { value: string; strong: boolean }[] = [];
  if (/假设|猜测|传闻|据说|也许|或许|疑似|尚未证实|未经证实|未获证实|仍待验证|有待确认|尚无证据|并无证据|没有证据|未能证实|不是真的|说法不实|说法错误|不属实|不成立|不正确|不准确|不可信|系谣言|(?:说法|表述|消息|传言|结论|这句话).{0,8}(?:假|错|不真|不对|没有依据|无法证实)/.test(line)) return [];
  const push = (raw: string | undefined, strong: boolean) => {
    const value = String(raw || "")
      .replace(/^[「“"'‘\s]+|[」”"'’\s]+$/g, "")
      .replace(/[，,。；;、].*$/, "")
      .trim();
    if (value.length < 2 || value.length > (parts.kind === "location" ? 24 : 12)) return;
    // A place must end as a place, not as an action such as "北京开放".
    if (parts.kind === "location" && !/(?:省|市|县|区|镇|乡|村|街|路|巷|号|中心|山|湖|河|岛|洲|国|宫|馆|园|城|北京|上海|天津|重庆|香港|澳门)$/.test(value)) return;
    if (ENTITY_STOP.has(value) || ENTITY_COMMON.has(value) || /分别|例如|比如|包括/.test(value)) return;
    if (relation && (value === relation || value.includes(relation))) return;
    if (terms.some((term) => value === term || value.includes(term))) return;
    if (/^(一名|这个|那个|其|他|她|它|是|为|叫|和好朋友|与好朋友)/.test(value)) return;
    // 否定表述不是答案：「父亲并非木法沙」不能读成「父亲是木法沙」。
    if (/^(并非|不是|没有|未曾|未|不再)/.test(value)) return;
    // 叙述性片段不是实体：「讲述的是辛巴的父亲」不能把「讲述的」当成人名。
    if (/[的了着们是]$/.test(value)) return;
    if (/^(讲述|介绍|关于|说明|报道|描写|提到|表示|指出|认为|影片|故事|资料|文章|视频)/.test(value)) return;
    out.push({ value, strong });
  };

  const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Bind the relation to the requested character, not merely to the work title.
  const subject = terms.at(-1);
  if (!subject) return [];
  const name = "([\\u4e00-\\u9fa5A-Za-z·]{2,12}?)";
  const boundary = "(?=[，,。；;、：:）)」”\\\"]|$|(?:的|是|在|与|和|从未|一直|曾经|总是|带领|训练|陪伴|教导|保护|帮助|死于|被))";
  if (parts.kind === "location") {
    const anchor = escaped(subject) + (relation ? "(?:的)?" + escaped(relation) : "");
    for (const matched of line.matchAll(new RegExp(anchor + "(?:位于|坐落于|坐落在|在)\\s*([\\u4e00-\\u9fa5A-Za-z0-9·号]{2,24})(?=[，,。；;]|$)", "g"))) push(matched[1], true);
  } else if (relation) {
    const anchor = escaped(subject) + "(?:的|在(?:他的|其)?|跟随(?:他的|其)?)?" + escaped(relation);
    if (new RegExp(anchor + "(?:可能|也许|或许|据说|似乎|并非|不是|没有证据|尚未确认|是否)").test(line)) return [];
    for (const matched of line.matchAll(new RegExp(anchor + "(?:正是|就是|是|为|叫)\\s*[「“\\\"]?" + name + boundary, "g"))) push(matched[1], true);
    for (const matched of line.matchAll(new RegExp(anchor + "\\s*[：:]?\\s*[「“\\\"]([^」”\\\"]{2,12})[」”\\\"]", "g"))) push(matched[1], true);
    for (const matched of line.matchAll(new RegExp(name + "\\s*[，,]?\\s*(?:正是|就是|是)\\s*" + escaped(subject) + "(?:的)?" + escaped(relation), "g"))) push(matched[1], true);
    for (const matched of line.matchAll(new RegExp(anchor + "\\s*" + name + boundary, "g"))) push(matched[1], false);
  } else {
    for (const matched of line.matchAll(new RegExp(escaped(subject) + "(?:是|为|叫)\\s*[「“\\\"]?" + name + boundary, "g"))) push(matched[1], true);
  }

  const seen = new Set<string>();
  return out.filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

/**
 * 选出最可信的实体答案。
 *
 * 排序依据三条可核对的事实，而不是猜测：句子是不是「关系+是+值」这类强句式、
 * 命中了多少个不同来源、以及是否拿到了正文。最高分出现不同取值时宁可不答。
 */
export function findSourcedEntityAnswer(
  question: string,
  evidence: LookupEvidence[],
): SourcedEntityAnswer | null {
  const parts = entityQuestionParts(question);
  if (!parts) return null;
  const tally = new Map<
    string,
    { strong: boolean; items: LookupEvidence[]; body: boolean; score: number }
  >();
  for (const item of evidence) {
    if (!item.url.startsWith("http")) continue;
    for (const candidate of entityCandidatesIn(item.quote, parts)) {
      const entry = tally.get(candidate.value) || {
        strong: false,
        items: [],
        body: false,
        score: 0,
      };
      entry.strong = entry.strong || candidate.strong;
      entry.body = entry.body || item.from === "body";
      entry.items.push(item);
      tally.set(candidate.value, entry);
    }
  }
  for (const entry of tally.values()) {
    entry.score =
      (entry.strong ? 6 : 0) +
      new Set(entry.items.map((item) => item.site || item.url)).size +
      (entry.body ? 2 : 0);
  }
  if ([...tally.values()].filter((entry) => entry.strong).length > 1) return null;
  const ranked = [...tally.entries()].sort((a, b) => b[1].score - a[1].score);
  if (!ranked.length) return null;
  const [bestValue, best] = ranked[0];
  const rival = ranked.find(([value, entry]) => value !== bestValue && entry.score >= best.score);
  if (rival) return null;
  // 弱句式且只有一个来源、没拿到正文时不下结论：那可能只是叙述里的一句普通名词。
  if (!best.strong && new Set(best.items.map((item) => item.url)).size < 2 && !best.body) return null;
  const top = best.items.find((item) => item.from === "body") || best.items[0];
  return {
    ...top,
    value: bestValue,
    kind: "entity",
    ...(parts.relation ? { relation: parts.relation } : {}),
    profile: sourceProfile(top.url, top.site, top.quote),
    label: `找到来源中的对应答案：${bestValue}`,
    limitation:
      top.from === "body"
        ? "该答案出自取得的那句原文；是否唯一、是否为同一对象或同一版本，仍需人工核对。"
        : "该答案只出自搜索摘要，未取得原文正文；不能据此认定已经核实。",
  };
}

/** 实体答案的结论句：把答案、原句出处和还没核实的那部分写在同一句话里。 */
export function entityStatement(answer: SourcedEntityAnswer): string {
  return `已经查到公开来源中的对应表述：${answer.value}。原句出自 ${
    answer.site || "公开网页"
  }${answer.date ? ` ${answer.date.slice(0, 10)} 的页面` : ""}，是来源自己写的，不等同于已核实的唯一答案${
    answer.from === "body" ? "" : "（只拿到摘要）"
  }。`;
}
