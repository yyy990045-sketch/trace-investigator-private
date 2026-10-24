/**
 * 通用说法语义：把一句待核查的话拆成可比对的结构，再和真实原句比较。
 *
 * 这一层只做「语义关系的粗粒度判断」，不生成任何事实：
 *  - 主体 / 行为 / 对象 / 范围（型号、地区）/ 时间 / 限定（已经、计划、部分）/ 关系性质；
 *  - 输出五档：直接支持 / 直接反驳 / 只支持一部分 / 有关联但不足以证明 / 无关或无法确认。
 *
 * 三条硬约束（都会体现在判定里）：
 *  1. 观察到「相关」不能说成「已经证明因果」；
 *  2. 某型号停产不等于整个系列停产；
 *  3. 未来计划不等于已经发生。
 */

export type ClaimVerdict =
  | "direct_support"
  | "direct_refute"
  | "partial"
  | "related_only"
  | "unrelated";

export type RelationNature = "fact" | "correlation" | "causation" | "prediction";

export interface ClaimSemantics {
  text: string;
  subject: string;
  /** 行为或属性，例如「停产」「延长寿命」 */
  predicate: string;
  /** 行为涉及的对象，例如「寿命」 */
  object: string;
  /** 范围限定：型号、地区、人群等，用户原话里出现的限定词 */
  scope: string[];
  /** 时间：用户原话里的年份/时间 */
  time: string[];
  /** 限定词：已经 / 计划 / 可能 / 全部 / 部分 */
  modality: "done" | "planned" | "possible" | "partial" | "unknown";
  nature: RelationNature;
}

const MODALITY = {
  done: /(已经|已|业已|正式|宣布.*停产|完成了?)/,
  planned: /(将|计划|预计|拟|即将|明年|下月|下一?代|未来)/,
  possible: /(可能|或许|也许|有可能|疑似|据说)/,
  partial: /(部分|一些|某些|有的|个别|多数|大部分)/,
};

/** 行为/属性的同义表达：同一件事的不同说法都算同一谓词。 */
const PREDICATES: { key: string; pattern: RegExp; synonyms: RegExp }[] = [
  { key: "停产", pattern: /(停产|停止生产|终止生产|停产停售|不再生产|停止制造)/, synonyms: /(停产|停止生产|终止生产|不再生产|停产停售|退市)/ },
  { key: "停售", pattern: /(停售|停止销售|下架|不再销售)/, synonyms: /(停售|停止销售|下架|不再销售)/ },
  { key: "延长寿命", pattern: /(延长寿命|长寿|活得更久|降低死亡率|延寿|更有益健康)/, synonyms: /(延长寿命|降低死亡率|寿命(更长|延长)|延寿|死亡率(下降|更低|降低)|更低.{0,2}死亡率|活得更久|长寿|更有益)/ },
  { key: "缩短寿命", pattern: /(缩短寿命|减寿|死亡率上升|增加死亡风险)/, synonyms: /(缩短寿命|减寿|死亡率上升|死亡风险增加)/ },
  { key: "发布", pattern: /(发布|推出|上市|开售)/, synonyms: /(发布|推出|上市|开售)/ },
  { key: "涨价", pattern: /(涨价|提价|价格上涨)/, synonyms: /(涨价|提价|上调价格)/ },
  { key: "裁员", pattern: /(裁员|裁撤|减员)/, synonyms: /(裁员|裁撤|减员)/ },
];

/** 因果关系词：说法里有这些词，就必须要求来源也明确给出因果。 */
const CAUSAL = /(导致|引起|造成|使得|会让|能让人|能延长|能降低|因此|从而|因为.*所以)/;
/** 只说「相关」的表述：不能升级成因果。 */
const CORRELATION = /(相关|关联|有关联|有关|伴随|同时出现|倾向于)/;
/** 预测/计划语气：不能当作已发生。 */
const FUTURE = /(计划|预计|将于|拟|即将|未来|有望|可能会|明年|下月)/;
/** 明确否定。 */
const DENY = /(并非|不是|否认|辟谣|不实|谣言|没有发生|并未|未曾|未正式|尚未)/;

