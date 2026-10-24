/**
 * 证据核验规则引擎。
 *
 * 设计原则（对应产品要求第六节）：
 *  1. 命中检索 ≠ 事实为真：结论只看「独立来源 + 原文依据 + 数值/表述一致」；
 *  2. 转载与同源引用必须合并：内容高度雷同的不同站点只算一条独立证据；
 *  3. 时间、主体、地区不匹配要显式记录，不能默认适用；
 *  4. 证据不足时输出 insufficient，绝不给出确定结论；
 *  5. 全部判断输出 reason，便于人工复查；不引入不可复现的随机性。
 */

import {
  compareSentence,
  parseClaim,
  type ClaimSemantics,
  type SentenceVerdict,
} from "./claim-semantics.ts";

/** 证据与事实的关系：支持 / 反对 / 无法确认 / 明显无关。 */
export type Relation = "supports" | "contradicts" | "unclear" | "irrelevant";
export type Outcome = "supported" | "contradicted" | "disputed" | "outdated" | "partial" | "insufficient";

export interface TraceFact {
  id: string;
  text: string;
  queries: string[];
  /** 适用时间要求，例如「2024年内」「现行有效」；留空表示未限定 */
  timeScope?: string;
  /** 主体与地区要求，例如「中国大陆」「教育部」；留空表示未限定 */
  subjectScope?: string;
  /** 检索式来源：客户端给定，或按规则从原句扩展 */
  queryPlan?: { source: "client" | "rule"; note: string };
}

export interface AnalysablePage {
  sourceOrigin?: "operator_url" | "search";
  id: string;
  url: string;
  site: string;
  title: string;
  date: string;
  passage: string;
  /** 检索服务给出的相关性分数；仅用于排序，不作为真实性判断 */
  score?: number;
}

export interface BodyEvidence {
  ok: boolean;
  text: string;
  reprintMarkers: string[];
}

export interface QuantityEvidence {
  subject: string;
  metric: string;
  year: string;
  value: number;
  unit: string;
  approximate: boolean;
  sentence: string;
  context: string;
  publisher: string;
  statisticalSource: string;
  scope: string;
  scopeBasis: string;
  url: string;
  from: "body" | "excerpt";
  relation: "supports" | "contradicts" | "unclear";
  /** 语义层判定（主体/行为/型号/限定/因果），只有带谓词的说法才会给出 */
  semantic?: { verdict: string; reason: string; sentence: string; fromTitle?: boolean };
  /** 来源身份：谁发的、能发布什么 */
  profile?: SourceProfile;
  /** 来源自身的取值方式：至少/至多/恰好。用于把「超过 120 万辆」和「120 万辆」区分开 */
  bound?: "gte" | "lte" | "eq";
}

export interface SourceAssessment {
  sourceOrigin?: "operator_url" | "search";
  pageId: string;
  /** 来源身份：谁发的、能发布什么 */
  profile?: SourceProfile;
  url: string;
  site: string;
  title: string;
  date: string;
  excerpt: string;
  relation: Relation;
  /** 语义层判定（主体/行为/型号/限定/因果），只有带谓词的说法才会给出 */
  semantic?: { verdict: string; reason: string; sentence: string; fromTitle?: boolean };
  relevance: number;
  reasons: string[];
  /** 原文是否可访问；false 表示只有搜索摘要 */
  bodyAvailable: boolean;
  bodyExcerpt: string | null;
  originality: "original_candidate" | "reprint" | "unknown";
  reprintMarkers: string[];
  /** 同源/转载聚类：同一簇只算一条独立证据 */
  clusterId: string;
  duplicate: boolean;
  /**
   * 独立性三态：
   *  duplicate    有明确依据证明是同一篇内容（并入同源簇，不计入独立证据）
   *  unconfirmed  有同源线索但证据不足（同标题/相似摘要/跨站同编号等），不计入独立证据
   *  unique       未检测到重复——只是"没发现重复"，不等于"已证实独立"
   */
  independence: "unique" | "duplicate" | "unconfirmed";
  /** 该来源明确引用的原始数据出处（如"中国汽车工业协会"），用于避免把二次报道当多份独立证据 */
  citedOrigin?: { org: string; quote: string } | null;
  /**
   * 原文状态：
   *  evidence_sentence   正文里找到了直接涉及该说法的证据句（才算"取得关键原文"）
   *  main_without_match  正文抓到了，但没有找到涉及该说法的句子
   *  boilerplate_only    正文基本是导航/样板，实质内容不足
   *  fetch_failed        请求失败或无正文
   */
  bodyStatus: "evidence_sentence" | "main_without_match" | "boilerplate_only" | "fetch_failed";
  /** 与该说法直接相关的证据句（原文或摘要里的原句，不改写） */
  keySentence?: string | null;
  /** 证据句来自原文正文还是搜索摘要 */
  keySentenceFrom?: "body" | "excerpt" | null;
  /** 范围/状态是否与该说法一致；不一致时不计入支持 */
  scopeCompatible?: boolean;
  scopeNote?: string;
  quantityEvidence?: QuantityEvidence[];
  /** 被并入哪一条、依据是什么 */
  duplicateOf?: { primary: string; basis: string } | null;
  /** 独立性未确认的原因 */
  independenceNote?: string;
  dateStatus: "in_range" | "out_of_range" | "unknown";
  dateNote: string;
  /** 人工修正后保留的系统自动判断 */
  autoRelation?: Relation;
  /** 人工修正记录（不覆盖原始搜索返回与摘录） */
  manualCorrection?: { relation: Relation; note: string; actor: string; at: string } | null;
}

export interface FactAssessment {
  factId: string;
  fact: string;
  relation: "supports" | "contradicts" | "mixed" | "none";
  independentClusters: number;
  bodyBackedClusters: number;
  supports: number;
  contradicts: number;
  unclear: number;
  irrelevant: number;
  /** 可能是转载但无法确认的条数（不计入独立证据） */
  unconfirmedSources?: number;
  /** 其中涉及的支持性来源簇数 */
  unconfirmedClusters?: number;
  /** 被多条来源共同引用的原始出处（按 1 条独立证据计） */
  sharedOrigins?: { org: string; count: number }[];
  /** 正文里真的找到相关证据句的来源数 */
  keySentenceSources?: number;
  /** 被判支持但存在范围/状态差异、未计入支持数的来源数 */
  scopeExcludedSources?: number;
  /** 内容相关但时间要求不满足的来源数，用于区分「没有证据」与「证据过期」 */
  outOfRangeSupports: number;
  sources: SourceAssessment[];
  reasons: string[];
}

const STOP_TERMS = new Set([
  "的", "了", "是", "在", "和", "与", "及", "或", "对", "为", "有", "无", "不", "也", "都",
  "一个", "这个", "那个", "什么", "怎么", "是否", "可以", "以及", "并且", "因为", "所以",
  "the", "and", "for", "with", "that", "this", "from",
]);

/** 中文取二元词 + 拉丁/数字词，用于相关度与雷同判定（非语义向量）。 */
export function terms(text: string): string[] {
  const raw = (text.normalize("NFKC").toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]+(?:[.\-/][a-z0-9]+)*/gu) || [])
    .flatMap((word) =>
      /^\p{Script=Han}/u.test(word) && word.length > 1
        ? Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))
        : [word],
    )
    .filter((t) => t.length > 1 && !STOP_TERMS.has(t));
  return [...new Set(raw)];
}

export function coverage(haystack: string, needles: string[]) {
  if (!needles.length) return 0;
  const text = haystack.normalize("NFKC").toLowerCase();
  const hit = needles.filter((t) => text.includes(t)).length;
  return Number((hit / needles.length).toFixed(4));
}

/** 提取数值型断言：数字 + 可选单位/百分号/年月，用于发现互相矛盾的说法。 */
export function numbers(text: string): string[] {
  const normalized = text.normalize("NFKC");
  const pattern = /\d+(?:\.\d+)?\s*(?:%|％|年|月|日|万元|亿元|万|亿|元|人|家|个|次|倍|公里|千米|平方米|岁|小时|天)?/g;
  const out = new Set<string>();
  for (const match of normalized.matchAll(pattern)) {
    const token = match[0].replace(/\s+/g, "");
    const at = match.index ?? 0;
    const before = normalized.slice(Math.max(0, at - 6), at);
    const after = normalized.slice(at + match[0].length, at + match[0].length + 2);
    // 型号里的数字不是数量断言：PS4 / iPhone 15 / Switch 2 / 4K
    if (/[A-Za-z]$/.test(before) || /^[A-Za-z]/.test(after)) {
      if (!/[年月日%％]/.test(token)) continue;
    }
    out.add(token);
  }
  return [...out];
}

/** 纯日期/年份不是"数量断言"：来源出现 2025年 不能算作与事实的数值一致。 */
const DATE_TOKEN = /^\d{1,4}(?:年|月|日)$/;
export function quantities(text: string): string[] {
  return numbers(text).filter((token) => !DATE_TOKEN.test(token));
}

/** 汉字三元片段：比二元词更能代表"同一表述"，用于判断来源是否真的在说这件事。 */
export function fragments(text: string): string[] {
  const runs = text.normalize("NFKC").match(/\p{Script=Han}{3,}/gu) || [];
  const out = new Set<string>();
  for (const run of runs) for (let i = 0; i + 3 <= run.length; i++) out.add(run.slice(i, i + 3));
  return [...out];
}

const NEGATIONS = ["不是", "并非", "并没有", "没有", "尚未", "未", "否认", "驳斥", "不实", "谣言", "错误", "质疑", "辟谣", "从未", "不属于"];

function negationNear(text: string, needles: string[]) {
  const normalized = text.normalize("NFKC");
  for (const term of needles.slice(0, 12)) {
    const index = normalized.indexOf(term);
    if (index < 0) continue;
    const window = normalized.slice(Math.max(0, index - 24), index + term.length + 24);
    const hit = NEGATIONS.find((n) => window.includes(n));
    if (hit) return hit;
  }
  return null;
}

const UP_WORDS = /超过|逾|以上|至少|不低于|突破|多于|高于/;
const DOWN_WORDS = /不足|低于|少于|至多|最多|以下|不超过/;

function parseQuantity(token: string) {
  const matched = token.match(/^(\d+(?:\.\d+)?)(.*)$/);
  if (!matched) return null;
  return { value: Number(matched[1]), unit: matched[2] || "" };
}

/**
 * 数量断言比对。只比较同一计量单位的数字，并尊重事实里的比较方向：
 *  - 「超过1200万辆」遇到来源的 1288.8万辆 是支持，不是反证；
 *  - 单位不同（产量 vs 出口量 vs 增速百分比）一律不参与比对；
 *  - 无法判定时返回 unclear，交给人看，绝不冒充反证。
 */
export function compareQuantities(factText: string, factQuantities: string[], pageQuantities: string[]) {
  const factItems = factQuantities
    .map(parseQuantity)
    .filter((item): item is { value: number; unit: string } => !!item);
  const pageItems = pageQuantities
    .map(parseQuantity)
    .filter((item): item is { value: number; unit: string } => !!item);
  const up = UP_WORDS.test(factText);
  const down = DOWN_WORDS.test(factText);
  for (const factItem of factItems) {
    if (!factItem.unit) continue;
    const sameUnit = pageItems.filter((item) => item.unit === factItem.unit);
    if (!sameUnit.length) continue;
    const shown = sameUnit.slice(0, 3).map((item) => `${item.value}${item.unit}`).join("、");
    if (!up && !down && sameUnit.some((item) => item.value === factItem.value))
      return {
        kind: "supports" as const,
        exact: true,
        reason: `同一计量单位下数量一致：${factItem.value}${factItem.unit}。`,
      };
    if (up) {
      const inclusive = /至少|不低于|以上/.test(factText);
      const larger = sameUnit.filter((item) => inclusive ? item.value >= factItem.value : item.value > factItem.value).sort((a, b) => a.value - b.value);
      if (larger.length)
        return {
          kind: "supports" as const,
          exact: false,
          reason: `事实为「超过 ${factItem.value}${factItem.unit}」，来源给出 ${larger
            .slice(0, 2)
            .map((item) => `${item.value}${item.unit}`)
            .join("、")}，不违背该断言。`,
        };
      return {
        kind: "contradicts" as const,
        exact: false,
        reason: `事实称超过 ${factItem.value}${factItem.unit}，但同单位来源均低于该值（${shown}）。`,
      };
    }
    if (down) {
      const inclusive = /至多|最多|以下|不超过/.test(factText);
      if (sameUnit.some((item) => inclusive ? item.value <= factItem.value : item.value < factItem.value))
        return {
          kind: "supports" as const,
          exact: false,
          reason: `事实为「低于 ${factItem.value}${factItem.unit}」，来源给出 ${shown}，不违背该断言。`,
        };
      return {
        kind: "contradicts" as const,
        exact: false,
        reason: `事实称低于 ${factItem.value}${factItem.unit}，但同单位来源均高于该值（${shown}）。`,
      };
    }
    return {
      kind: "unclear" as const,
      exact: false,
      reason: `同单位数量与事实不同：事实 ${factItem.value}${factItem.unit}，来源 ${shown}；可能是统计口径不同，需人工核对。`,
    };
  }
  return { kind: null, exact: true, reason: "" };
}

