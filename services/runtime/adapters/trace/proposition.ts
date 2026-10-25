/** Conservative sentence-bound comparison for possession / existence claims. */
export interface PropositionDecision {
  verdict: "direct_support" | "direct_refute" | "partial" | "related_only" | "unrelated";
  reason: string;
  sufficient: boolean;
}

const EXISTENCE = /并没有|没有|不具有|未拥有|不拥有|并无|不存在|拥有|具有|存在|有|无/g;
const EPISTEMIC = /没有证据|尚无证据|缺乏证据|无法证明|不能证明|未能证明|尚未证实|不能确定|并不意味着|不代表|并不是说/;
const WIDE = /所有|全部|全体|一切/;
const UNIQUE = /唯一|仅有|只有/;

function objectKey(value: string) {
  return value.normalize("NFKC").trim()
    .replace(/[。！？!?].*$/, "")
    .replace(/的(?:行星|星球|国家|城市|产品|动物|作品|企业).*$/, "")
    .replace(/(?:的|了)$/, "")
    .replace(/^(?:自己的|任何|一[颗个种条项]|多[颗个种条项]|许多|若干|一些|[零一二三四五六七八九十\d]+[颗个种条项])+/g, "");
}

function subjects(prefix: string) {
  return prefix.replace(/^.*[，,；;：:]/, "")
    .replace(/是.*$/, "")
    .replace(/^.*(?:只有|仅有)/, "")
    .replace(/^(?:不过|但是|而|其中|比如|例如|距离太阳最近的)/, "")
    .replace(/(?:也|都|均|皆|全部|并|是)$/, "")
    .split(/和|与|及|、/).map((s) => s.trim()).filter(Boolean);
}

function possessions(text: string) {
  const out: { subjects: string[]; negative: boolean; object: string; prefix: string }[] = [];
  for (const clause of text.normalize("NFKC").split(/[，,；;。！？!?]/)) {
    for (const match of clause.matchAll(EXISTENCE)) {
      const prefix = clause.slice(0, match.index);
      if (/不是|并非|不可能|如果|假如|是否|会不会/.test(prefix)) continue;
      const object = objectKey(clause.slice(match.index! + match[0].length));
      const bound = subjects(prefix);
      if (object && bound.length) out.push({ subjects: bound, negative: /^(并没有|没有|不|未|并无|无)/.test(match[0]), object, prefix });
    }
  }
  return out;
}

/** null means this grammar does not bind: other specialised comparisons may try. */
export function comparePossession(claimText: string, sentence: string): PropositionDecision | null {
  const claim = possessions(claimText).at(-1);
  if (!claim || claim.object.length < 2 || /证据|可能|说法/.test(claim.object)) return null;
  const candidates = possessions(sentence).filter((item) => {
    if (item.object === claim.object) return true;
    // Absence of all satellites entails absence of natural satellites; the reverse does not.
    return item.negative && claim.object === "天然卫星" && item.object === "卫星";
  });
  if (!candidates.length) return { verdict: "related_only", reason: "原句未绑定到同一主体与属性，不能凭关键词或否定词裁决", sufficient: false };
  if (EPISTEMIC.test(sentence)) return { verdict: "related_only", reason: "缺少证明不等于相反事实成立", sufficient: false };
  if (/可能|或许|也许|如果|假如|疑似|预计|有望/.test(sentence)) return { verdict: "related_only", reason: "原句是可能性或条件句，不是确定的支持或反证", sufficient: false };
  const uniqueScope = claimText.match(/是(.+?)(?:唯一|仅有)/)?.[1]?.replace(/[中的]$/, "");
  if (UNIQUE.test(claimText) && (!uniqueScope || sentence.includes(uniqueScope)) && candidates.some((item) => item.negative === claim.negative && item.subjects.some((s) => !claim.subjects.includes(s))))
    return { verdict: "direct_refute", reason: "同一范围的另一主体也具有该属性，与「唯一」限定相反", sufficient: true };
  const matches = candidates.filter((item) => item.subjects.some((s) => claim.subjects.includes(s)));
  if (!matches.length) return { verdict: "related_only", reason: "原句中的属性属于其他主体", sufficient: false };
  if (matches.some((item) => item.negative !== claim.negative)) {
    return { verdict: "direct_refute", reason: "同一主体、同一属性的肯否方向相反", sufficient: true };
  }
  const covered = claim.subjects.every((s) => matches.some((item) => item.subjects.includes(s)));
  if (!covered) return { verdict: "partial", reason: "原句只覆盖部分主体，不能支持全部主体的说法", sufficient: false };
  if (UNIQUE.test(claimText)) {
    const scope = uniqueScope;
    if ((!scope || sentence.includes(scope)) && matches.some((item) => item.subjects.some((s) => !claim.subjects.includes(s)))) {
      return { verdict: "direct_refute", reason: "同一范围内还有其他主体具有该属性，与「唯一」限定相反", sufficient: true };
    }
    if (!UNIQUE.test(sentence) || (scope && !sentence.includes(scope))) return { verdict: "partial", reason: "核到了属性，但没有核到同一范围内的「唯一」限定", sufficient: false };
  }
  if (WIDE.test(claimText) && !WIDE.test(sentence)) return { verdict: "partial", reason: "原句未覆盖说法要求的全部范围", sufficient: false };
  if (matches.some((item) => /可能|也许|如果|假如|是否/.test(item.prefix))) return { verdict: "related_only", reason: "原句是可能性或条件句，不是已确认事实", sufficient: false };
  return { verdict: "direct_support", reason: "同一句覆盖全部待查主体与属性，肯否方向一致", sufficient: true };
}
