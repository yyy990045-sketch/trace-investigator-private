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