const QUANTITY_UNIT = "万辆|亿元|万元|万吨|万台|亿台|公里|千米|平方米|辆|吨|台|人|家|个|元|%|万|亿";
const normalizedQuantityText = (text: string) => text.normalize("NFKC").replace(/[産產車銷萬輛國數據協會]/g,
  (s) => ({"産":"产","產":"产","車":"车","銷":"销","萬":"万","輛":"辆","國":"国","數":"数","據":"据","協":"协","會":"会"}[s] || s));

/** A bound observation, never a bag of all the numbers on the page. */
export function quantityEvidenceFor(fact: TraceFact, page: AnalysablePage, text: string, from: "body" | "excerpt"): QuantityEvidence[] {
  const claim = normalizedQuantityText(fact.text);
  const metric = ["出口量", "销售量", "销量", "产量", "营业收入", "收入", "数量"].find((item) => claim.includes(item));
  if (!metric) return [];
  const at = claim.indexOf(metric);
  // 「某市 / 本市 / 全市 / 该市 / 我市」指的是同一个层级，比对主体时按同一占位处理，
  // 否则同一件事会因为一个前缀字而匹配不上（这属于口径同一性判断，不是放宽范围）。
  const cityNeutral = (value: string) => value.replace(/(某|本|该|我|全)市/g, "某市");
  const subject = cityNeutral(
    claim.slice(0, at).replace(/(?:19|20)\d{2}年|中国大陆|中国|我国|全国|全年|年度|的|据|数据显示/g, "").trim(),
  );
  const year = claim.match(/(?:19|20)\d{2}/)?.[0] || fact.timeScope?.match(/(?:19|20)\d{2}/)?.[0];
  if (!subject || !year) return [];
  const title = normalizedQuantityText(page.title);
  const whole = normalizedQuantityText(text);
  const titleYear = title.match(/(?:19|20)\d{2}/)?.[0];
  // Annual report metadata is attached to the document, not borrowed from a remote paragraph.
  const annualTitle = titleYear === year && /统计公报|年(?:12月|全年).*运行情况/.test(title);
  const host = (() => { try { return new URL(page.url).hostname; } catch { return ""; } })();
  const nbs = /(^|\.)stats\.gov\.cn$/.test(host);
  const miit = /(^|\.)miit\.gov\.cn$/.test(host);
  const nationalChina = /中国|我国|全国/.test(claim + (fact.subjectScope || ""));
  const sourceNote = whole.match(/(?:注[：:]?[^。\n]{0,20})?上述数据来自中国汽车工业协会[^。\n]*/)?.[0] ||
    whole.match(/中国汽车工业协会[^。\n]{0,30}(?:发布|数据|获悉)[^。\n]{0,30}/)?.[0] || "";
  const caam = /中国汽车工业协会/.test(sourceNote);
  const scopeBasis = nbs ? whole.match(/规模以上工业主要产品产量[^\n。]{0,40}/)?.[0] || "" : sourceNote;
  const statisticalSource = nbs ? "国家统计局" : caam ? "中国汽车工业协会" : "统计来源未注明";
  const scope = nbs && scopeBasis ? "规模以上工业主要产品产量统计" : caam
    ? "中国汽车工业协会汽车工业统计（原页未细列企业覆盖边界）" : "适用统计范围未确认";
  const result: QuantityEvidence[] = [];
  const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  for (const paragraph of paragraphs) {
    // A single paragraph can supply an immediately attached annual context, not other paragraphs.
    const paragraphSentences = sentences(paragraph);
    for (const [sentenceIndex, sentence] of paragraphSentences.entries()) {
      const s = cityNeutral(normalizedQuantityText(sentence));
      const previous = paragraphSentences[sentenceIndex - 1] || "";
      const previousYears = [...new Set(normalizedQuantityText(previous).match(/(?:19|20)\d{2}/g) || [])];
      const attachedYear = /^(?:其中|同期|当年|全年)/.test(s) && previous.length <= 500 && previousYears.length === 1 && previousYears[0] === year;
      // 主体比对：先按完整主体找；找不到时用去掉地名前缀的核心词（「某市新能源汽车」→「新能源汽车」），
      // 这样「本市2024年新能源汽车产量…」「2024年新能源汽车产量…」都能对上同一个主体。
      const subjectCore = subject.startsWith("某市") ? subject.slice(2) : subject;
      let subjectAt = s.indexOf(subject);
      let subjectLength = subject.length;
      if (subjectAt < 0 && subjectCore && subjectCore !== subject) {
        const coreAt = s.indexOf(subjectCore);
        if (coreAt >= 0) {
          subjectAt = coreAt;
          subjectLength = subjectCore.length;
        }
      }
      if (subjectAt < 0) continue;
      const prefix = s.slice(0, subjectAt);
      // A national claim cannot borrow another country/province's observation.
      // Missing geography is accepted only from explicitly attached national context.
      const otherRegion = /美国|日本|德国|法国|英国|印度|韩国|俄罗斯|欧洲|欧盟|全球|世界|海外|广东|浙江|江苏|山东|安徽|四川|湖北|湖南|河南|河北|江西|福建|广西|云南|贵州|海南|山西|陕西|甘肃|青海|辽宁|吉林|黑龙江|北京|上海|天津|重庆|深圳|香港|澳门|台湾|内蒙古|新疆|西藏|宁夏|[\p{Script=Han}]{2,6}(?:省|市|自治区|地区)/u;
      if (nationalChina && (otherRegion.test(prefix) ||
        !/中国|我国|全国/.test(prefix + (attachedYear ? previous : "")) && !(annualTitle && (nbs || miit)))) continue;
      const sentenceYears = [...new Set(s.match(/(?:19|20)\d{2}/g) || [])];
      const periodText = s + (attachedYear ? "。" + normalizedQuantityText(previous) : "");
      // Reject partial-year, monthly and relative-year figures even in an annual report.
      const monthRange = periodText.match(/(\d{1,2})\s*(?:[－—–\-~～]|至|到)\s*(\d{1,2})月/);
      if (monthRange && (Number(monthRange[1]) !== 1 || Number(monthRange[2]) !== 12)) continue;
      const fullYearRange = !!monthRange && Number(monthRange[1]) === 1 && Number(monthRange[2]) === 12;
      const period = fullYearRange || /全年|年度/.test(s);
      const targetMonth = claim.match(/(?:19|20)\d{2}年\s*(\d{1,2})月/)?.[1];
      // Annual and monthly production must not share a bucket. In particular,
      // '其中…153万辆' inherits December from its own paragraph, not the annual row.
      const monthlyContext = /(?:19|20)\d{2}年\s*\d{1,2}月|(?:^|[，,。])\s*\d{1,2}月/.test(periodText);
      if (!targetMonth && monthlyContext && !fullYearRange) continue;
      if (targetMonth && (period || !new RegExp(`(?:^|年|[，,。])\\s*${targetMonth}月`).test(s + (attachedYear ? "。" + previous : "")))) continue;
      if (/^(?:上年|去年|前年|上年度|去年同期|上年同期|同期)/.test(s) || /上半年|下半年|季度/.test(s)) continue;
      if (!sentenceYears.length && previousYears.some((item) => item !== year)) continue;
      if (sentenceYears.length ? sentenceYears.length !== 1 || sentenceYears[0] !== year
        : !attachedYear && !(annualTitle && (period || /统计公报/.test(title)))) continue;
      if (/预计|预测|有望|目标|计划|力争/.test(s)) continue;
      const afterSubject = s.slice(subjectAt + subjectLength);
      // Stop before another subject/clause, so production cannot borrow a later sales/export number.
      const directMetric = metric === "产量" ? "(?:年)?产量" : metric === "销量" || metric === "销售量" ? "(?:年)?(?:销量|销售量)" : metric;
      const direct = afterSubject.match(new RegExp(`^\\s*(?:${year}年)?\\s*(?:${directMetric})\\s*(?:为|达|达到|完成|实现|共|是|约为|约|近|接近|超过|突破|逾|不足|低于|不超过|至少|在)*\\s*(\\d+(?:\\.\\d+)?)\\s*(${QUANTITY_UNIT})\\s*(左右|上下|以上|以下)?`));
      const paired = !direct && (metric === "产量" || metric === "销量" || metric === "销售量")
        ? afterSubject.match(new RegExp(`^\\s*(?:年)?产销(?:量)?\\s*(?:分别(?:为|达|达到|完成)?|分别)\\s*(\\d+(?:\\.\\d+)?)\\s*(${QUANTITY_UNIT})?\\s*(?:和|及|、)\\s*(\\d+(?:\\.\\d+)?)\\s*(${QUANTITY_UNIT})`)) : null;
      if (!direct && !paired) continue;
      const value = direct ? Number(direct[1]) : Number(metric === "产量" ? paired![1] : paired![3]);
      const unit = direct ? direct[2] : paired![2] || paired![4];
      const local = direct?.[0] || paired![0] || "";
      const approximate = /约|左右|上下|接近|近\s*\d/.test(local);
      // 来源写成「超过 / 不足」时，记下它自己的取值方式；不要直接丢掉，
      // 否则「说法：超过120万辆 + 来源：超过120万辆」会被判成没有证据。
      const bound: "gte" | "lte" | "eq" = /超过|突破|逾|至少|不低于|以上/.test(local)
        ? "gte"
        : /不足|低于|不超过|以下|至多|最多/.test(local)
          ? "lte"
          : "eq";
      result.push({subject, metric, year, value, unit, approximate, sentence, bound,
        context: sentenceYears.length ? "年份与指标同句" : attachedYear ? previous : page.title,
        publisher: nbs ? "国家统计局" : miit ? "工业和信息化部" : page.site,
        statisticalSource, scope, scopeBasis, url: page.url, from, relation:"unclear"});
    }
  }
  return [...new Map(result.map((item) => [`${item.value}|${item.unit}|${item.statisticalSource}|${item.approximate}`, item])).values()];
}

function compareBoundQuantity(claim: string, evidence: QuantityEvidence[]) {
  const match = normalizedQuantityText(claim).match(new RegExp(`(不超过|不低于|超过|高于|多于|至少|以上|低于|少于|至多|最多|以下|达到|为|等于)?\\s*(\\d+(?:\\.\\d+)?)\\s*(${QUANTITY_UNIT})`));
  if (!match) return { kind:"unclear" as const, evidence:[] as QuantityEvidence[], reason:"数量条件未能完整识别，不能判断。" };
  const threshold = Number(match[2]), unit = match[3], op = match[1] || "等于";
  const relevant = evidence.filter((item) => item.unit === unit);
  const exact = relevant.filter((item) => !item.approximate);
  const selected = exact.length ? exact : relevant;
  const compared = selected.map((item) => {
    if (item.approximate) return { ...item, relation: "unclear" as const };
    // 来源自己写的是「超过 X」→ 至少 X；「不足 X」→ 至多 X。与说法的比较方向结合判断。
    const lowerBound = item.bound === "gte" || /不低于|至少|以上|达到/.test(op);
    const upperBound = item.bound === "lte" || /不超过|至多|最多|以下/.test(op);
    const strictLower = /超过|高于|多于/.test(op);
    const strictUpper = /低于|少于/.test(op);
    const ok = upperBound
      ? item.value <= threshold
      : lowerBound
        ? item.value >= threshold
        : strictLower
          ? item.value > threshold
          : strictUpper
            ? item.value < threshold
            : item.value === threshold;
    return { ...item, relation: ok ? ("supports" as const) : ("contradicts" as const) };
  });
  const values = new Set(exact.map((item) => item.value));
  if (!compared.length || values.size > 1) return { kind:"unclear" as const, evidence:compared,
    reason:values.size > 1 ? "同一来源有多个与目标指标对应的精确数值，无法确定适用口径，标为无法确认。" : "未找到主体、指标、年份和单位绑定的原始证据句，不从不同段落拼接数字。" };
  const first=compared[0];
  return {kind:first.relation,evidence:compared,reason:first.approximate
    ? `原句使用近似表述（绑定数值为${first.value}${first.unit}），不能证明严格「${op}${threshold}${unit}」。`
    : `同一证据句中，${first.year}年${first.subject}${first.metric}为${first.value}${first.unit}，按${first.statisticalSource}口径，${first.relation === "supports" ? "符合" : "不符合"}「${op}${threshold}${unit}」。`};
}

