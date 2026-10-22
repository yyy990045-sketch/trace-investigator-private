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

/** 证据与事实的关系：支持 / 反对 / 无法确认 / 明显无关。 */
export type Relation = "supports" | "contradicts" | "unclear" | "irrelevant";
export type Outcome = "supported" | "contradicted" | "disputed" | "outdated" | "insufficient";

export interface TraceFact {
  id: string;
  text: string;
  queries: string[];
  /** 适用时间要求，例如「2024年内」「现行有效」；留空表示未限定 */
  timeScope?: string;
  /** 主体与地区要求，例如「中国大陆」「教育部」；留空表示未限定 */
  subjectScope?: string;
}

export interface AnalysablePage {
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

export interface SourceAssessment {
  pageId: string;
  url: string;
  site: string;
  title: string;
  date: string;
  excerpt: string;
  relation: Relation;
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
  const found = text.normalize("NFKC").match(/\d+(?:\.\d+)?\s*(?:%|％|年|月|日|万元|亿元|万|亿|元|人|家|个|次|倍|公里|千米|平方米|岁|小时|天)?/g) || [];
  return [...new Set(found.map((s) => s.replace(/\s+/g, "")))];
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
    if (sameUnit.some((item) => item.value === factItem.value))
      return {
        kind: "supports" as const,
        exact: true,
        reason: `同一计量单位下数量一致：${factItem.value}${factItem.unit}。`,
      };
    if (up) {
      const larger = sameUnit.filter((item) => item.value > factItem.value).sort((a, b) => a.value - b.value);
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
      if (sameUnit.some((item) => item.value < factItem.value))
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

/**
 * 同源/转载聚类：同站同内容、跨站高度雷同（分片 Jaccard ≥ 0.55）视为同一来源簇。
 * 目的：两篇内容相同的中转网页不能算两个独立证据。
 */
export function clusterSources(pages: AnalysablePage[]) {
  const parent = pages.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const shingleSets = pages.map((p) => shingles(p.passage + " " + p.title));
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const sameHost = registrableHost(pages[i].url) && registrableHost(pages[i].url) === registrableHost(pages[j].url);
      const sameUrl = pages[i].url.split("?")[0].split("#")[0] === pages[j].url.split("?")[0].split("#")[0];
      const similarity = jaccard(shingleSets[i], shingleSets[j]);
      const samePassage = pages[i].passage.slice(0, 200) === pages[j].passage.slice(0, 200);
      if (sameUrl || samePassage || similarity >= 0.55 || (sameHost && similarity >= 0.35)) union(i, j);
    }
  }
  const clusters = new Map<number, AnalysablePage[]>();
  pages.forEach((page, index) => {
    const root = find(index);
    const list = clusters.get(root) || [];
    list.push(page);
    clusters.set(root, list);
  });
  const clusterOf = new Map<string, string>();
  let n = 0;
  for (const [, list] of clusters) {
    n++;
    const id = "cluster-" + n;
    for (const page of list) clusterOf.set(page.id, id);
  }
  return clusterOf;
}

export interface AssessOptions {
  fact: TraceFact;
  pages: AnalysablePage[];
  bodies: Map<string, BodyEvidence>;
  clusterOf: Map<string, string>;
  duplicatePages: Set<string>;
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

  const bodyText = body?.ok ? body.text : "";
  const bodyRelevance = body?.ok ? coverage(bodyText, factTerms) : 0;
  const negation = negationNear(scored, factTerms);
  // 只有"数量断言"参与数值比对：年份/月/日不算证据，出现"2025年"不代表说对了产量。
  const factQuantities = quantities(options.fact.text);
  const pageQuantities = quantities(scored + " " + bodyText);
  // 数量断言比对：尊重「超过/以上/低于」的比较方向，单位不同不比较。
  const numeric = compareQuantities(options.fact.text, factQuantities, pageQuantities);
  // 同一表述片段：汉字三元片段命中，才认为来源真的在讲这件事（二元词重合太松）。
  const factFragments = fragments(options.fact.text);
  const sharedFragment = factFragments.find((fragment) => (scored + " " + bodyText).includes(fragment));

