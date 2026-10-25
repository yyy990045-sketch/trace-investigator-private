/**
 * 事实核查的检索式规划（确定性规则，不调用模型）。
 *
 * 为什么需要：用户只写一句问题，如果原样当检索式，长句召回很差——
 * 一条「为什么 2024 年新能源汽车产量有 1288.8 万辆和 1316.8 万辆两种说法？」
 * 往往只换回几篇泛泛的新闻，两个数字各自的出处都拿不到。
 *
 * 这里只做一件事：从这句话里拆出「主体」和「关键取值」，组成几条更像真实
 * 检索的查询。不改动任何判定逻辑，也不生成任何答案——只是让检索更有针对性。
 *
 * 客户端已经给出多条检索式时不介入（尊重人工拆解）。
 */

const QUESTION_WORDS = /^(为什么|为何|是不是|是否|请问|想查|查一下|求证)[\s，,]*/;
const TAIL_PARTICLES = /[？?。！!]+$/;

/** 数字 + 单位/量词：万辆、亿元、座、条、公里、% 等。 */
const QUANTITY = /\d+(?:\.\d+)?\s*(?:万辆|亿辆|万台|亿|万元|亿元|万人|万|吨|公里|千米|座|条|个|项|家|倍|%|％)/g;
/** 日期：2021年8月20日 / 2021-08-20 / 2021年。 */
const DATE = /\d{4}\s*(?:年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?|[-/]\d{1,2}(?:[-/]\d{1,2})?)/g;

function clean(text: string) {
  return text
    .replace(QUESTION_WORDS, "")
    .replace(TAIL_PARTICLES, "")
    .replace(/[，,]{2,}/g, "，")
    .trim();
}

/** 去掉取值后剩下的「主体部分」，用于和单个取值组合成检索式。 */
function subjectOf(text: string, values: string[]) {
  let rest = text;
  for (const value of values) rest = rest.replace(value, " ");
  return rest
    .replace(/(有|是|为|达到|共有|分别|和|与|、|及)/g, " ")
    .replace(/两种说法|两种数据|两个数字|两种口径|不同说法/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 60);
}

export interface QueryPlan {
  queries: string[];
  source: "client" | "rule";
  /** 规则扩展时说明依据，便于在页面上解释「为什么查这几条」 */
  note: string;
}

export function planFactQueries(text: string, provided: string[]): QueryPlan {
  const given = [...new Set(provided.map((q) => q.trim()).filter(Boolean))];
  // 客户端给了多条，或给的那条不是原句本身：按人工/客户端的意图走。
  if (given.length > 1 || (given.length === 1 && given[0] !== text.trim()))
    return { queries: given.slice(0, 6), source: "client", note: "使用客户端给出的检索式" };

  const claim = clean(text);
  const quantities = [...new Set(claim.match(QUANTITY) || [])].map((v) => v.trim());
  const dates = [...new Set(claim.match(DATE) || [])].map((v) => v.trim());
  const values = [...quantities, ...dates];
  const subject = values.length ? subjectOf(claim, values) : "";

  const queries: string[] = [];
  const push = (q: string) => {
    const value = q.replace(/\s{2,}/g, " ").trim().slice(0, 120);
    if (value.length >= 2 && !queries.includes(value) && queries.length < 3) queries.push(value);
  };

  // 原句永远排第一：先看有没有直接回应这句话材料的来源。
  push(claim);

  if (quantities.length >= 2 && subject) {
    // 多组数字冲突：每个数字单独查，才可能拿到各自的出处。
    for (const value of quantities.slice(0, 2)) push(`${subject} ${value}`);
  } else if (values.length === 1) {
    push(`${subject || claim} ${values[0]} 官方 公布`);
  } else {
    // 没有具体取值：用「官方/原文」把检索偏向一手材料。
    push(`${claim} 官方 公布`);
  }

  return {
    queries,
    source: "rule",
    note:
      quantities.length >= 2
        ? `原句含 ${quantities.length} 组数值，按每组数值分别检索，便于核对各自出处`
        : values.length
          ? "原句含具体取值/日期，补一条针对该取值的官方口径检索"
          : "补一条指向官方/原文的检索，减少二手转述",
  };
}

/**
 * 把用户的一句问句改写成「可核查的说法」。
 *
 * 归属判断要求证据句能对上事实本身；问句（为什么…？/是不是…？）几乎不可能
 * 在网页里逐字出现，于是所有来源都会被判成「无法确认」。这里只做改写，
 * 不改变用户的问题，也不推断答案：
 *  - 「A 有 X 和 Y 两种说法」→ 拆成两条：A 为 X、A 为 Y；
 *  - 「…是不是…？」→ 去掉疑问词，留下可判断的陈述；
 *  - 其余情况原样返回。
 */