export function parseDate(value: string): Date | null {
  if (!value) return null;
  const text = value.normalize("NFKC").trim();
  const iso = text.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const yearMonth = text.match(/(\d{4})[-/年.](\d{1,2})/);
  if (yearMonth) {
    const d = new Date(Date.UTC(Number(yearMonth[1]), Number(yearMonth[2]) - 1, 1));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** 解析「最近一年」「2024年」「近30天」等时间范围描述；无法解析返回 null（不改写成猜测值）。 */
export function parseTimeScope(scope?: string): { from: Date; to: Date } | null {
  if (!scope) return null;
  const now = new Date();
  const year = scope.match(/(\d{4})\s*年/);
  if (year) {
    const y = Number(year[1]);
    return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y, 11, 31, 23, 59, 59)) };
  }
  if (/最近一年|近一年|过去一年/.test(scope))
    return { from: new Date(now.getTime() - 365 * 864e5), to: now };
  if (/最近半年|近半年/.test(scope))
    return { from: new Date(now.getTime() - 182 * 864e5), to: now };
  if (/最近三个月|近三个月/.test(scope))
    return { from: new Date(now.getTime() - 91 * 864e5), to: now };
  return null;
}

function registrableHost(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    // 常见双后缀（com.cn / gov.cn / edu.cn / net.cn / org.cn）
    if (/^(com|gov|edu|net|org|ac)$/.test(parts[parts.length - 2])) return parts.slice(-3).join(".");
    return parts.slice(-2).join(".");
  } catch {
    return "";
  }
}

function shingles(text: string, size = 24) {
  const normalized = text.replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i + size <= normalized.length; i += size) out.add(normalized.slice(i, i + size));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared++;
  return shared / (a.size + b.size - shared);
}

/** 包含度：短的一方有多少比例出现在长的一方里（转载常常是删节版）。 */
function containment(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const value of small) if (big.has(value)) shared++;
  return shared / small.size;
}

/** 标题归一化：去掉站点后缀、标点、空白，全角转半角，便于判断"是不是同一篇的标题"。 */
export function normalizeTitle(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[_|｜—–-]{2,}\s*[^_|｜—–-]{1,12}$/u, "")
    .replace(/[_|｜]+\s*[^_|｜]{1,14}\s*$/u, "")
    .replace(/[\s\u00a0]/g, "")
    .replace(/[，。、；：""''《》〈〉【】\[\]（）()!？?…·,.;:!]/g, "")
    .toLowerCase();
}

/** 标题相似度：二元字符片段的 Jaccard，比整串相等更能容忍"我国/国内"这类改写。 */
function titleSimilarity(a: string, b: string) {
  const grams = (value: string) => {
    const text = normalizeTitle(value);
    const out = new Set<string>();
    for (let i = 0; i + 2 <= text.length; i++) out.add(text.slice(i, i + 2));
    return out;
  };
  return jaccard(grams(a), grams(b));
}

/** 去掉查询串与锚点，并还原 big5/镜像网关包装，得到"内容地址"。 */
export function canonicalUrl(value: string) {
  let text = value.trim();
  const gate = text.match(/gate\/big5\/(.+)$/i);
  if (gate) text = "https://" + gate[1].replace(/^https?:\/\//i, "");
  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^(big5|m|wap|3g)\./i, "").replace(/^www\./i, "").toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");
    return host + path;
  } catch {
    return text.split("?")[0].split("#")[0].replace(/\/+$/, "");
  }
}

/** 文章编号：同一篇文章被挂到不同栏目时，路径里的编号通常不变。 */
export function articleKey(value: string) {
  const text = value.split("?")[0];
  const patterns = [
    /(t\d{8}_\d{5,})/,
    /(content_\d{5,})/,
    /(article\/\d{5,})/,
    /(art_[0-9a-f]{12,})/,
    /(detail_\d{6,})/,
    /(c\d{6,}-\d{4,})/,
    /(c\d{4}-\d{2}-\d{2}\/\d{4,})/,
    /(article\/\d+)/,
    // 文件名里的长数字编号（很多站点用 /n/1234567.html 这种形式）
    /\/(\d{5,})\.html?$/,
  ];
  for (const pattern of patterns) {
    const hit = text.match(pattern);
    if (hit) return hit[1];
  }
  const query = value.match(/[?&](?:aid|item_id|articleId|id)=(\d{5,}|[0-9a-f]{16,})/i);
  return query ? query[1] : "";
}

/** 二元片段相似度：判断两段摘要是否"几乎逐字一致"。 */
function similarity2(a: string, b: string) {
  const grams = (text: string) => {
    const out = new Set<string>();
    for (let i = 0; i + 2 <= text.length; i++) out.add(text.slice(i, i + 2));
    return out;
  };
  return jaccard(grams(a), grams(b));
}

/** 正文比对用 5 字片段：比 24 字分片更能识别"删节/改标题"后的转载。 */
function bodyGrams(text: string) {
  const normalized = text.replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i + 5 <= normalized.length; i += 5) out.add(normalized.slice(i, i + 5));
  return out;
}

/**
 * 识别来源明确引用的原始数据出处（例：据中国汽车工业协会发布的数据…）。
 * 只认"机构名 + 发布/公布/统计/数据"这种显式表述，不做语义猜测。
 */
export function citedOriginOf(text: string): { org: string; quote: string } | null {
  if (!text) return null;
  const match = text.match(
    /(?:据|根据|来自)?\s*([\u4e00-\u9fa5]{2,12}(?:统计局|局|部|委|署|协会|研究院|研究中心|中心|银行|联合会))\s*(?:发布|公布|披露|统计|数据|通报|测算)/,
  );
  if (!match) return null;
  const org = match[1].replace(/^(据|根据|来自)/, "");
  if (org.length < 3) return null;
  return { org, quote: match[0].slice(0, 40).trim() };
}

export interface SourceGrouping {
  /** pageId → clusterId */
  clusterOf: Map<string, string>;
  /** pageId → 被并到哪一条、依据是什么 */
  duplicateOf: Map<string, { primary: string; basis: string }>;
  /** 可能是转载但证据不足，独立性未确认 */
  unconfirmed: Set<string>;
  /** 未确认的原因（展示用） */
  unconfirmedReason: Map<string, string>;
  /** clusterId → 判定依据 */
  clusterBasis: Map<string, string>;
  /** pageId → 明确引用的原始出处 */
  originOf: Map<string, { org: string; quote: string }>;
  /** 被两个以上来源共同引用的原始出处 */
  sharedOrigins: Map<string, string[]>;
}

/**
 * 同源/转载分组：只用「可指认的证据」合并，证据不足就标为独立性未确认。
 *
 * 合并依据（任一成立即可，且必须写得出理由）：
 *  1. same_url          归一化后是同一个地址（含 big5/镜像网关还原）
 *  2. same_article_id   路径或查询串里是同一个文章编号
 *  3. same_headline     去掉站点后缀与标点后标题完全一致（≥12 字）
 *  4. near_headline     标题几乎一致（≥0.86）且发布日相同
 *  5. body_reprint      两边正文高度重合（包含度 ≥0.7 或 Jaccard ≥0.55）
 * 不算合并、但记「独立性未确认」：
 *  - 标题相似 0.7–0.86；或正文包含度 0.4–0.7；或摘要开头相同但其余不同
 */
export function groupSources(
  pages: AnalysablePage[],
  bodies?: Map<string, BodyEvidence>,
): SourceGrouping {
  const parent = pages.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const basisByRoot = new Map<number, Set<string>>();
  const unconfirmedPairs: { a: number; b: number; reason: string }[] = [];
  const canonical = pages.map((page) => canonicalUrl(page.url));
  const keys = pages.map((page) => articleKey(page.url));
  const titles = pages.map((page) => normalizeTitle(page.title));
  const originOf = new Map<string, { org: string; quote: string }>();
  for (const page of pages) {
    const body = bodies?.get(page.id);
    const text = body?.ok && body.text.length > 200 ? body.text.slice(0, 4000) : `${page.title} ${page.passage}`;
    const origin = citedOriginOf(text);
    if (origin) originOf.set(page.id, origin);
  }
  const bodies5 = pages.map((page) => {
    const body = bodies?.get(page.id);
    return body?.ok && body.text.length >= 400 ? bodyGrams(body.text) : null;
  });
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const reasons: string[] = [];
      const sameHost =
        registrableHost(pages[i].url) !== "" && registrableHost(pages[i].url) === registrableHost(pages[j].url);
      if (canonical[i] && canonical[i] === canonical[j]) reasons.push("同一网址（含镜像地址还原）");
      // 文章编号只在同一发布方内可比：不同网站的编号体系互不相干
      if (keys[i] && keys[i] === keys[j]) {
        if (sameHost) reasons.push(`同一发布方的同一文章编号 ${keys[i]}`);
        else
          unconfirmedPairs.push({
            a: i,
            b: j,
            reason: `不同网站出现相同文章编号（${keys[i]}），无法确认是否为同一篇，需人工核对`,
          });
      }

      const titleSim = titleSimilarity(pages[i].title, pages[j].title);
      const sameTitle = titles[i].length >= 12 && titles[i] === titles[j];
      // 同标题只是同源线索：没有正文/编号/转载声明可核对时，标为独立性未确认
      if (sameTitle)
        unconfirmedPairs.push({
          a: i,
          b: j,
          reason: "不同网站标题完全一致，但没有正文、文章编号或转载声明可核对",
        });
      else if (
        titleSim >= 0.86 &&
        pages[i].date &&
        pages[j].date &&
        pages[i].date.slice(0, 10) === pages[j].date.slice(0, 10)
      )
        unconfirmedPairs.push({
          a: i,
          b: j,
          reason: `不同网站标题几乎一致（${(titleSim * 100).toFixed(0)}%）且同日，但没有正文或转载关系可核对`,
        });

      // 摘要或正文逐字一致，本身就是可指认的依据（同一篇通稿被多家转载）
      const passageA = pages[i].passage.replace(/\s+/g, "");
      const passageB = pages[j].passage.replace(/\s+/g, "");
      if (passageA.length >= 30 && passageA === passageB) reasons.push("搜索摘要逐字一致（同一篇通稿）");
      else if (passageA.length >= 60 && passageB.length >= 60) {
        const snippetSim = similarity2(passageA, passageB);
        if (snippetSim >= 0.92) reasons.push(`搜索摘要几乎逐字一致（${(snippetSim * 100).toFixed(0)}%）`);
        else if (snippetSim >= 0.75)
          unconfirmedPairs.push({ a: i, b: j, reason: `搜索摘要高度相似（${(snippetSim * 100).toFixed(0)}%），但没有正文或文章编号可核对` });
      }

      // 两边都取到正文时，用正文重合度判断（转载常见删节版，所以看包含度）
      const bodyI = bodies5[i];
      const bodyJ = bodies5[j];
      if (bodyI && bodyJ) {
        const contain = containment(bodyI, bodyJ);
        const jac = jaccard(bodyI, bodyJ);
        if (contain >= 0.7 || jac >= 0.55)
          reasons.push(`正文高度重合（包含度 ${(contain * 100).toFixed(0)}%／相似度 ${(jac * 100).toFixed(0)}%）`);
        else if (contain >= 0.4)
          unconfirmedPairs.push({ a: i, b: j, reason: `正文部分重合（包含度 ${(contain * 100).toFixed(0)}%），不足以判定转载` });
      }

      if (reasons.length) {
        union(i, j);
        const root = find(i);
        // 同一簇里的依据去重，避免同一句理由重复堆叠
        const bucket = basisByRoot.get(root) || new Set<string>();
        for (const reason of reasons) bucket.add(reason);
        basisByRoot.set(root, bucket);
        continue;
      }
      // 没有可指认依据：只在"像但不够"时标记独立性未确认
      const prefixA = pages[i].passage.slice(0, 120).replace(/\s+/g, "");
      const prefixB = pages[j].passage.slice(0, 120).replace(/\s+/g, "");
      if (prefixA.length >= 30 && prefixA === prefixB)
        unconfirmedPairs.push({ a: i, b: j, reason: "摘要开头相同但后续内容不同" });
      else if (titleSim >= 0.65 && titles[i].length >= 10 && titles[j].length >= 10)
        unconfirmedPairs.push({ a: i, b: j, reason: `标题相似（${(titleSim * 100).toFixed(0)}%），但没有正文或文章编号可核对` });
    }
  }

  const clusterOf = new Map<string, string>();
  const groups = new Map<number, AnalysablePage[]>();
  pages.forEach((page, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) || []), page]);
  });
  const clusterBasis = new Map<string, string>();
  let n = 0;
  for (const [root, list] of groups) {
    n++;
    const cid = "cluster-" + n;
    for (const page of list) clusterOf.set(page.id, cid);
    if (list.length > 1)
      clusterBasis.set(cid, [...(basisByRoot.get(root) || new Set<string>())].slice(0, 3).join("；") || "内容重合");
  }

  // 被并掉的页面记下并到哪一条
  const duplicateOf = new Map<string, { primary: string; basis: string }>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const ranked = [...list].sort(
      (a, b) =>
        Number(bodies?.get(b.id)?.ok === true) - Number(bodies?.get(a.id)?.ok === true) ||
        (b.score || 0) - (a.score || 0),
    );
    const primary = ranked[0];
    for (const page of ranked.slice(1))
      duplicateOf.set(page.id, {
        primary: primary.id,
        basis: clusterBasis.get(clusterOf.get(page.id) || "") || "内容重合",
      });
  }

  // 未确认：只标记仍然留在不同簇里的页面
  const unconfirmed = new Set<string>();
  const unconfirmedReason = new Map<string, string>();
  for (const pair of unconfirmedPairs) {
    const a = pages[pair.a], b = pages[pair.b];
    if (clusterOf.get(a.id) === clusterOf.get(b.id)) continue;
    for (const page of [a, b]) {
      unconfirmed.add(page.id);
      if (!unconfirmedReason.has(page.id)) unconfirmedReason.set(page.id, pair.reason);
    }
  }

  const sharedOrigins = new Map<string, string[]>();
  for (const [pageId, origin] of originOf) {
    sharedOrigins.set(origin.org, [...(sharedOrigins.get(origin.org) || []), pageId]);
  }
  for (const [org, ids] of [...sharedOrigins])
    if (ids.length < 2) sharedOrigins.delete(org);

  return { clusterOf, duplicateOf, unconfirmed, unconfirmedReason, clusterBasis, originOf, sharedOrigins };
}