  if (relevance < 0.12) {
    relation = "irrelevant";
    reasons.push(
      `与该事实几乎无关（关键词重合度 ${(relevance * 100).toFixed(0)}%），仅作为检索命中记录保留，不参与判断。`,
    );
  } else if (relevance < 0.34) {
    reasons.push(`与事实主题的关键词重合度仅 ${(relevance * 100).toFixed(0)}%，不足以作为该事实的依据。`);
  } else if (negation) {
    relation = "contradicts";
    reasons.push(`命中事实关键词，但邻近出现否定表述「${negation}」。`);
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

  if (options.fact.subjectScope) {
    const subjectTerms = terms(options.fact.subjectScope);
    if (subjectTerms.length && coverage(scored + " " + bodyText, subjectTerms) === 0)
      reasons.push(`未出现事实限定的主体/地区（${options.fact.subjectScope}），适用性存疑。`);
    else if (subjectTerms.length) reasons.push(`出现事实限定的主体/地区（${options.fact.subjectScope}）。`);
  }

  return {
    pageId: page.id,
    url: page.url,
    site: page.site,
    title: page.title,
    date: page.date,
    excerpt: page.passage.slice(0, 600),
    relation,
    relevance,
    reasons,
    bodyAvailable: body?.ok === true,
    bodyExcerpt: body?.ok ? excerptAround(body.text, page.passage, factTerms) : null,
    originality,
    reprintMarkers,
    clusterId: options.clusterOf.get(page.id) || "cluster-0",
    duplicate: options.duplicatePages.has(page.id),
    dateStatus,
    dateNote,
  };
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

  const supportClusters = new Set(
    sources.filter((s) => s.relation === "supports" && s.dateStatus !== "out_of_range").map((s) => s.clusterId),
  );
  const opposeClusters = new Set(sources.filter((s) => s.relation === "contradicts").map((s) => s.clusterId));
  const bodyBacked = new Set(
    sources
      .filter((s) => s.relation === "supports" && s.bodyAvailable && s.dateStatus !== "out_of_range")
      .map((s) => s.clusterId),
  );
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

  if (sources.some((s) => s.duplicate))
    reasons.push("已合并内容雷同的同源/转载页面，避免重复计数。");
  if (relation === "supports")
    reasons.push(`${supportClusters.size} 个独立来源支持该事实（其中 ${bodyBacked.size} 个取得原文正文）。`);
  if (relation === "contradicts") reasons.push(`${opposeClusters.size} 个独立来源对该事实给出相反说法。`);
  if (relation === "mixed") reasons.push("同时存在支持与相反说法，需要人工判断。");
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

  const supported = facts.filter((f) => f.relation === "supports");
  const contradicted = facts.filter((f) => f.relation === "contradicts");
  const mixed = facts.filter((f) => f.relation === "mixed");
  const none = facts.filter((f) => f.relation === "none");
  const bodyBackedTotal = facts.reduce((n, f) => n + f.bodyBackedClusters, 0);

  if (mixed.length) {
    reasons.push(`${mixed.length} 条事实同时存在支持与相反说法，交由人工判断，不单方面下结论。`);
    return {
      outcome: "disputed",
      headline: "存在相互矛盾的说法，需要人工判断。",
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
    const staleCount = facts.reduce((n, f) => n + f.outOfRangeSupports, 0);
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
    reasons.push("没有任何来源与待核查事实形成可比对表述。");
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
    return {
      outcome: "insufficient",
      headline: "仅有搜索摘要，缺少原文依据，暂不下结论。",
      confidence: "low",
      reasons,
      counts,
    };
  }
  const minClusters = Math.min(...supported.map((f) => f.independentClusters));
  if (minClusters < 2) {
    reasons.push("支持性来源只有一个独立来源簇；单一来源不足以确认事实。");
    return {
      outcome: "insufficient",
      headline: "独立来源不足，暂不下结论。",
      confidence: "low",
      reasons,
      counts,
    };
  }
  reasons.push(
    `${supported.length}/${facts.length} 条事实由 ≥2 个独立来源支持，且至少一个来源取得原文正文。`,
  );
  return {
    outcome: "supported",
    headline: "现有公开来源支持待核查说法，并已排除同源转载。",
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
    `已检索 ${verdict.counts.independentSources} 个独立来源、${verdict.counts.bodyAvailable} 份原文正文。` +
    verdict.reasons.join(" ");
  if (verdict.outcome === "supported")
    return `就「${claim}」而言，现有公开来源支持该说法。${verdict.headline}${suffix}仍需人工复核关键原文后再作为正式依据。`;
  if (verdict.outcome === "contradicted")
    return `就「${claim}」而言，现有公开来源与待核查说法相反。${suffix}`;
  if (verdict.outcome === "disputed")
    return `就「${claim}」而言，公开来源存在相互矛盾的说法，本档案不单方面下结论。${suffix}`;
  if (verdict.outcome === "outdated")
    return `就「${claim}」而言，现有来源时效或原文依据不足，不能视为当前有效结论。${suffix}`;
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
      notes.push(`「${label}」只有一个独立来源，还需要第二个互不转载的来源。`);
    if (fact.relation === "none" && fact.outOfRangeSupports > 0)
      notes.push(`「${label}」找到相关内容但不符合时间要求，还缺该期间内的来源。`);
    if (fact.relation === "none" && fact.outOfRangeSupports === 0)
      notes.push(`「${label}」没有任何来源直接表述该事实，还缺能明确写出该说法的来源。`);
    if (fact.relation === "contradicts")
      notes.push(`「${label}」存在相反说法，还缺能确认哪一方准确的原始出处。`);
    if (fact.relation === "mixed")
      notes.push(`「${label}」支持与反对并存，还需要能说明统计口径或时间范围的来源。`);
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

export interface CorrectionRecord {
  pageId: string;
  factId: string;
  relation: Relation;
  note: string;
  actor: string;
  at: string;
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
      },
      reasons: [
        `人工修正：${latest.actor} 将关系由「${RELATION_LABEL[autoRelation] || autoRelation}」改为「${RELATION_LABEL[latest.relation] || latest.relation}」，原因：${latest.note}`,
        ...source.reasons,
      ],
    };
  });

  const supportClusters = new Set(
    sources.filter((s) => s.relation === "supports" && s.dateStatus !== "out_of_range").map((s) => s.clusterId),
  );
  const opposeClusters = new Set(sources.filter((s) => s.relation === "contradicts").map((s) => s.clusterId));
  const bodyBacked = new Set(
    sources
      .filter((s) => s.relation === "supports" && s.bodyAvailable && s.dateStatus !== "out_of_range")
      .map((s) => s.clusterId),
  );

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
