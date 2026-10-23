import { useMemo, useState } from "react";
import { ArrowRight, Download, GitCompare } from "lucide-react";
import { outcomeText, relationText, varyingToken, type CaseDigest } from "./api";
import { archiveHref, caseHref, formatTime } from "./components";
import { statisticalScopePair, statisticalCardHtml } from "./presentation";

/** 把证据句前的站点样板（来源：/浏览字号/当前位置…）去掉，只留判断用得上的那句。 */
export function cleanSentence(value?: string | null) {
  if (!value) return "";
  let text = value.trim();
  // 先截掉站点栏目前缀：正文一般从书名号、新华社电头或直接陈述开始
  const marker = text.slice(0, 90).search(/《|新华社[^，。]{0,12}电|据[^，。]{0,10}(消息|报道)/);
  if (marker > 0) text = text.slice(marker);
  const noise = [
    /^当前位置[^《]{0,60}/u,
    /^首页[^《]{0,40}/u,
    /^[^《。]{0,40}浏览字号[^《。]{0,24}/u,
    /^来源[:：]\s*[^\s《]{1,20}\s*/u,
    /^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s*(?:\d{1,2}:\d{2}(?::\d{2})?)?\s*/u,
    /^[·•\-—|｜:：,，。\s]+/u,
  ];
  for (let i = 0; i < 5; i++) {
    const before = text;
    for (const pattern of noise) text = text.replace(pattern, "");
    if (text === before) break;
  }
  return text.trim();
}

export interface WatershedSide {
  label: string;
  claim: string;
  digest: CaseDigest;
}