/**
 * 去掉「这不是我在说，是我听来的」这类前缀。
 *
 * 长辈转发的原话几乎都带「网传 / 听说 / 群里在传 / 转发提醒」，把这些字当成
 * 待核查说法的一部分，会让来源永远无法逐字对上（没有哪篇科普会写「网传…」）。
 * 只删前缀与「是真的吗」这类问句尾巴，中间那个断言原样保留。
 */
const RUMOR_PREFIX =
  /^\s*(?:网传|网上传|网上说|网上都在说|群里在传|群里的说法是|朋友圈在传|朋友圈都在传|转发提醒|听朋友说|听家里人说|听说|据说|有人说|有报道称|看到一条(?:视频|消息)(?:说|称)?|视频里说|抖音上说|抖音上有人|传言|传闻)\s*[，,：:！!]?\s*/;

export function stripRumorWrapping(value: string): string {
  let out = String(value || "").trim();
  for (let i = 0; i < 3; i++) {
    const next = out.replace(RUMOR_PREFIX, "").trim();
    if (next === out) break;
    out = next;
  }
  // 「…是真的吗 / 可信吗 / 靠谱吗 / 到底是不是真的」这类尾巴不是断言的一部分。
  out = out
    .replace(/[，,]?\s*(?:这是真的吗|是真的吗|是真的么|可信吗|靠谱吗|属实吗|到底是不是真的|真的假的|对不对|吗)\s*$/, "")
    .replace(/^[，,。；;\s]+|[，,。；;\s]+$/g, "")
    .trim();
  return out || String(value || "").trim();
}

export function deriveClaims(question: string): { claims: string[]; note: string } {
  const text = stripRumorWrapping(question.trim().replace(/[？?]+$/, ""));
  const twoValues =
    /^(?:为什么|为何)?\s*(.+?)\s*(?:有|是|为)\s*([\d.]+\s*[辆台万亿万元人吨公里座条个项家倍%％]+)\s*(?:和|与|、)\s*([\d.]+\s*[辆台万亿万元人吨公里座条个项家倍%％]+)\s*(?:两种|两个|俩|不同)?(?:说法|数据|数字|口径)?$/.exec(
      text,
    );
  if (twoValues && twoValues[1].length >= 2) {
    const subject = twoValues[1].replace(/^(为什么|为何)/, "").trim();
    return {
      claims: [`${subject}为${twoValues[2].trim()}`, `${subject}为${twoValues[3].trim()}`],
      note: `原问题给了两组数值，已拆成两条可核查说法：分别核对 ${twoValues[2].trim()} 与 ${twoValues[3].trim()} 的出处`,
    };
  }
  // 「网传 X，是真的吗？」「有人说 X，可信吗？」：把传言本身当作待核查的说法，
  // 去掉「网传/有人说」和结尾的疑问，否则检索式和核验对象都会是整句问句。
  const rumor = /^(?:网传|网上的说法是|听说|据说|有人说|有报道称|传言)?[，,、]?(.+?)[，,]?\s*(?:这是真的吗|是真的吗|是真的么|可信吗|靠谱吗|属实吗|是不是真的|到底是不是真的|真的假的|吗)$/.exec(text);
  if (rumor && rumor[1].trim().length >= 4) {
    const claim = rumor[1].trim().replace(/[，,]?\s*(这个说法|这个结论|这种说法|这一说法)$/, "").trim();
    return {
      claims: [claim],
      note: "这是传言/疑问式的说法：已去掉「网传/有人说」和疑问结尾，把中间的断言作为待核查对象",
    };
  }
  const interrogative = /^(.*?)(?:是不是|是否|会不会|有没有)(.+)$/.exec(text);
  if (interrogative && interrogative[2].trim().length >= 2) {
    const claim = (interrogative[1] + interrogative[2]).replace(/\s{2,}/g, " ").trim();
    return {
      claims: [claim],
      note: "已把「是不是…」问句改写为可核查的陈述，逐字核对这句话是否成立",
    };
  }
  // 兜底也要用去掉「网传/听说」后的句子，否则前缀会一直挂在待核查说法上。
  const stripped = text.trim() || question.trim();
  return {
    claims: [stripped],
    note:
      stripped === question.trim()
        ? "按原句核查"
        : "已去掉「网传/听说」这类前缀，只核查中间那句可验证的说法",
  };
}