/** 兼容旧调用：只取簇映射（测试与简单用途）。 */
export function clusterSources(pages: AnalysablePage[]) {
  return groupSources(pages).clusterOf;
}

/**
 * 说法与证据的范围/状态一致性检查。
 * 只在能指认的差异上返回 incompatible：说法要求"全国建成"，证据只写"某条干线投运"这类。
 */
export function scopeCompatibility(claim: string, evidence: string) {
  const notes: string[] = [];
  const has = (text: string, pattern: RegExp) => pattern.test(text);
  const nationwide = has(claim, /全国|覆盖全国|全网|全国范围/);
  // 必须出现"覆盖全国"这类范围表述才算覆盖整体；"全国领先/全国第一"不是范围证据。
  const coversNation = has(
    evidence,
    /覆盖全国|全国范围|全国网络|全国主要干线|遍布全国|全国已建成|已建成全国|全国建成|全国实现|全国各省|联通全国/,
  );
  if (nationwide && !coversNation) notes.push("说法要求「全国范围」，证据只写到局部干线/区域；「全国领先」这类措辞不构成覆盖范围");
  const completed = has(claim, /已建成|建成|已完成|已经建成|全面完成/);
  const partial = has(evidence, /投运|贯通|开建|开工建设|在建|试点|示范|规划|计划|预计|将建成/) && !has(evidence, /已建成|全面建成|全线建成/);
  if (completed && partial) notes.push("说法是「已经建成」，证据是可指认的投运/在建/规划状态");
  const claimYears = [...claim.matchAll(/(19|20)\d{2}/g)].map((m) => m[0]);
  const evidenceYears = [...evidence.matchAll(/(19|20)\d{2}/g)].map((m) => m[0]);
  if (claimYears.length && evidenceYears.length && !claimYears.some((year) => evidenceYears.includes(year)))
    notes.push(`说法指向 ${claimYears[0]} 年，证据写的是 ${evidenceYears[0]} 年`);
  return { compatible: notes.length === 0, note: notes.join("；") };
}

const DATE_PATTERN = /((?:19|20)\d{2})年(\d{1,2})月(\d{1,2})日/g;
const normalizedDateText = (text: string) => text.normalize("NFKC").replace(/[個護屆國華過佈會實於]/g,
  (s) => ({"個":"个","護":"护","屆":"届","國":"国","華":"华","過":"过","佈":"布","會":"会","實":"实","於":"于"}[s] || s));

/**
 * 抽出「日期 + 它在这句话里承担的动作」，用来区分通过日与施行日。
 * 例：`2020年5月28日通过，自2021年1月1日起施行` → 2020-05-28:通过 / 2021-01-01:施行
 */
