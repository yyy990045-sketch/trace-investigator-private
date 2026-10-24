/**
 * 查询型问题的证据式回答：从已经真实取得的原句中提取“问题所问的那个数字”。
 *
 * 与事实真伪裁决分开：一篇新闻引述某机构数字，只能回答“该报道写了什么”，
 * 不能据此声称已独立验证官方原始公告或统计口径。没有直接对应的原句就不作答。
 */
export interface LookupEvidence {
  quote: string;
  url: string;
  site: string;
  date: string;
  from: "body" | "excerpt";
  authoritative: boolean;
}
export interface SourcedLookupAnswer extends LookupEvidence {
  value: string;
  label: string;
  limitation: string;
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
    if (requestedYear && sentence.match(/(?:19|20)\d{2}年/g)?.some((year) => year !== requestedYear)) continue;
    // 年份如果不在这句原文中，至少需要网页自己的发布日期落在该年。
    // 未注明年份的标题/摘要不得拿来回答指定年份的问题。
    if (requestedYear && !sentence.includes(requestedYear) && !item.date.startsWith(requestedYear.slice(0, 4))) continue;

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
      weight: (item.from === "body" ? 4 : 0) +
        (item.authoritative ? 2 : 0) +
        (sentence.includes(requestedYear) && requestedYear ? 1 : 0),
    });
  }
  candidates.sort((a, b) => b.weight - a.weight);
  const first = candidates[0];
  if (!first) return null;
  const originalOffice = /\.gov\.cn(?:\/|$)/.test(new URL(first.evidence.url).hostname + "/");
  return {
    ...first.evidence,
    value: first.value,
    label: `找到来源中的对应数值：${first.value}`,
    limitation: originalOffice
      ? "该数值来自政府网站的公开页面，仍需核对该页面的统计主体与适用范围。"
      : "该数值来自公开报道或搜索摘要；是否存在主管部门原始公告、统计口径是否一致，尚未独立核实。",
  };
}

/** 是否是「查数值/日期」的问题。 */
export function isLookupQuestion(question: string): boolean {
  return /多少|几多|是多少|具体是|具体多少|公布|发布了吗|什么时候|哪一天|几月几号|日期/.test(
    String(question || ""),
  );
}

/**
 * 从已取得的网页里收集「带数值或日期」的原句。
 *
 * 插件（首次核验）与 buildAssessment（补查后重新读取）必须用同一个函数，
 * 否则同一份材料会在不同读取路径下得到不同的直接答案。
 */
export function collectLookupEvidence(
  pages: { id: string; url: string; site: string; date: string; passage: string }[],
  bodies: Map<string, { ok: boolean; text: string }>,
  options: { limit?: number; authoritative?: RegExp } = {},
): LookupEvidence[] {
  const authoritative =
    options.authoritative ||
    /(gov\.cn|stats\.gov\.cn|mofcom\.gov\.cn|mct\.gov\.cn|pbc\.gov\.cn|nbs\.gov|people\.com\.cn|news\.cn|xinhuanet\.com|cctv\.com|chinanews\.com\.cn)/;
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
        from: text ? "body" : "excerpt",
        authoritative: authoritative.test(page.url || ""),
      });
      if (hits.length >= limit) break;
    }
    if (hits.length >= limit) break;
  }
  return hits.sort((a, b) => Number(b.authoritative) - Number(a.authoritative)).slice(0, 3);
}
