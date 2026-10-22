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

export type Relation = "supports" | "contradicts" | "unclear";
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
}

export interface FactAssessment {
  factId: string;
  fact: string;
  relation: "supports" | "contradicts" | "mixed" | "none";
  independentClusters: number;
  bodyBackedClusters: number;
  supports: number;
  contradicts: number;
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
  const factNumbers = numbers(options.fact.text);
  const pageNumbers = numbers(scored);
  const sharedNumbers = factNumbers.filter((n) => pageNumbers.some((p) => p.replace(/%$/, "") === n.replace(/%$/, "")));

  if (relevance < 0.34) {
    reasons.push(`与事实主题的关键词重合度仅 ${(relevance * 100).toFixed(0)}%，不足以作为该事实的依据。`);
  } else if (negation) {
    relation = "contradicts";
    reasons.push(`命中事实关键词，但邻近出现否定表述「${negation}」。`);
  } else if (factNumbers.length && sharedNumbers.length) {
    relation = "supports";
    reasons.push(`关键词重合度 ${(relevance * 100).toFixed(0)}%，且关键数值一致：${sharedNumbers.join("、")}。`);
  } else if (factNumbers.length && pageNumbers.length && !sharedNumbers.length) {
    relation = "contradicts";
    reasons.push(
      `关键词重合度 ${(relevance * 100).toFixed(0)}%，但数值与事实不一致：事实 ${factNumbers.join("、")}，来源 ${pageNumbers.slice(0, 4).join("、")}。`,
    );
  } else if (relevance >= 0.6) {
    relation = "supports";
    reasons.push(`关键词重合度 ${(relevance * 100).toFixed(0)}%，且未发现否定表述。`);
  } else {
    reasons.push(`关键词重合度 ${(relevance * 100).toFixed(0)}%，介于相关与无关之间，仅记为不确定。`);
  }

  const reprintMarkers = body?.ok
    ? body.reprintMarkers
    : [];
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
  if (scope && published) {
    dateStatus = published >= scope.from && published <= scope.to ? "in_range" : "out_of_range";
    dateNote += dateStatus === "in_range" ? " 落在适用时间范围内。" : " 落在适用时间范围之外。";
  } else if (scope && !published) {
    dateNote += " 事实限定了适用时间，但该来源没有可用发布时间，无法确认时效。";
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
    sources.filter((s) => s.relation === "supports" && s.bodyAvailable).map((s) => s.clusterId),
  );
  const supports = sources.filter((s) => s.relation === "supports").length;
  const contradicts = sources.filter((s) => s.relation === "contradicts").length;
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
  if (relation === "none")
    reasons.push("没有来源与该事实形成可比对的表述，属于证据不足，不能给出确定结论。");

  return {
    factId: options.fact.id,
    fact: options.fact.text,
    relation,
    independentClusters: supportClusters.size + opposeClusters.size,
    bodyBackedClusters: bodyBacked.size,
    supports,
    contradicts,
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
    reasons.push("没有任何来源与待核查事实形成可比对表述。");
    return {
      outcome: "insufficient",
      headline: "证据不足，暂不下结论。",
      confidence: "low",
      reasons,
      counts,
    };
  }
  const outOfRange = facts.filter((f) => f.relation === "supports" && f.bodyBackedClusters === 0 && f.supports > 0);
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
  if (outOfRange.length && outOfRange.length === supported.length) {
    reasons.push("支持性来源均未取得正文，无法复核原始表述。");
    return {
      outcome: "outdated",
      headline: "现有来源时效或原文依据不足，不能视为当前有效结论。",
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