export function dateRoles(text: string) {
  text = normalizedDateText(text);
  const roles = new Map<string, Set<string>>();
  const push = (date: string, role: string) => {
    const set = roles.get(date) || new Set<string>();
    set.add(role);
    roles.set(date, set);
  };
  for (const match of text.matchAll(DATE_PATTERN)) {
    const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    // Stop at another full date or sentence/paragraph, and use the first action.
    // A long law/committee name is allowed; another date's action is not.
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 100)
      .split(/(?:19|20)\d{2}年\d{1,2}月\d{1,2}日|[。；;\n\r！？]/)[0];
    const action = after.match(/施行|实施|生效|起适用|通过|表决|审议|公布|发布|签署|颁布|公告/)?.[0];
    if (action && /施行|实施|生效|起适用/.test(action)) push(date, "effect");
    else if (action && /通过|表决|审议/.test(action)) push(date, "adopt");
    else if (action) push(date, "publish");
    else push(date, "unknown");
  }
  // 「自2021年1月1日起施行」的日期在动词之前，补一次前置判断
  for (const match of text.matchAll(/(?:自|于)?\s*((?:19|20)\d{2})年(\d{1,2})月(\d{1,2})日\s*(?:起)?\s*(施行|实施|生效)/g)) {
    push(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`, "effect");
  }
  return roles;
}

/**
 * 日期角色冲突：说法要求「某日施行」，但来源把该日写成"通过/公布"，施行日是另一个日期。
 * 这类证据不是支持，而是反证 —— 不能因为都出现同一个日期就算说对了。
 */
export function dateRoleConflict(claim: string, evidence: string) {
  const claimRoles = dateRoles(claim);
  if (!claimRoles.size) return null;
  const evidenceRoles = dateRoles(evidence);
  if (!evidenceRoles.size) return null;
  for (const [date, roles] of claimRoles) {
    if (!roles.has("effect")) continue;
    const seen = evidenceRoles.get(date);
    // 只有来源明确把这一天写成"施行/生效"才算同一事实；写成时间戳或无动作都不算。
    if (seen?.has("effect")) continue;
    const otherEffect = [...evidenceRoles.entries()].find(([other, otherRoles]) => other !== date && otherRoles.has("effect"));
    const adopted = seen?.has("adopt");
    if (otherEffect) {
      return {
        date,
        note: `来源明确的施行日期是 ${otherEffect[0]}，与待核查日期 ${date} 不同${adopted ? "；待核查日期在来源中是通过日" : ""}`,
        effectDate: otherEffect?.[0] || null,
      };
    }
  }
  return null;
}

/** Bind a dated legal assertion to the same law and a quoted action. */
function datedLawDecision(claim: string, page: AnalysablePage, body: string) {
  const target = [...dateRoles(claim)].find(([, roles]) => roles.has("effect"))?.[0];
  if (!target) return null;
  const law = normalizedDateText(claim.match(/《([^》]+)》/)?.[1] || "").replace(/^中华人民共和国/, "");
  const titleLaw = normalizedDateText(page.title).split(/[_|\-]/)[0].trim().replace(/^中华人民共和国/, "");
  const collect = (text: string, from: "body" | "excerpt") => {
    const found: {date:string; roles:Set<string>; sentence:string; from:"body"|"excerpt"}[] = [];
    if (!law) return found;
    for (const sentence of text.split(/\n+/).flatMap(sentences)) {
      const normalized = normalizedDateText(sentence);
      const books = [...normalized.matchAll(/《([^》]+)》/g)].map((m) => m[1].replace(/^中华人民共和国/, ""));
      if (books.some((name) => name !== law)) continue;
      if (!normalized.includes(law) && !(titleLaw === law && (/本法/.test(normalized) || /^[（(](?:19|20)\d{2}年/.test(normalized)))) continue;
      for (const match of normalized.matchAll(DATE_PATTERN)) {
        const before = normalized.slice(0, match.index);
        const after = normalized.slice(match.index! + match[0].length, match.index! + match[0].length + 100)
          .split(/(?:19|20)\d{2}年\d{1,2}月\d{1,2}日|[。；;\n\r！？]/)[0];
        const legalNames = (text: string) => [...text.matchAll(/《([^》]+)》|([\p{Script=Han}]{1,40}?(?:法典|条例|规定|法))/gu)]
          .map((item) => (item[1] || item[2]).replace(/^中华人民共和国/, ""));
        const preceding = legalNames(before).at(-1);
        const actionAt = after.search(/施行|实施|生效|起适用|通过|表决|审议|公布|发布|签署|颁布|公告/);
        const following = legalNames(actionAt < 0 ? after : after.slice(0, actionAt));
        if (preceding && !preceding.endsWith(law) && !preceding.endsWith("本法") || following.some((name) => !name.endsWith(law) && !name.endsWith("本法"))) continue;
        const [date, roles] = [...dateRoles(match[0] + after)][0];
        if (![...roles].some((role) => role !== "unknown")) continue;
        const adoptionHeader = sentence.match(/^[（(][^）)]{1,160}(?:通过|通過)[）)]/)?.[0];
        found.push({date,roles,sentence:adoptionHeader || sentence,from});
      }
    }
    return found;
  };
  const originals = collect(body, "body");
  const found = originals.length ? originals : collect(page.passage, "excerpt");
  const effects = found.filter((item) => item.roles.has("effect"));
  const dates = new Set(effects.map((item) => item.date));
  const proof = effects.find((item) => item.date !== target) || effects[0] || found.find((item) => item.date === target);
  const relation: Relation = dates.size > 1 ? "unclear" : effects.length
    ? effects[0].date === target ? "supports" : "contradicts" : "unclear";
  const reason = dates.size > 1 ? "同一法律出现多个施行日期，尚不能确定适用版本，不自动裁决。"
    : effects.length ? `同一法律的原句明确施行日期为${effects[0].date}，${relation === "supports" ? "与待核查日期一致" : `与待核查日期${target}不同`}。`
    : proof ? "该摘录只说明通过或公布日期，不能据此确认施行日期，也不能用关键词重合判为支持。"
    : "没有找到同一法律、完整日期与施行动作绑定的原句，保持无法确认。";
  return {relation,reason,proof};
}

export interface AssessOptions {
  fact: TraceFact;
  pages: AnalysablePage[];
  bodies: Map<string, BodyEvidence>;
  clusterOf: Map<string, string>;
  duplicatePages: Set<string>;
  /** 同源分组明细（有则用于写"为什么算/不算独立证据"） */
  grouping?: SourceGrouping;
}

/** 单条来源对单条事实的关系判定；每个判断都带可复查的理由。 */
export function assessSource(
  page: AnalysablePage,
  options: AssessOptions,
): SourceAssessment {
  const factTerms = terms(options.fact.text);
  const scored = page.title + " " + page.passage;
  const relevance = coverage(scored, factTerms);
  const body = options.bodies.get(page.id);
  const reasons: string[] = [];
  let relation: Relation = "unclear";
  let semantic: SourceAssessment["semantic"] | undefined;

  const bodyText = body?.ok ? body.text : "";
  const bodyRelevance = body?.ok ? coverage(bodyText, factTerms) : 0;
  const negation = negationNear(scored, factTerms);
  // 只有"数量断言"参与数值比对：年份/月/日不算证据，出现"2025年"不代表说对了产量。
  const factQuantities = quantities(options.fact.text);
  const bodyQuantities = factQuantities.length ? quantityEvidenceFor(options.fact, page, bodyText, "body") : [];
  const excerptQuantities = factQuantities.length ? quantityEvidenceFor(options.fact, page, page.passage, "excerpt") : [];
  const bound = compareBoundQuantity(options.fact.text, bodyQuantities.length ? bodyQuantities : excerptQuantities);
  // 没有绑定到同一句时，退一步用「页面里出现过这个数」的旧比对：
  // 只用来识别「来源到底在说什么」，不会因为这一步就把结论判成支持。
  const looseNumeric =
    factQuantities.length && !bound.kind
      ? compareQuantities(options.fact.text, factQuantities, quantities(`${scored} ${bodyText}`))
      : null;
  const numeric = {
    ...bound,
    kind: factQuantities.length ? bound.kind || looseNumeric?.kind || null : null,
    exact: bound.kind ? true : looseNumeric?.exact ?? true,
    reason: bound.kind ? bound.reason : looseNumeric?.reason || bound.reason,
  };
  const dated = !factQuantities.length ? datedLawDecision(options.fact.text, page, bodyText) : null;
  let dateConflict: ReturnType<typeof dateRoleConflict> = null;
  // 同一表述片段：汉字三元片段命中，才认为来源真的在讲这件事（二元词重合太松）。
  const factFragments = fragments(options.fact.text);
  const sharedFragment = factFragments.find((fragment) => (scored + " " + bodyText).includes(fragment));

  if (factQuantities.length && bound.kind) {
    // 数量句绑定成功：只按这一句判断，不从别处拼数字；但明确否定（「说法不实」「并非…」）优先。
    if (negation && bound.kind === "supports") {
      relation = "contradicts";
      reasons.push(`命中事实关键词，但邻近出现否定表述「${negation}」。`);
    } else {
      relation = bound.kind;
      reasons.push(numeric.reason);
    }
  } else if (factQuantities.length) {
    // 没有绑定到「主体+指标+年份+单位」的同一句：不能凭空判 none，
    // 继续走同一表述片段/关键词路径，并在理由里说明数值没有绑定成功。
    reasons.push(`未找到主体、指标、年份和单位绑定的原始证据句；${numeric.reason || "仅按关键词与表述片段判断"}`);
    if (numeric.kind === "supports" && (numeric.exact || sharedFragment)) {
      relation = "supports";
      reasons.push(numeric.reason);
    } else if (numeric.kind === "contradicts") {
      relation = "contradicts";
      reasons.push(numeric.reason);
    } else if (dated) {
      relation = dated.relation;
      reasons.push(dated.reason);
    } else if (relevance >= 0.6 && sharedFragment) {
      relation = "supports";
      reasons.push(`关键词重合度 ${(relevance * 100).toFixed(0)}%，且出现同一表述片段「${sharedFragment}」，未发现否定表述。`);
    } else if (negation) {
      relation = "contradicts";
      reasons.push(`命中事实关键词，但邻近出现否定表述「${negation}」。`);
    } else if (relevance < 0.12) {
      relation = "irrelevant";
      reasons.push(`与该事实几乎无关（关键词重合度 ${(relevance * 100).toFixed(0)}%）。`);
    }
  } else if (dated) {
    relation = dated.relation;
    reasons.push(dated.reason);
  } else if (relevance < 0.12) {
    relation = "irrelevant";
    reasons.push(
      `与该事实几乎无关（关键词重合度 ${(relevance * 100).toFixed(0)}%），仅作为检索命中记录保留，不参与判断。`,
    );
  } else if (relevance < 0.34) {
    reasons.push(`与事实主题的关键词重合度仅 ${(relevance * 100).toFixed(0)}%，不足以作为该事实的依据。`);
  } else if (negation) {
    relation = "contradicts";
    reasons.push(`命中事实关键词，但邻近出现否定表述「${negation}」。`);
  } else if ((dateConflict = dateRoleConflict(options.fact.text, `${scored} ${bodyText}`))) {
    relation = "contradicts";
    reasons.push(`日期角色不符：${dateConflict.note}。` + "该日期在本来源里不是施行日，不能作为支持依据。");
  } else if (numeric.kind === "contradicts") {
    relation = "contradicts";
    reasons.push(`关键词重合度 ${(relevance * 100).toFixed(0)}%，${numeric.reason}`);
  } else if (numeric.kind === "supports" && (numeric.exact || sharedFragment)) {
    relation = "supports";
    reasons.push(
      `关键词重合度 ${(relevance * 100).toFixed(0)}%，${numeric.reason}${
        sharedFragment ? `同一表述片段「${sharedFragment}」。` : ""
      }`,
    );
  } else if (numeric.kind === "supports") {
    reasons.push(
      `关键词重合度 ${(relevance * 100).toFixed(0)}%，${numeric.reason}但未出现事实中的同一表述片段，仅记为相关而非支持。`,
    );
  } else if (numeric.kind === "unclear" && relevance >= 0.6) {
    reasons.push(`关键词重合度 ${(relevance * 100).toFixed(0)}%。${numeric.reason}`);
  } else if (relevance >= 0.6 && sharedFragment) {
    relation = "supports";
    reasons.push(
      `关键词重合度 ${(relevance * 100).toFixed(0)}%，且出现同一表述片段「${sharedFragment}」，未发现否定表述。`,
    );
  } else if (relevance >= 0.6) {
    reasons.push(
      `关键词重合度 ${(relevance * 100).toFixed(0)}%，但未出现事实中的同一表述片段，仅记为相关而非支持。`,
    );
  } else {
    reasons.push(`关键词重合度 ${(relevance * 100).toFixed(0)}%，介于相关与无关之间，仅记为不确定。`);
  }

  // 语义层：说法带可识别谓词（停产/延长寿命…）时，用「主体+行为+型号+限定+因果」判断，
  // 而不是靠关键词覆盖率。法律日期、统计数字这类没有谓词的说法继续走原规则。
  const claimSemantics: ClaimSemantics = parseClaim(options.fact.text);
  if (claimSemantics.predicate) {
    // 标题只是索引信息，不是「一句原始表述」：正文和摘要都没有时才退回到标题。
    // 否则页面标题（「暑运服务台 | 充电宝禁止登机怎么办」）会被当成证据句显示给用户。
    const prose = [body?.ok ? body.text : "", page.passage].filter(Boolean).join("。");
    // 标题只是索引信息：没有任何正文/摘要时才退回标题，并标记出来——
    // 这样判定仍然保守，但页面标题不会被当成「原句」展示给用户。
    const pool = prose || page.title;
    const sentences = pool
      .split(/[。！？!?\n]/)
      .map((item) => item.trim())
      // 搜索摘要里常带播放器文字（「不支持的音频/视频格式 请试试刷新 重播」），不是表述内容。
      .filter((item) => item.length >= 6 && !/不支持的音频|点击按住可拖动|进入全屏|请试试刷新/.test(item));
    const rank: Record<string, number> = {
      direct_support: 4,
      direct_refute: 3,
      partial: 2,
      related_only: 1,
      unrelated: 0,
    };
    let best: { verdict: SentenceVerdict; sentence: string } | null = null;
    let bestScore = -1;
    const supports: string[] = [];
    const refutes: string[] = [];
    for (const sentence of sentences) {
      const verdict = compareSentence(claimSemantics, sentence);
      if (verdict.verdict === "direct_support") supports.push(sentence);
      if (verdict.verdict === "direct_refute") refutes.push(sentence);
      // 同一档里优先选真正写出该行为的句子：「禁止携带…充电宝」比一句顺带提到的
      // 「同时…严禁放入行李托运」更能解释判定结果。
      const score = rank[verdict.verdict] * 10 + (sentence.includes(claimSemantics.predicate) ? 1 : 0);
      if (!best || score > bestScore) {
        best = { verdict, sentence };
        bestScore = score;
      }
    }
    // 同一页面既有支持也有反驳：不能因为支持分高就直接算支持，要如实标成冲突。
    if (supports.length && refutes.length && best) {
      best = {
        verdict: {
          verdict: "partial",
          reason: `同一页面既有支持（${supports[0].slice(0, 40)}）也有反驳（${refutes[0].slice(0, 40)}），不能据此定案`,
          sufficient: false,
        },
        sentence: supports[0],
      };
    }
    if (best && !prose) {
      // 只有标题、没有正文或摘要原句：标题不能当作证据句，最多算相关。
      if (best.verdict.verdict === "direct_support" || best.verdict.verdict === "direct_refute") {
        best = {
          verdict: { verdict: "partial", reason: "只在页面标题里出现相关字样，没有正文或摘要原句，不能算作依据", sufficient: false },
          sentence: best.sentence,
        };
      }
    }
    if (best) {
      // 因果类说法：媒体把同一句话再讲一遍不算证据，必须有研究/数据/官方表述支撑。
      if (
        best.verdict.verdict === "direct_support" &&
        claimSemantics.nature === "causation" &&
        !/(研究|论文|期刊|报告|数据|试验|调查|统计|官方)/.test(best.sentence)
      ) {
        best = {
          verdict: { verdict: "partial", reason: "来源只是复述同一说法，没有给出研究或数据依据", sufficient: false },
          sentence: best.sentence,
        };
      }
      semantic = {
        verdict: best.verdict.verdict,
        reason: best.verdict.reason,
        sentence: best.sentence.slice(0, 160),
        ...(prose ? {} : { fromTitle: true }),
      };
      relation =
        best.verdict.verdict === "direct_support"
          ? "supports"
          : best.verdict.verdict === "direct_refute"
            ? "contradicts"
            : "unclear";
      reasons.unshift(`语义判断：${best.verdict.reason}。`);
      if (best.sentence) reasons.unshift(`对应原句：${best.sentence.slice(0, 120)}`);
    }
  }

  const reprintMarkers = body?.ok ? body.reprintMarkers : [];
  let originality: SourceAssessment["originality"] = "unknown";
  if (body?.ok) {
    if (reprintMarkers.length) {
      originality = "reprint";
      reasons.push(`原文正文含二次传播标记（${reprintMarkers.slice(0, 3).join("、")}），不是本文原创出处。`);
    } else if (bodyRelevance >= 0.34) {
      originality = "original_candidate";
      reasons.push("原文可访问，正文包含该事实相关表述，未发现转载标记。");
    } else {
      reasons.push("原文可访问，但正文中未找到与该事实相关的表述（摘要可能在页面其他位置或已变更）。");
    }
  } else {
    reasons.push(body?.text ? "原文抓取失败，只能依据搜索摘要判断。" : "未取得原文正文，只能依据搜索摘要判断。");
  }

  const scope = parseTimeScope(options.fact.timeScope);
  let dateStatus: SourceAssessment["dateStatus"] = "unknown";
  let dateNote = page.date ? `来源标注时间 ${page.date}。` : "来源未提供发布时间。";
  const published = parseDate(page.date);
  // 区分两种时间要求：
  //  期间型（如「2024年」）说的是事实讲的哪段时间，看内容是否涉及该期间，不看发布日；
  //  时效型（如「最近一年」）说的是信息新鲜度，才用发布时间判断。
  const periodYear = options.fact.timeScope?.match(/(\d{4})\s*年/)?.[1];
  const freshness = /最近|近半年|近三个月|现行|当前|目前/.test(options.fact.timeScope || "");
  if (scope && periodYear && !freshness) {
    const mentioned =
      (scored + " " + bodyText).includes(periodYear) ||
      (published !== null && published.getUTCFullYear() === Number(periodYear));
    dateStatus = mentioned ? "in_range" : "out_of_range";
    dateNote += mentioned
      ? ` 来源涉及事实所指期间（${periodYear}年）。`
      : ` 来源未涉及事实所指期间（${periodYear}年）。`;
  } else if (scope && published) {
    dateStatus = published >= scope.from && published <= scope.to ? "in_range" : "out_of_range";
    dateNote += dateStatus === "in_range" ? " 发布时间落在时效要求内。" : " 发布时间早于时效要求，可能已过期。";
  } else if (scope && !published) {
    dateNote += " 事实限定了时间要求，但该来源没有可用发布时间，无法确认时效。";
  }

  // ── 正文质量与证据句 ─────────────────────────────────────
  // 区分四件事：请求成功 / 正文抓到了 / 正文是样板 / 找到与该说法直接相关的句子。
  const cleanedBody = bodyText.replace(/\s+/g, " ").trim();
  const substance = cleanedBody.replace(/[\s\d\p{P}]/gu, "").length;
  const bodyKeySentence = factQuantities.length ? numeric.evidence.find((item) => item.from === "body")?.sentence || null : dated ? dated.proof?.from === "body" ? dated.proof.sentence : null : body?.ok && substance >= 20
    ? keySentenceFor({
        factText: options.fact.text,
        text: cleanedBody,
        factTerms,
        quantities: factQuantities,
      })
    : null;
  const passageKeySentence = factQuantities.length ? numeric.evidence.find((item) => item.from === "excerpt")?.sentence || null : dated ? dated.proof?.from === "excerpt" ? dated.proof.sentence : null : keySentenceFor({
    factText: options.fact.text,
    text: page.passage,
    factTerms,
    quantities: factQuantities,
  });
  let bodyStatus: SourceAssessment["bodyStatus"];
  if (!body?.ok) bodyStatus = "fetch_failed";
  else if (substance < 20) bodyStatus = "boilerplate_only";
  else if (bodyKeySentence) bodyStatus = "evidence_sentence";
  else bodyStatus = "main_without_match";
  const keySentenceFrom: SourceAssessment["keySentenceFrom"] =
    bodyStatus === "evidence_sentence" ? "body" : passageKeySentence ? "excerpt" : null;
  const keySentence = bodyStatus === "evidence_sentence" ? bodyKeySentence : passageKeySentence;

  // ── 范围/状态一致性：局部投运不能证明"全国已建成" ────────────
  const scopeCheck = scopeCompatibility(options.fact.text, cleanedBody || `${page.title} ${page.passage}`);
  if (!scopeCheck.compatible)
    reasons.push(`与完整说法存在范围差异：${scopeCheck.note}（该证据只能支持它写到的范围/状态）。`);

  if (options.fact.subjectScope) {
    const subjectTerms = terms(options.fact.subjectScope);
    if (subjectTerms.length && coverage(scored + " " + bodyText, subjectTerms) === 0)
      reasons.push(`未出现事实限定的主体/地区（${options.fact.subjectScope}），适用性存疑。`);
    else if (subjectTerms.length) reasons.push(`出现事实限定的主体/地区（${options.fact.subjectScope}）。`);
  }

  // 独立性：只把"能指认依据"的页面并成同一条；证据不足的标为未确认，且不计入独立证据。
  const duplicateOf = options.grouping?.duplicateOf.get(page.id) || null;
  const unconfirmed = options.grouping?.unconfirmed.has(page.id) === true;
  const independence: SourceAssessment["independence"] = duplicateOf
    ? "duplicate"
    : unconfirmed
      ? "unconfirmed"
      : "unique";
  if (duplicateOf) {
    const primary = options.pages.find((item) => item.id === duplicateOf.primary);
    reasons.push(
      `与「${primary?.site || duplicateOf.primary}」有同源依据（${duplicateOf.basis}），合并为一个来源簇，不重复计数。`,
    );
  } else if (unconfirmed) {
    reasons.push(
      `可能与别的来源同源（${options.grouping?.unconfirmedReason.get(page.id) || "相似度接近但证据不足"}），独立性未确认，不计入独立证据。`,
    );
  }

  return {
    sourceOrigin: page.sourceOrigin || "search",
    pageId: page.id,
    url: page.url,
    site: page.site,
    title: page.title,
    date: page.date,
    excerpt: page.passage.slice(0, 600),
    relation,
    ...(semantic ? { semantic } : {}),
    profile: sourceProfile(page.url, page.site, `${page.title} ${(body?.ok ? body.text.slice(0, 600) : page.passage).slice(0, 600)}`),
    relevance,
    reasons,
    bodyAvailable: body?.ok === true,
    bodyExcerpt:
      bodyStatus === "evidence_sentence" && bodyKeySentence
        ? bodyKeySentence
        : body?.ok
          ? excerptAround(body.text, page.passage, factTerms)
          : null,
    originality,
    reprintMarkers,
    clusterId: options.clusterOf.get(page.id) || "cluster-0",
    duplicate: duplicateOf !== null,
    independence,
    citedOrigin: options.grouping?.originOf.get(page.id) || null,
    duplicateOf: duplicateOf ? { primary: duplicateOf.primary, basis: duplicateOf.basis } : null,
    independenceNote: unconfirmed ? options.grouping?.unconfirmedReason.get(page.id) : undefined,
    bodyStatus,
    keySentence: keySentence || null,
    keySentenceFrom,
    scopeCompatible: scopeCheck.compatible,
    scopeNote: scopeCheck.note,
    quantityEvidence: numeric.evidence,
    dateStatus,
    dateNote,
  };
}

/** 把正文切成句子（保留原句，不做改写）。 */
export function sentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[。！？；])|(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);
}

/**
 * 挑出与待核查说法直接相关的那一句：优先包含事实关键词 +（数量或时间或状态词）的句子。
 * 找不到就返回 null —— 不能拿"页面有这几个字"当原文依据。
 */
export function keySentenceFor(options: {
  factText: string;
  text: string;
  factTerms: string[];
  quantities: string[];
}) {
  const { factText, text, factTerms, quantities } = options;
  const factFragments = fragments(factText);
  let best: { sentence: string; score: number } | null = null;
  for (const sentence of sentences(text)) {
    const score = coverage(sentence, factTerms);
    if (score < 0.34) continue;
    let bonus = 0;
    if (factFragments.some((fragment) => sentence.includes(fragment))) bonus += 0.3;
    if (quantities.some((quantity) => sentence.includes(quantity))) bonus += 0.2;
    if (/施行|生效|通过|发布|公布|投运|建成|贯通|产量|达到|超过|起/.test(sentence)) bonus += 0.1;
    const total = score + bonus;
    if (!best || total > best.score) best = { sentence, score: total };
  }
  return best ? best.sentence.slice(0, 400) : null;
}

function excerptAround(body: string, passage: string, factTerms: string[]) {
  const head = passage.slice(0, 40);
  const index = head ? body.indexOf(head) : -1;
  if (index >= 0) return body.slice(Math.max(0, index - 60), index + 360).replace(/\s+/g, " ").trim();
  const term = factTerms.find((t) => body.includes(t));
  if (!term) return body.slice(0, 300).replace(/\s+/g, " ").trim();
  const at = body.indexOf(term);
  return body.slice(Math.max(0, at - 80), at + 300).replace(/\s+/g, " ").trim();
}

export function assessFact(options: AssessOptions): FactAssessment {
  const sources = options.pages
    .map((page) => assessSource(page, options))
    .sort((a, b) => Number(b.relation === "supports") - Number(a.relation === "supports") || b.relevance - a.relevance);

  // 没有正面依据就不宣称独立：这里只要求"未检测到与别的来源重复"。
  const independent = (source: SourceAssessment) => source.independence === "unique";
  // 引用同一个官方出处的多篇报道属于二次解读，按 1 条独立证据计。
  const originCounts = new Map<string, number>();
  for (const source of sources) {
    const org = source.citedOrigin?.org;
    if (org) originCounts.set(org, (originCounts.get(org) || 0) + 1);
  }
  const evidenceKey = (source: SourceAssessment) => {
    const org = source.citedOrigin?.org;
    if (org && (originCounts.get(org) || 0) >= 2) return `origin:${org}`;
    return source.clusterId;
  };
  // 支持计数只认"范围一致 + 未检测到重复"的来源：局部证据即使被标为支持，也不抬高整句说法的支持度。
  const scopeExcluded = sources.filter((s) => s.relation === "supports" && s.scopeCompatible === false);
  const countedSupports = sources.filter(
    (s) => s.relation === "supports" && s.scopeCompatible !== false && s.dateStatus !== "out_of_range" && independent(s),
  );
  const supportClusters = new Set(countedSupports.map((s) => evidenceKey(s)));
  // 范围不一致的来源不能当整句的反证：只覆盖局部（一条干线、一个城市）的表述，
  // 既不能证明「全国已成」，也不能证明「全国未成」。
  const scopeExcludedOppose = sources.filter(
    (s) => s.relation === "contradicts" && s.scopeCompatible === false,
  );
  const opposeClusters = new Set(
    sources
      .filter((s) => s.relation === "contradicts" && independent(s) && s.scopeCompatible !== false)
      .map((s) => s.clusterId),
  );
  // "取得关键原文"要求：正文里真的找到了与该说法相关的句子，而不只是请求成功。
  const keySentenceSources = sources.filter((s) => s.bodyStatus === "evidence_sentence");
  const bodyBacked = new Set(
    sources
      .filter(
        (s) =>
          s.relation === "supports" &&
          s.bodyStatus === "evidence_sentence" &&
          s.scopeCompatible !== false &&
          s.dateStatus !== "out_of_range" &&
          independent(s),
      )
      .map((s) => evidenceKey(s)),
  );
  const unconfirmedSupports = sources.filter((s) => s.relation === "supports" && s.independence === "unconfirmed");
  const bodyOnlySummary = sources.filter((s) => s.relation === "supports" && !s.bodyStatus.startsWith("evidence")).length;
  const unconfirmedSources = sources.filter((s) => s.independence === "unconfirmed").length;
  const supports = sources.filter((s) => s.relation === "supports").length;
  const contradicts = sources.filter((s) => s.relation === "contradicts").length;
  const unclear = sources.filter((s) => s.relation === "unclear").length;
  const irrelevant = sources.filter((s) => s.relation === "irrelevant").length;
  const outOfRangeSupports = sources.filter(
    (s) => s.relation === "supports" && s.dateStatus === "out_of_range",
  ).length;
  const reasons: string[] = [];

  let relation: FactAssessment["relation"] = "none";
  if (supportClusters.size && opposeClusters.size) relation = "mixed";
  else if (supportClusters.size) relation = "supports";
  else if (opposeClusters.size) relation = "contradicts";

  const mergedSources = sources.filter((s) => s.independence === "duplicate");
  if (mergedSources.length) {
    const basis = [...new Set(mergedSources.map((s) => s.duplicateOf?.basis).filter(Boolean))].slice(0, 2).join("；");
    reasons.push(
      `已合并 ${mergedSources.length} 条同源/转载页面（依据：${basis || "内容高度重合"}），同源材料不重复计数；其他来源的独立性未因此得到证明。`,
    );
  }
  // 共同原始出处：同一个机构的数据被多条来源转述/解读，只能算一条独立证据
  const sharedOriginHits = [...originCounts.entries()].filter(
    ([org, count]) => count >= 2 && sources.some((s) => s.relation === "supports" && s.citedOrigin?.org === org),
  );
  if (sharedOriginHits.length)
    reasons.push(
      `有 ${sharedOriginHits
        .map(([org, count]) => `${count} 条来源共同引用「${org}」的发布数据`)
        .join("；")}，按同一发布机构的二次报道归并，不重复作为证明。`,
    );
  if (scopeExcluded.length)
    reasons.push(
      `${scopeExcluded.length} 条来源虽被判为支持，但只覆盖说法里的局部范围或早期状态（${[...new Set(scopeExcluded.map((s) => s.scopeNote).filter(Boolean))].slice(0, 2).join("；")}），未计入支持数量。`,
    );
  if (bodyOnlySummary)
    reasons.push(`${bodyOnlySummary} 条支持性来源只有搜索摘要或正文未找到对应表述，不能算作「取得关键原文」。`);
  if (unconfirmedSources)
    reasons.push(
      `另有 ${unconfirmedSources} 条来源可能是转载但无法确认，标为「独立性未确认」，不计入独立证据。`,
    );
  if (relation === "supports")
    reasons.push(`${supportClusters.size} 个未检测到重复的来源簇被规则判为支持（其中 ${bodyBacked.size} 个取得网页正文）；未检测到重复不代表已证明独立。`);
  if (relation === "contradicts") reasons.push(`${opposeClusters.size} 个未检测到重复的来源簇被规则判为相反说法，仍需核对原始出处。`);
  if (relation === "mixed") {
    const systems = new Set(sources.filter((source) => source.relation === "supports" || source.relation === "contradicts")
      .flatMap((source) => source.quantityEvidence || []).filter((item) => item.statisticalSource !== "统计来源未注明").map((item) => item.statisticalSource));
    reasons.push(systems.size > 1 ? "存在不同统计来源与口径对门槛的不同判断；先明确适用范围，不认定同口径来源直接矛盾。" : "同时存在支持与相反说法，需要人工判断。");
  }
  if (relation === "none" && outOfRangeSupports > 0)
    reasons.push(
      `${outOfRangeSupports} 条来源内容相关，但发布时间或所指期间不满足事实的时间要求，不能作为当前结论的依据。`,
    );
  if (relation === "none" && outOfRangeSupports === 0)
    reasons.push("没有来源与该事实形成可比对的表述，属于证据不足，不能给出确定结论。");

  return {
    factId: options.fact.id,
    fact: options.fact.text,
    relation,
    independentClusters: supportClusters.size + opposeClusters.size,
    bodyBackedClusters: bodyBacked.size,
    unconfirmedSources,
    unconfirmedClusters: new Set(unconfirmedSupports.map((s) => s.clusterId)).size,
    keySentenceSources: keySentenceSources.length,
    scopeExcludedSources: scopeExcluded.length,
    sharedOrigins: [...originCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([org, count]) => ({ org, count })),
    supports,
    contradicts,
    unclear,
    irrelevant,
    outOfRangeSupports,
    sources,
    reasons,
  };
}

export interface CaseAssessment {
  /** 部分回答：已经查清的原始表述（结论仍是「答了一部分」时给用户看） */
  partialAnswer?: string[];
  outcome: Outcome;
  headline: string;
  confidence: "low" | "medium" | "high";
  reasons: string[];
  counts: {
    queries: number;
    failedQueries: number;
    emptyQueries: number;
    pages: number;
    independentSources: number;
    bodyAvailable: number;
  };
}

export function aggregateCase(input: {
  facts: FactAssessment[];
  searchSummary: { total: number; failed: number; empty: number };
  pageCount: number;
  bodyCount: number;
  independentSourceCount: number;
  searchedOk: boolean;
}): CaseAssessment {
  const { facts } = input;
  const reasons: string[] = [];
  const counts = {
    queries: input.searchSummary.total,
    failedQueries: input.searchSummary.failed,
    emptyQueries: input.searchSummary.empty,
    pages: input.pageCount,
    independentSources: input.independentSourceCount,
    bodyAvailable: input.bodyCount,
  };

  if (!input.searchedOk) {
    return {
      outcome: "insufficient",
      headline: "未完成联网检索，不能给出任何事实结论。",
      confidence: "low",
      reasons: ["检索未成功执行（未配置密钥、被限流或网络失败）。系统不会用推测内容填补证据空缺。"],
      counts,
    };
  }
  if (!facts.length)
    return {
      outcome: "insufficient",
      headline: "没有待核查事实，无法形成结论。",
      confidence: "low",
      reasons: ["请先确认至少一条可核查事实。"],
      counts,
    };
  if (counts.pages === 0)
    return {
      outcome: "insufficient",
      headline: "所有检索均未返回网页，证据不足。",
      confidence: "low",
      reasons: [`共发起 ${counts.queries} 次检索，失败 ${counts.failedQueries} 次，无结果 ${counts.emptyQueries} 次。`],
      counts,
    };

  // 只支持说法中一部分条件的来源（有条件限制、时间不一致、只覆盖局部范围）。
  // 这类来源不能让用户以为「已经拿到可直接引用的表述」，必须在结论句里说清。
  const conditionSources = facts
    .flatMap((fact) => fact.sources)
    .filter((source) => source.semantic?.verdict === "partial" && source.semantic.sentence && !source.semantic.fromTitle);
  const supported = facts.filter((f) => f.relation === "supports");
  const contradicted = facts.filter((f) => f.relation === "contradicts");
  const mixed = facts.filter((f) => f.relation === "mixed");
  const none = facts.filter((f) => f.relation === "none");
  const bodyBackedTotal = facts.reduce((n, f) => n + f.bodyBackedClusters, 0);

  if (mixed.length) {
    const numericSources = mixed.flatMap((fact) => fact.sources.filter((source) => source.relation === "supports" || source.relation === "contradicts").flatMap((source) => source.quantityEvidence || []))
      .filter((item) => !item.approximate && item.statisticalSource !== "统计来源未注明");
    const systems = [...new Set(numericSources.map((item) => item.statisticalSource))];
    const scopeDifference = systems.length > 1 && new Set(numericSources.map((item) => item.value)).size > 1;
    reasons.push(scopeDifference
      ? `统计口径差异：${systems.join("、")}分别提供不同统计值；未指定统计来源和覆盖范围时不能合并裁决，不能据此认定同口径来源直接矛盾或任何一方错误。`
      : `${mixed.length} 条事实同时存在支持与相反说法，交由人工判断，不单方面下结论。`);
    return {
      outcome: "disputed",
      headline: scopeDifference ? "统计口径差异：需要明确适用的统计来源与范围。" : "存在相互矛盾的说法，需要人工判断。",
      confidence: "low",
      reasons,
      counts,
    };
  }
  if (contradicted.length && !supported.length) {
    reasons.push(`${contradicted.length} 条事实找到明确反证，未见支持性来源。`);
    return {
      outcome: "contradicted",
      headline: "现有来源指向与待核查说法相反。",
      confidence: counts.independentSources >= 2 ? "medium" : "low",
      reasons,
      counts,
    };
  }
  if (none.length && !supported.length) {
    // 区分两种「没有支持」：真的没有相关来源，还是相关内容因时间要求被排除。
    // 只把「范围一致但过期」的支持来源算作时效问题：局部证据本来就不能支撑整句，
    // 不能因为它过期就说整条说法「信息过期」。
    const staleCount = facts.reduce(
      (n, f) =>
        n + f.sources.filter((source) => source.relation === "supports" && source.scopeCompatible !== false && source.dateStatus === "out_of_range").length,
      0,
    );
    if (staleCount > 0) {
      reasons.push(
        `找到 ${staleCount} 条内容相关的来源，但都不满足事实的时间要求（期间不符或发布时间过旧），不能支撑当前结论。`,
      );
      return {
        outcome: "outdated",
        headline: "相关内容存在，但时效不满足，不能视为当前有效结论。",
        confidence: "low",
        reasons,
        counts,
      };
    }
    // 有相关表述，只是过不了范围/独立性核对时，不能写成「没有任何来源」。
    const allSources = facts.flatMap((fact) => fact.sources);
    const related = allSources.filter((source) => source.relation === "supports" || source.relation === "contradicts");
    if (related.length) {
      const sup = related.filter((source) => source.relation === "supports").length;
      const opp = related.filter((source) => source.relation === "contradicts").length;
      const localOnly = related.filter((source) => source.scopeCompatible === false).length;
      reasons.push(
        `找到相关表述（支持 ${sup} 条、相反 ${opp} 条），但都没有同时满足范围一致与独立性要求，因此不能据此下结论${
          localOnly ? `；其中 ${localOnly} 条只覆盖局部范围` : ""
        }。`,
      );
    } else {
      // 语义层判定为「只支持一部分 / 只是相关」的来源也要说清楚，不能写成「没有任何来源」。
      const partials = allSources.filter((source) => source.semantic && source.semantic.verdict !== "unrelated");
      reasons.push(
        partials.length
          ? `有 ${partials.length} 条来源与这句话有关，但都只支持其中一部分或只是相关（例如：${partials[0].semantic!.reason}），不足以定案。`
          : "没有任何来源与待核查事实形成可比对表述。",
      );
    }
    // 已经有支持性表述时，不能只丢一句「证据不足」：把已查清的部分先答给用户。
    const supportedFacts = facts.filter((fact) => fact.sources.some((source) => source.relation === "supports"));
    // 只支持一部分（例如「有条件限制」「只是相关」）的官方原句，也是用户已经查清的部分：
    // 这些句子必须显式给出来，否则用户只会看到「证据不足」，等于把查到的条件限制丢掉了。
    const partialAnswer = [
      ...conditionSources
        .slice(0, 2)
        .map((source) => `${source.site || "来源"}：${source.semantic!.sentence.slice(0, 140)}`),
      ...supportedFacts
        .map((fact) => fact.sources.find((source) => source.relation === "supports"))
        .filter(Boolean)
        .map((source) =>
          `${source!.site || "来源"}：${(source!.semantic?.sentence || source!.bodyExcerpt || source!.excerpt || "").slice(0, 120)}`,
        ),
    ];
    if (partialAnswer.length)
      return {
        outcome: "partial",
        headline: conditionSources.length
          ? "来源只支持说法中的部分条件，不能按原说法成立。"
          : "已查到相关依据，但还不足以给出确定结论。",
        confidence: "low",
        reasons: [
          ...reasons,
          "已查清的部分只来自检索材料，尚未通过范围一致与独立性核对。",
        ],
        counts,
        partialAnswer,
      };
    return {
      outcome: "insufficient",
      headline: "证据不足，暂不下结论。",
      confidence: "low",
      reasons,
      counts,
    };
  }
  if (supported.length && bodyBackedTotal === 0) {
    reasons.push("支持性来源只有搜索摘要，没有取得任何原文正文，按规则不作为确定结论的依据。");
    const supportedFacts = facts.filter((fact) => fact.sources.some((source) => source.relation === "supports"));
    const conditional = conditionSources.length > 0;
    return {
      outcome: "partial",
      headline: conditional
        ? "来源只支持说法中的部分条件（有条件限制或时间不一致），不能按原说法成立。"
        : "已查到支持性表述，但只有搜索摘要、缺少原文依据。",
      confidence: "low",
      reasons: conditional
        ? [
            ...reasons,
            `其中 ${conditionSources.length} 条来源只支持说法里的一部分条件，例如：${conditionSources[0].semantic!.reason}`,
          ]
        : reasons,
      counts,
      partialAnswer: [
        ...conditionSources
          .slice(0, 2)
          .map((source) => `${source.site || "来源"}：${source.semantic!.sentence.slice(0, 140)}`),
        ...supportedFacts
          .map((fact) => fact.sources.find((source) => source.relation === "supports"))
          .filter(Boolean)
          .map((source) =>
            `${source!.site || "来源"}：${(source!.semantic?.sentence || source!.excerpt || "").slice(0, 120)}`,
          ),
      ],
    };
  }
  const minClusters = Math.min(...supported.map((f) => f.independentClusters));
  if (minClusters < 2) {
    reasons.push("支持性材料只有一个未检测到重复的来源簇；材料不足以确认事实。");
    return {
      outcome: "insufficient",
      headline: "支持性来源簇不足，暂不下结论。",
      confidence: "low",
      reasons,
      counts,
    };
  }
  reasons.push(
    `${supported.length}/${facts.length} 条事实满足规则条件：≥2 个未检测到重复的支持来源簇，且至少一个取得网页正文。来源独立性与原始出处仍需人工核对。`,
  );
  return {
    outcome: "supported",
    headline: "现有材料经规则判为支持；已执行同源检测，不能据此声称排除了全部转载或证明来源独立。",
    confidence: bodyBackedTotal >= 2 ? "medium" : "low",
    reasons,
    counts,
  };
}

export function outcomeLabel(outcome: Outcome) {
  switch (outcome) {
    case "supported":
      return "有依据支持";
    case "contradicted":
      return "存在反证";
    case "disputed":
      return "存在争议";
    case "outdated":
      return "信息过期或原文不足";
    case "partial":
      return "答了一部分";
    default:
      return "证据不足";
  }
}


/**
 * 结论一句话：首版档案与新版本档案都必须用同一句，否则版本之间会出现
 * 「v1 有结论、v2 只剩 headline」这种不可比对的情况。
 */
export function buildStatement(claim: string, verdict: CaseAssessment) {
  const suffix =
    `共收录 ${verdict.counts.pages} 条网页材料，其中 ${verdict.counts.independentSources} 个来源簇未检测到重复、${verdict.counts.bodyAvailable} 份取得网页正文。` +
    verdict.reasons.join(" ");
  if (verdict.outcome === "supported")
    return `就「${claim}」而言，现有公开来源支持该说法。${verdict.headline}${suffix}仍需人工复核关键原文后再作为正式依据。`;
  if (verdict.outcome === "contradicted")
    return `就「${claim}」而言，现有公开来源与待核查说法相反。${suffix}`;
  if (verdict.outcome === "disputed")
    return verdict.headline.includes("统计口径差异")
      ? `就「${claim}」而言，按不同统计口径会得到不同判断。未指定口径时保留「存在争议」类型，这不表示两个同口径来源直接矛盾。${suffix}`
      : `就「${claim}」而言，公开来源存在相互矛盾的说法，本档案不单方面下结论。${suffix}`;
  if (verdict.outcome === "outdated")
    return `就「${claim}」而言，现有来源时效或原文依据不足，不能视为当前有效结论。${suffix}`;
  if (verdict.outcome === "partial") {
    const got = (verdict.partialAnswer || []).slice(0, 2).join("；");
    // 来源只覆盖说法里的一部分条件时，不能说成「已经拿到可直接引用的表述」——
    // 用户会以为整句说法已经被证实，这正是「部分限制被放大成全面限制」的来源。
    if (verdict.headline.includes("部分条件"))
      return `关于「${claim}」：现有来源只支持说法中的一部分，不能按原说法成立。${got ? `查到的是：${got}。` : ""}结论停在「有条件限制」，还需要官方原始页面才能定案。`;
    return `关于「${claim}」：已经查到可直接引用的表述${got ? `——${got}` : ""}；但还缺少能把它定案的依据（官方原始页面或研究原文），所以只回答到这里，不把它当成已确认的事实。`;
  }
  return `就「${claim}」而言，证据不足，本档案拒绝给出确定结论。${suffix}`;
}
export interface SourceCluster {
  id: string;
  /** 该簇里最适合当作原始出处的一条（有正文且得分最高） */
  primary: {
    title: string;
    url: string;
    site: string;
    date: string;
    bodyAvailable: boolean;
    originality: SourceAssessment["originality"];
  };
  size: number;
  /** 同一原始内容被多少篇网页重复传播 */
  reprint: boolean;
  members: { title: string; url: string; site: string; date: string; bodyAvailable: boolean }[];
}

/** 把「同源/转载」关系整理成可直接展示的分组，替代让用户自己比对 URL。 */
export function summarizeClusters(
  sources: SourceAssessment[],
  bodies: Map<string, BodyEvidence>,
  pages: AnalysablePage[],
): SourceCluster[] {
  const byPage = new Map(pages.map((page) => [page.id, page]));
  const groups = new Map<string, SourceAssessment[]>();
  for (const source of sources)
    groups.set(source.clusterId, [...(groups.get(source.clusterId) || []), source]);
  return [...groups.entries()]
    .map(([id, group]) => {
      const ranked = [...group].sort(
        (a, b) =>
          Number(b.bodyAvailable) - Number(a.bodyAvailable) ||
          Number(b.originality === "original_candidate") - Number(a.originality === "original_candidate") ||
          (byPage.get(b.pageId)?.score || 0) - (byPage.get(a.pageId)?.score || 0),
      );
      const primary = ranked[0];
      return {
        id,
        primary: {
          title: primary.title,
          url: primary.url,
          site: primary.site,
          date: primary.date,
          bodyAvailable: primary.bodyAvailable,
          originality: primary.originality,
        },
        size: group.length,
        reprint: group.length > 1,
        members: group.map((item) => ({
          title: item.title,
          url: item.url,
          site: item.site,
          date: item.date,
          bodyAvailable: item.bodyAvailable,
        })),
      };
    })
    .sort((a, b) => b.size - a.size || a.primary.site.localeCompare(b.primary.site));
}

/**
 * 明确列出「还缺什么证据」，用于证据不足时告诉用户下一步该补什么，
 * 而不是只丢一句「证据不足」。
 */
export function openQuestions(facts: FactAssessment[]): string[] {
  const notes: string[] = [];
  for (const fact of facts) {
    const label = fact.fact.length > 34 ? fact.fact.slice(0, 34) + "…" : fact.fact;
    if (fact.relation === "supports" && fact.bodyBackedClusters === 0)
      notes.push(`「${label}」只有搜索摘要，还缺可访问的原文正文。`);
    if (fact.relation === "supports" && fact.independentClusters < 2)
      notes.push(`「${label}」只有一个未检测到重复的支持来源簇，还需补充并核对其他来源的原始出处。`);
    if (fact.relation === "none" && fact.outOfRangeSupports > 0)
      notes.push(`「${label}」找到相关内容但不符合时间要求，还缺该期间内的来源。`);
    if (fact.relation === "none" && fact.outOfRangeSupports === 0)
      notes.push(`「${label}」没有任何来源直接表述该事实，还缺能明确写出该说法的来源。`);
    if (fact.relation === "contradicts")
      notes.push(`「${label}」存在相反说法，还缺能确认哪一方准确的原始出处。`);
    if (fact.relation === "mixed")
      notes.push(`「${label}」支持与反对并存，还需要能说明统计口径或时间范围的来源。`);
    if ((fact.unconfirmedClusters || 0) > 0)
      notes.push(`「${label}」有 ${fact.unconfirmedSources} 条来源可能同源但无法确认，还缺能证明其独立性的信息。`);
    if (fact.supports === 0 && fact.irrelevant > 0 && fact.relation === "none")
      notes.push(`检索命中的 ${fact.irrelevant} 条网页与该事实无关，建议换更具体的检索式。`);
  }
  return [...new Set(notes)].slice(0, 6);
}


const RELATION_LABEL: Record<string, string> = {
  supports: "支持",
  contradicts: "反对",
  unclear: "无法确认",
  irrelevant: "无关",
};

/** 一次人工修正在写入前后对结论的实际影响（都是真实重算出来的，不是估计）。 */
export interface CorrectionImpact {
  sourceBefore: Relation;
  sourceAfter: Relation;
  factBefore: string;
  factAfter: string;
  supportsBefore: number;
  supportsAfter: number;
  clustersBefore: number;
  clustersAfter: number;
  verdictBefore: string;
  verdictAfter: string;
}

export interface CorrectionRecord {
  pageId: string;
  factId: string;
  relation: Relation;
  note: string;
  actor: string;
  at: string;
  /** 首次写入时由服务端算出；老记录没有 */
  impact?: CorrectionImpact;
}

/**
 * 把人工修正应用到一条事实的来源判定上。
 *
 * 约束：
 *  - 只改「关系」这一个判断，不动原始搜索返回、摘要与原文摘录；
 *  - 保留系统自动判断（autoRelation）与修正人/原因/时间，档案里两者都写；
 *  - 修正后按与自动判定完全相同的规则重算计数与结论，不另立标准。
 */
export function applyCorrections(fact: FactAssessment, corrections: CorrectionRecord[]): FactAssessment {
  const relevant = corrections.filter((item) => item.factId === fact.factId);
  if (!relevant.length) return fact;

  const sources = fact.sources.map((source) => {
    const latest = relevant
      .filter((item) => item.pageId === source.pageId)
      .sort((a, b) => a.at.localeCompare(b.at))
      .pop();
    if (!latest) return source;
    const autoRelation = source.autoRelation || source.relation;
    return {
      ...source,
      relation: latest.relation,
      autoRelation,
      manualCorrection: {
        relation: latest.relation,
        note: latest.note,
        actor: latest.actor,
        at: latest.at,
        ...(latest.impact ? { impact: latest.impact } : {}),
      },
      reasons: [
        `人工修正：${latest.actor} 将关系由「${RELATION_LABEL[autoRelation] || autoRelation}」改为「${RELATION_LABEL[latest.relation] || latest.relation}」，原因：${latest.note}`,
        ...source.reasons,
      ],
    };
  });

  // 没有正面依据就不宣称独立：这里只要求"未检测到与别的来源重复"。
  const independent = (source: SourceAssessment) => source.independence === "unique";
  // 引用同一个官方出处的多篇报道属于二次解读，按 1 条独立证据计。
  const originCounts = new Map<string, number>();
  for (const source of sources) {
    const org = source.citedOrigin?.org;
    if (org) originCounts.set(org, (originCounts.get(org) || 0) + 1);
  }
  const evidenceKey = (source: SourceAssessment) => {
    const org = source.citedOrigin?.org;
    if (org && (originCounts.get(org) || 0) >= 2) return `origin:${org}`;
    return source.clusterId;
  };
  // 支持计数只认"范围一致 + 未检测到重复"的来源：局部证据即使被标为支持，也不抬高整句说法的支持度。
  const scopeExcluded = sources.filter((s) => s.relation === "supports" && s.scopeCompatible === false);
  const countedSupports = sources.filter(
    (s) => s.relation === "supports" && s.scopeCompatible !== false && s.dateStatus !== "out_of_range" && independent(s),
  );
  const supportClusters = new Set(countedSupports.map((s) => evidenceKey(s)));
  // 范围不一致的来源不能当整句的反证：只覆盖局部（一条干线、一个城市）的表述，
  // 既不能证明「全国已成」，也不能证明「全国未成」。
  const scopeExcludedOppose = sources.filter(
    (s) => s.relation === "contradicts" && s.scopeCompatible === false,
  );
  const opposeClusters = new Set(
    sources
      .filter((s) => s.relation === "contradicts" && independent(s) && s.scopeCompatible !== false)
      .map((s) => s.clusterId),
  );
  // "取得关键原文"要求：正文里真的找到了与该说法相关的句子，而不只是请求成功。
  const keySentenceSources = sources.filter((s) => s.bodyStatus === "evidence_sentence");
  const bodyBacked = new Set(
    sources
      .filter(
        (s) =>
          s.relation === "supports" &&
          s.bodyStatus === "evidence_sentence" &&
          s.scopeCompatible !== false &&
          s.dateStatus !== "out_of_range" &&
          independent(s),
      )
      .map((s) => evidenceKey(s)),
  );
  const unconfirmedSupports = sources.filter((s) => s.relation === "supports" && s.independence === "unconfirmed");
  const bodyOnlySummary = sources.filter((s) => s.relation === "supports" && !s.bodyStatus.startsWith("evidence")).length;
  const unconfirmedSources = sources.filter((s) => s.independence === "unconfirmed").length;

  let relation: FactAssessment["relation"] = "none";
  if (supportClusters.size && opposeClusters.size) relation = "mixed";
  else if (supportClusters.size) relation = "supports";
  else if (opposeClusters.size) relation = "contradicts";

  return {
    ...fact,
    sources,
    relation,
    independentClusters: supportClusters.size + opposeClusters.size,
    bodyBackedClusters: bodyBacked.size,
    unconfirmedSources,
    unconfirmedClusters: new Set(unconfirmedSupports.map((s) => s.clusterId)).size,
    keySentenceSources: keySentenceSources.length,
    scopeExcludedSources: scopeExcluded.length,
    sharedOrigins: [...originCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([org, count]) => ({ org, count })),
    supports: sources.filter((s) => s.relation === "supports").length,
    contradicts: sources.filter((s) => s.relation === "contradicts").length,
    unclear: sources.filter((s) => s.relation === "unclear").length,
    irrelevant: sources.filter((s) => s.relation === "irrelevant").length,
    outOfRangeSupports: sources.filter(
      (s) => s.relation === "supports" && s.dateStatus === "out_of_range",
    ).length,
    reasons: [
      `其中 ${relevant.length} 条关系经人工修正（原始自动判断保留）。`,
      ...fact.reasons.filter((reason) => !reason.startsWith("其中 ")),
    ],
  };
}

/**
 * 来源身份：谁发的这条信息，能发布什么。
 *
 * 域名只是线索：厂商官网可以发布产品状态，统计主管部门发布统计，期刊发布研究，
 * 媒体只能"报道/引用/解读"，百科与搜索摘要不能当原始出处。
 */
export type SourceKind = "vendor" | "official" | "journal" | "media" | "reference" | "unknown";

export interface SourceProfile {
  kind: SourceKind;
  label: string;
  /** 这类来源能发布的最高层级事实 */
  authority: string;
}

const JOURNAL_HOSTS = /(pubmed|ncbi|doi\.org|nature\.com|science\.org|thelancet|nejm|sciencedirect|springer|wiley|cnki|wanfang|jamanetwork|bmj\.com|cell\.com|plos)/i;
const REFERENCE_HOSTS = /(baike\.baidu|wikipedia|wikiwand|zhihu|baike\.sogou|360baike)/i;
const MEDIA_HOSTS = /(people\.com\.cn|news\.cn|xinhuanet|cctv|cnr\.cn|chinanews|thepaper|caixin|yicai|jiemian|sina|sohu|163\.com|qq\.com|toutiao|ifeng|guancha|36kr|ithome|mtime|douban)/i;

export function sourceProfile(url: string, site = "", text = ""): SourceProfile {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const value = `${host} ${site}`;
  if (JOURNAL_HOSTS.test(value) || /(doi:\s?10\.|论文|期刊|摘要|abstract)/i.test(text.slice(0, 600)))
    return { kind: "journal", label: "研究期刊/论文页", authority: "研究结论（仅限原文明确陈述的部分）" };
  if (/(\.gov(\.[a-z]{2})?$|gov\.cn)/.test(host))
    return { kind: "official", label: "政府/主管部门网站", authority: "该部门主管范围内的官方口径" };
  if (REFERENCE_HOSTS.test(value)) return { kind: "reference", label: "百科/问答（二手汇编）", authority: "只能证明有人这样写，不是原始出处" };
  if (/(官方|官网|support|help|newsroom|press)/i.test(`${text.slice(0, 300)} ${site}`))
    return { kind: "vendor", label: "厂商官方页面（疑似）", authority: "该厂商自身产品或服务状态" };
  if (MEDIA_HOSTS.test(value)) return { kind: "media", label: "媒体报道", authority: "报道内容（可能转述他人资料）" };
  return { kind: "unknown", label: "来源身份未确认", authority: "未知，需要看正文内容" };
}