function clean(text: string) {
  return String(text || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** 型号：字母+数字（PS4、iPhone 15、Switch 2）或「X 系列」。 */
export function modelTokens(text: string): string[] {
  const value = clean(text);
  const out = new Set<string>();
  for (const match of value.matchAll(/[A-Za-z]+\s?\d+[A-Za-z]*/g)) out.add(match[0].replace(/\s+/g, " "));
  for (const match of value.matchAll(/([\u4e00-\u9fa5]{2,8})\s?(?:系列|全系|全线)/g)) out.add(match[0].replace(/\s+/g, ""));
  return [...out];
}

export function parseClaim(text: string): ClaimSemantics {
  const value = clean(text);
  const predicate = PREDICATES.find((item) => item.pattern.test(value))?.key || "";
  const future = FUTURE.test(value);
  const modality: ClaimSemantics["modality"] = MODALITY.planned.test(value) || future
    ? "planned"
    : MODALITY.possible.test(value)
      ? "possible"
      : MODALITY.partial.test(value)
        ? "partial"
        : MODALITY.done.test(value)
          ? "done"
          : "unknown";
  const nature: RelationNature = CAUSAL.test(value)
    ? "causation"
    : /(研究|调查|发现|数据显示|有科学依据|证明)/.test(value) && CORRELATION.test(value)
      ? "correlation"
      : future
        ? "prediction"
        : "fact";
  const models = modelTokens(value);
  const regions = [...new Set(value.match(/(中国|国内|日本|美国|欧洲|国行|港版|全球|大陆|台湾|香港)/g) || [])];
  const time = [...new Set(value.match(/(?:19|20)\d{2}\s*年?|(?:今|明|去)年|\d{1,2}\s*月/g) || [])];
  // 主体：取第一个名词性片段（去掉限定词与谓词）
  const predicatePattern = new RegExp(
    PREDICATES.map((item) => item.pattern.source).join("|"),
    "g",
  );
  const subjectSource = value
    .replace(/(网上说|网传|有人说|听说|据说|据报道|传言|是真的吗|有科学依据吗|吗|？|\?)/g, "")
    .replace(predicatePattern, " ")
    .replace(/(已经|已|正式|计划|预计|可能|会|能|可以|全部|部分|系列)/g, " ")
    .replace(/(每天|每日|经常|常常|长期|大量|经常性|有人|网上|据说)/g, " ")
    .trim();
  const subject = models[0] || subjectSource.split(/[，,。；;、\s]/).filter(Boolean)[0] || "";
  const object = /([\u4e00-\u9fa5]{2,8})(寿命|销量|价格|产能|库存|业绩|死亡率)/.exec(value)?.[0] || "";
  return {
    text: value,
    subject,
    predicate,
    object,
    scope: [...models, ...regions],
    time,
    modality,
    nature,
  };
}

export interface SentenceVerdict {
  verdict: ClaimVerdict;
  reason: string;
  /** 这句是否足以作为该说法的支持证据（partial/related 都不算） */
  sufficient: boolean;
}

/**
 * 比较一句真实原句和待核查说法。
 * 返回的每一档都带理由，页面上要能解释「为什么这句只能算相关」。
 */
export function compareSentence(claim: ClaimSemantics, sentence: string): SentenceVerdict {
  const text = clean(sentence);
  if (!text) return { verdict: "unrelated", reason: "空句子", sufficient: false };

  // 1) 行为必须对得上：说法要「停产」，来源只说「发布」不算。
  const predicateHit = PREDICATES.find((item) => item.key === claim.predicate);
  const hasPredicate = predicateHit ? predicateHit.synonyms.test(text) : Boolean(claim.predicate) && text.includes(claim.predicate);
  if (claim.predicate && !hasPredicate) {
    const subjectHit = claim.subject && text.includes(claim.subject);
    return {
      verdict: subjectHit ? "related_only" : "unrelated",
      reason: subjectHit
        ? `提到了「${claim.subject}」，但说的不是「${claim.predicate}」这件事`
        : "既没有同一主体，也没有同一行为",
      sufficient: false,
    };
  }

  // 2) 型号范围：说法是「PS4」，来源只说「PS4 Pro」——不能当成同一件事。
  const subjectHit = (() => {
    if (!claim.subject) return true;
    if (text.includes(claim.subject)) return true;
    // 说法里的主体常带修饰（「每天喝咖啡」），只要核心词（≥2 字）出现就算对上。
    const fragments = claim.subject.split(/[，,。；;、\s]/).filter((part) => part.length >= 2);
    return fragments.some((part) => {
      for (let i = 0; i + 2 <= part.length; i++) if (text.includes(part.slice(i, i + 2))) return true;
      return false;
    });
  })();
  if (claim.subject && !subjectHit) {
    const sameFamily = claim.scope.some((scope) => text.includes(scope));
    return {
      verdict: sameFamily ? "related_only" : "unrelated",
      reason: sameFamily
        ? `来源只说到了同系列的其他型号，没有直接说「${claim.subject}」`
        : `来源没有出现「${claim.subject}」`,
      sufficient: false,
    };
  }
  // 「PS4 Pro」里包含「PS4」，但那是另一个型号：名字后面紧跟型号后缀就要单独处理。
  if (claim.subject) {
    const at = text.indexOf(claim.subject);
    if (at >= 0) {
      const after = text.slice(at + claim.subject.length, at + claim.subject.length + 8);
      const suffix = /^\s?(Pro|Slim|Plus|Max|Mini|Ultra|Lite|SE|Air|系列|全系)/i.exec(after);
      const numeric = /^\s?\d/.exec(after);
      const specific = (suffix?.[0] || numeric?.[0] || "").replace(/\s/g, "");
      if (specific && !claim.text.includes(specific)) {
        return {
          verdict: "partial",
          reason: `来源讲的是具体型号「${claim.subject} ${specific}」，不能据此说「${claim.subject}」整个系列都这样`,
          sufficient: false,
        };
      }
    }
  }
  const narrower = modelTokens(text).filter(
    (model) =>
      model !== claim.subject &&
      text.includes(model) &&
      claim.subject &&
      model.startsWith(claim.subject) &&
      !claim.text.includes(model),
  );
  if (claim.subject && !/(系列|全系|全线)/.test(claim.text) && narrower.length && !narrower.some((model) => claim.text.includes(model))) {
    return {
      verdict: "partial",
      reason: `来源讲的是具体型号（${narrower.join("、")}），不能据此说整个系列都这样`,
      sufficient: false,
    };
  }

  // 3) 否定必须有明确的对象。"没有证据证明 X" 不能反推 "X 已被证明为假"；
  // "研究并不是说 X" 只说明研究本身不足以证明 X。
  const deny = DENY.exec(text);
  if (deny) {
    const epistemic = /(不能证明|无法证明|尚无证据|没有证据|缺乏证据|没有证明|未能证明|尚未证实|未证实|并不意味着|不代表|不能说明|无法说明|并不是说|不能得出|不能确定|不等于|无法确定)/.test(text);
    if (epistemic) {
      return {
        verdict: "partial",
        reason: "来源指出证据或研究结论不足，不能据此认定现实中的相反命题已经成立",
        sufficient: false,
      };
    }
    const directlyNegated = text
      .split(/[，,；;]/)
      .some((clause) => DENY.test(clause) &&
        Boolean(predicateHit?.synonyms.test(clause)) &&
        (!claim.subject || clause.includes(claim.subject) || clause.includes("该产品") || clause.includes("这一说法")));
    if (!directlyNegated) {
      return {
        verdict: "related_only",
        reason: "原句出现否定词，但未能确认其否定对象就是当前待查说法",
        sufficient: false,
      };
    }
    return { verdict: "direct_refute", reason: `来源明确否定对应主体的「${claim.predicate}」表述`, sufficient: true };
  }

  // 4) 已经发生 vs 计划/预测：说法是「已停产」，来源说「将停产」只能算相关系。
  if (claim.modality === "done" && FUTURE.test(text)) {
    return {
      verdict: "related_only",
      reason: "来源说的是计划或预测，不能证明「已经发生」",
      sufficient: false,
    };
  }

  // 5) 因果 vs 相关/转述：说法是因果，但来源只是媒体转述研究结论（没有因果表述），
  //    不能当成「已经证明因果」。
  // 因果类说法：来源里没有明确的因果表述（导致/引起/因此…）就只能算部分支持，
  // 「有助于」「相关」都不是因果证明，媒体转述研究结论同样不是。
  if (claim.nature === "causation" && !CAUSAL.test(text)) {
    return {
      verdict: "partial",
      reason: CORRELATION.test(text)
        ? "来源只给出相关性，没有证明因果"
        : "来源是转述研究/媒体结论，没有给出因果证明",
      sufficient: false,
    };
  }
  // 6) 时间/地区限定：说法带了具体年份或地区，来源必须对得上。
  if (claim.time.length && !claim.time.some((time) => text.includes(time.replace(/\s/g, "")))) {
    return {
      verdict: "partial",
      reason: `来源没有对应说法里的时间（${claim.time.join("、")})`,
      sufficient: false,
    };
  }

  return {
    verdict: "direct_support",
    reason: `同一主体、同一行为${claim.predicate ? `（${claim.predicate}）` : ""}，且没有否定或时间错位`,
    sufficient: true,
  };
}

/** 把五档结果压成 relation 语义，供既有统计使用。 */
export function relationOf(verdict: ClaimVerdict): "supports" | "contradicts" | "unclear" | "irrelevant" {
  if (verdict === "direct_support") return "supports";
  if (verdict === "direct_refute") return "contradicts";
  if (verdict === "partial" || verdict === "related_only") return "unclear";
  return "irrelevant";
}