function Side({ side, highlight, tone }: { side: WatershedSide; highlight?: string | null; tone: "left" | "right" }) {
  const { digest } = side;
  const sources = [...digest.sources].sort((a, b) => {
    const boundOriginal = (source: typeof a) => Number(source.quantityEvidence?.some((item) =>
      item.from === "body" && !item.approximate && item.statisticalSource !== "统计来源未注明"));
    return boundOriginal(b) - boundOriginal(a);
  });
  const keySentences = sources
    .filter((source) => source.keySentence && (source.relation === "supports" || source.relation === "contradicts"))
    .slice(0, 2);
  const fallback = sources.filter((source) => source.relation === "supports" || source.relation === "contradicts").slice(0, 2);
  const shown = keySentences.length ? keySentences : fallback;
  const outcome = digest.outcome;
  return (
    <article className="ws-side" data-tone={tone} data-outcome={outcome || "insufficient"}>
      <header className="ws-side-head">
        <span className="ws-side-label">{side.label}</span>
        <span className="ws-side-outcome">{outcome ? outcomeText[outcome] : "记录"}</span>
      </header>
      <p className="ws-claim">
        {highlight && side.claim.includes(highlight) ? (
          <>
            {side.claim.split(highlight)[0]}
            <mark>{highlight}</mark>
            {side.claim.split(highlight).slice(1).join(highlight)}
          </>
        ) : (
          side.claim
        )}
      </p>
      <p className="ws-statement">{digest.statement.replace(/^就「.*?」而言，/, "")}</p>
      <ul className="ws-stats">
        <li>
          <b>{digest.counts?.pages ?? sources.length}</b> 条网页
        </li>
        <li>
          <b>{digest.independentSources}</b> 未检测到重复
        </li>
        <li>
          <b>{digest.bodyBacked}</b> 份原文
        </li>
        <li>
          支持 <b>{digest.factCounts.supports}</b> · 反证 <b>{digest.factCounts.contradicts}</b>
        </li>
      </ul>
      <div className="ws-evidence">
        <h4>{outcome === "contradicted" ? "反证原文" : "关键原文"}</h4>
        {shown.length ? (
          <ul>
            {shown.map((source) => (
              <li key={source.pageId} data-relation={source.relation}>
                <a href={source.url} target="_blank" rel="noreferrer noopener">
                  {source.site}｜{source.title.slice(0, 30)}
                </a>
                <p>「{cleanSentence(source.keySentence) || source.excerpt.slice(0, 90)}」</p>
                <small>
                  {relationText[source.relation]}
                  {source.bodyStatus === "evidence_sentence" ? " · 正文已定位" : source.bodyAvailable ? " · 摘要" : " · 仅搜索摘要"}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="trace-hint">这次调查没有可展示的原文句。</p>
        )}
      </div>
      {digest.gaps.length ? (
        <div className="ws-gaps">
          <strong>仍然不确定</strong>
          <ul>
            {digest.gaps.slice(0, 2).map((gap, index) => (
              <li key={index}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="ws-gaps-ok">规则层面没有列出遗留缺口；关键表述仍建议打开原文核对。</p>
      )}
      <footer className="ws-side-foot">
        <a className="trace-link" href={caseHref(digest.runId)}>
          调查过程 <ArrowRight size={13} />
        </a>
        <a className="trace-link" href={archiveHref(digest.runId)}>
          调查档案
        </a>
        <span className="trace-mono">v{digest.versions || 1}</span>
      </footer>
    </article>
  );
}

/**
 * 事实分水岭：把两句话只差一个关键条件的两次真实调查并排放。
 * 所有数字、原文、结论都来自各自的调查记录；不在这里重新判断真假。
 */
export function Watershed({
  left,
  right,
  compact = false,
  historical = true,
  cardHref,
}: {
  left: WatershedSide;
  right: WatershedSide;
  compact?: boolean;
  historical?: boolean;
  /** 只读版里已有的静态对照卡文件（无需实时服务） */
  cardHref?: string;
}) {
  const diff = useMemo(() => varyingToken(left.claim, right.claim), [left.claim, right.claim]);
  const [focus, setFocus] = useState<"left" | "right">("right");
  const scopes = /超过\s*1300\s*万辆/.test(right.claim) ? statisticalScopePair(right.digest.sources) : null;

  function downloadVisualCard() {
    if (!scopes) return;
    const url = URL.createObjectURL(new Blob([statisticalCardHtml(right.claim, scopes)], {type:"text/html;charset=utf-8"}));
    const anchor=document.createElement("a");anchor.href=url;anchor.download="新能源汽车产量·视觉对照卡.html";anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function downloadCard() {
    const lines = [
      `# 事实对照卡：只改一个条件，结论为什么不同`,
      ``,
      `- 原句：${left.claim}`,
      `- 修改后：${right.claim}`,
      diff ? `- 关键差异：${diff.left} → ${diff.right}（其余文字相同）` : `- 关键差异：见两句对照`,
      ``,
      `## 原始说法（${left.label}）`,
      ``,
      `- 结论：${left.digest.outcome ? outcomeText[left.digest.outcome] : "记录"}`,
      `- 结论说明：${left.digest.statement}`,
      `- 规模：${left.digest.counts?.pages ?? left.digest.sources.length} 条网页 / ${left.digest.independentSources} 个未检测到重复 / ${left.digest.bodyBacked} 份原文`,
      `- 支持 ${left.digest.factCounts.supports} 条、反证 ${left.digest.factCounts.contradicts} 条、无法确认 ${left.digest.factCounts.unclear} 条`,
      ...left.digest.sources
        .filter((source) => source.keySentence)
        .slice(0, 3)
        .map((source) => `- 关键原文：${source.site}｜${source.title}｜「${cleanSentence(source.keySentence)}」${source.url}`),
      `- 调查档案：${window.location.origin}${archiveHref(left.digest.runId).replace(/^#/, "/#")}`,
      ``,
      `## 修改后说法（${right.label}）`,
      ``,
      `- 结论：${right.digest.outcome ? outcomeText[right.digest.outcome] : "记录"}`,
      `- 结论说明：${right.digest.statement}`,
      `- 规模：${right.digest.counts?.pages ?? right.digest.sources.length} 条网页 / ${right.digest.independentSources} 个未检测到重复 / ${right.digest.bodyBacked} 份原文`,
      `- 支持 ${right.digest.factCounts.supports} 条、反证 ${right.digest.factCounts.contradicts} 条、无法确认 ${right.digest.factCounts.unclear} 条`,
      ...right.digest.sources
        .filter((source) => source.keySentence)
        .slice(0, 3)
        .map((source) => `- 关键原文：${source.site}｜${source.title}｜「${cleanSentence(source.keySentence)}」${source.url}`),
      `- 调查档案：${window.location.origin}${archiveHref(right.digest.runId).replace(/^#/, "/#")}`,
      ``,
      `## 说明`,
      ``,
      `- 两次调查分别独立执行（元宝搜索真实检索、规则判定${historical ? "，其中一条含 DeepSeek 辅助复核" : ""}）。`,
      `- 本卡片不重新判断真假，只并列两次调查的真实结果与原文。`,
      `- 未检测到重复不等于已证明独立；仍不确定的部分见各档案。`,
      ``,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "事实对照卡.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className={`watershed${compact ? " watershed-compact" : ""}`} aria-label="事实分水岭对照">
      <header className="ws-head">
        <div>
          <span className="ws-eyebrow">
            <GitCompare size={14} /> 事实分水岭
          </span>
          <h2>只改一个条件，结论为什么完全不同？</h2>
          {diff ? (
            <p className="ws-diff">
              两句话只差一处：<del>{diff.left}</del> <ArrowRight size={12} /> <ins>{diff.right}</ins>
              {historical ? <span className="ws-flag">两次都是已完成的真实调查记录</span> : null}
            </p>
          ) : (
            <p className="ws-diff">
              对照两次真实调查{historical ? <span className="ws-flag">历史记录</span> : null}
            </p>
          )}
        </div>
        <div className="ws-actions">
          <div className="ws-toggle" role="tablist" aria-label="切换要看的说法">
            <button type="button" role="tab" aria-selected={focus === "left"} data-active={focus === "left"} onClick={() => setFocus("left")}>
              原句：{diff?.left || left.label}
            </button>
            <button type="button" role="tab" aria-selected={focus === "right"} data-active={focus === "right"} onClick={() => setFocus("right")}>
              改后：{diff?.right || right.label}
            </button>
          </div>
          <button type="button" className="trace-btn trace-btn-ghost" onClick={downloadCard}>
            <Download size={14} /> 下载文字报告（Markdown）
          </button>
          {cardHref ? (
            <a className="trace-btn" href={cardHref} download>
              <Download size={14} /> 下载静态文字报告
            </a>
          ) : null}
          {scopes ? <button type="button" className="trace-btn trace-btn-primary" onClick={downloadVisualCard}><Download size={14} /> 下载视觉对照卡（单页HTML）</button> : null}
          {scopes && cardHref ? <a className="trace-btn" href={cardHref.replace("新能源产量对照卡.md","新能源产量视觉对照卡.png")} download><Download size={14} /> 下载PNG对照卡</a> : null}
        </div>
      </header>

      <div className="ws-grid" data-focus={focus}>
        <Side side={left} highlight={diff?.left} tone="left" />
        <div className="ws-divider" aria-hidden="true">
          <span>VS</span>
        </div>
        <Side side={right} highlight={diff?.right} tone="right" />
      </div>

      {scopes ? <section id="ws-quantity-scope" className="ws-scope" aria-label="为什么答案不同：统计口径差异">
        <header><h3>为什么答案不同</h3><p>针对“超过1300万辆”，先明确使用哪套统计口径。</p></header>
        <div className="ws-scope-grid">
          <article><h4>国家统计局</h4><strong>{scopes.nbs.value}<small>{scopes.nbs.unit}</small></strong><b>支持超过1300万辆</b><p>{scopes.nbs.scope}</p>
            <details><summary>查看真正包含数字的原始证据句</summary><blockquote>{scopes.nbs.sentence}</blockquote><p className="trace-hint">年份上下文：{scopes.nbs.context}</p><a href={scopes.nbs.url} target="_blank" rel="noreferrer noopener">打开国家统计局原文</a></details>
          </article>
          <div className="ws-scope-difference"><b>统计口径<br />差异</b><span>不能当作<br />同口径直接矛盾</span></div>
          <article><h4>中国汽车工业协会</h4><strong>{scopes.caam.value}<small>{scopes.caam.unit}</small></strong><b>未超过1300万辆</b><p>工信部引用中汽协数据；原页未细列企业覆盖边界。</p>
            <details><summary>查看真正包含数字的原始证据句</summary><blockquote>{scopes.caam.sentence}</blockquote><p className="trace-hint">年份上下文：{scopes.caam.context}</p><a href={scopes.caam.url} target="_blank" rel="noreferrer noopener">打开工信部原文</a></details>
          </article>
        </div><p className="ws-scope-note">两组数据都保留。未指定统计来源和适用范围时，结论保留“存在争议（统计口径差异）”；不自动认定其中一方错误。</p>
      </section> : null}

      <div className="ws-why">
        <h3>为什么判断不同</h3>
        <ul>
          <li>
            <b>{diff ? `${diff.left} → ${diff.right}` : "条件不同"}</b>
            {left.digest.outcome === right.digest.outcome
              ? "：两次调查的结论类型相同，说明这一处改动没有改变证据格局。"
              : scopes ? "：1200万辆与1300万辆的门槛不同；1300万辆还涉及统计来源与覆盖范围差异，不是同口径权威来源直接矛盾。" : `：左侧「${left.digest.outcome ? outcomeText[left.digest.outcome] : "记录"}」，右侧「${
                  right.digest.outcome ? outcomeText[right.digest.outcome] : "记录"
                }」，差异来自证据对这两个条件的不同表述。`}
          </li>
          <li>
            <b>证据指向</b>
            ：左侧支持 {left.digest.factCounts.supports} 条、反证 {left.digest.factCounts.contradicts} 条；右侧支持{" "}
            {right.digest.factCounts.supports} 条、反证 {right.digest.factCounts.contradicts} 条。
          </li>
          <li>
            <b>仍需注意</b>
            ：未检测到重复不等于已证明独立；两次调查都保留了各自的档案版本与原文链接，可逐条复核。
          </li>
        </ul>
      </div>
    </section>
  );
}

export function PairStamp({ at }: { at?: string }) {
  return <span className="trace-mono">{at ? formatTime(at) : ""}</span>;
}
