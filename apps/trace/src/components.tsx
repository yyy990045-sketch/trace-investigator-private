/** TRACE 共用视图组件：只渲染真实运行数据，不引入演示内容。 */
import { useState } from "react";
import { Link } from "react-router-dom";
import type { RunRecord } from "@personal/capability-sdk";
import {
  SHOWCASE,
  outcomeText,
  relationText,
  stepText,
  type FactAssessment,
  type Relation,
  type SourceAssessment,
  type SourceCluster,
} from "./api";

export function Tag({
  tone,
  children,
}: {
  tone: "support" | "oppose" | "unclear" | "muted" | "pending" | "neutral";
  children: React.ReactNode;
}) {
  return <span className={`trace-tag trace-tag-${tone}`}>{children}</span>;
}

export function relationTone(relation: Relation): "support" | "oppose" | "unclear" | "muted" {
  if (relation === "supports") return "support";
  if (relation === "contradicts") return "oppose";
  if (relation === "irrelevant") return "muted";
  return "unclear";
}

/** 站内链接：只读展示用 hash 路由，工作区用普通路径。 */
export function caseHref(runId: string) {
  return SHOWCASE ? `#/cases/${runId}` : `/cases/${runId}`;
}
export function archiveHref(runId: string) {
  return SHOWCASE ? `#/archive/${runId}` : `/archive/${runId}`;
}

export function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const originalityText: Record<SourceAssessment["originality"], string> = {
  original_candidate: "疑似原始出处",
  reprint: "转载/二次传播",
  unknown: "出处未判定",
};

/** 把「这条修正到底改变了什么」写成一句人话。 */
export function impactText(impact: {
  sourceBefore: string;
  sourceAfter: string;
  factBefore: string;
  factAfter: string;
  supportsBefore: number;
  supportsAfter: number;
  clustersBefore: number;
  clustersAfter: number;
  verdictBefore: string;
  verdictAfter: string;
}) {
  const rel = (value: string) => relationText[value as Relation] || value;
  const parts: string[] = [];
  if (impact.factBefore !== impact.factAfter)
    parts.push(`事实判断 ${rel(impact.factBefore)} → ${rel(impact.factAfter)}`);
  if (impact.supportsBefore !== impact.supportsAfter)
    parts.push(`支持来源 ${impact.supportsBefore} → ${impact.supportsAfter} 条`);
  if (impact.clustersBefore !== impact.clustersAfter)
    parts.push(`独立来源 ${impact.clustersBefore} → ${impact.clustersAfter} 个`);
  const outcome = (value: string) => outcomeText[value as keyof typeof outcomeText] || value;
  const verdict =
    impact.verdictBefore === impact.verdictAfter
      ? `结论类型未变（${outcome(impact.verdictBefore)}）`
      : `结论类型 ${outcome(impact.verdictBefore)} → ${outcome(impact.verdictAfter)}`;
  parts.push(verdict);
  return parts.join("；");
}

export type CorrectHandler = (
  source: SourceAssessment,
  relation: Relation,
  note: string,
) => Promise<string | null>;

/** 可人工修正的四种关系；「存在争议/无可用来源」是事实级结论，不在单条证据上选。 */
const correctable: Relation[] = ["supports", "contradicts", "unclear", "irrelevant"];

export function SourceCard({
  source,
  cluster,
  onFollowup,
  onCorrect,
  fresh,
}: {
  source: SourceAssessment;
  cluster?: SourceCluster;
  onFollowup?: (source: SourceAssessment) => void;
  onCorrect?: CorrectHandler;
  fresh?: boolean;
}) {
  const keyText = source.bodyExcerpt || source.excerpt;
  const [open, setOpen] = useState(false);
  const [relation, setRelation] = useState<Relation>(source.relation);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const corrected = source.manualCorrection || null;

  async function save() {
    if (!onCorrect || busy) return;
    if (note.trim().length < 2) {
      setError("请写一句修正原因，便于别人复核。");
      return;
    }
    setBusy(true);
    setError(null);
    const message = await onCorrect(source, relation, note.trim());
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setOpen(false);
    setNote("");
  }

  return (
    <article className="trace-evidence" data-relation={source.relation} data-duplicate={source.duplicate ? "true" : "false"}>
      <div className="trace-evidence-head">
        <a className="trace-evidence-title" href={source.url} target="_blank" rel="noreferrer noopener">
          {source.title}
        </a>
        <Tag tone={relationTone(source.relation)}>{relationText[source.relation]}</Tag>
      </div>
      <div className="trace-evidence-meta">
        <span>{source.site}</span>
        <span>{source.date || "未标注时间"}</span>
        <span>{source.bodyAvailable ? "原文正文已取" : "仅搜索摘要"}</span>
        <span>{originalityText[source.originality]}</span>
        {fresh ? <span className="trace-evidence-fresh">本次追问新增</span> : null}
        {corrected ? <span className="trace-evidence-fixed">人工修正</span> : null}
      </div>
      {corrected ? (
        <p className="trace-evidence-reprint">
          {source.autoRelation
            ? `系统自动判断为「${relationText[source.autoRelation]}」，已由 ${corrected.actor} 修正为「${relationText[source.relation]}」：${corrected.note}`
            : `已由 ${corrected.actor} 人工确认为「${relationText[source.relation]}」：${corrected.note}`}
        </p>
      ) : null}
      {source.duplicate && cluster ? (
        <p className="trace-evidence-reprint">
          与「{cluster.primary.site}」为同一原始内容，按 1 条独立证据计算。
        </p>
      ) : null}
      {keyText ? (
        <blockquote className="trace-quote">
          <span className="trace-quote-label">{source.bodyExcerpt ? "原文摘录" : "搜索摘要"}</span>
          {keyText}
        </blockquote>
      ) : null}
      <div className="trace-evidence-actions">
        <a className="trace-link" href={source.url} target="_blank" rel="noreferrer noopener">
          打开原始网页
        </a>
        {onFollowup ? (
          <button type="button" className="trace-link trace-link-button" onClick={() => onFollowup(source)}>
            就这条继续追问
          </button>
        ) : null}
        {onCorrect ? (
          <button
            type="button"
            className="trace-link trace-link-button"
            aria-expanded={open}
            onClick={() => {
              setError(null);
              setRelation(source.relation === "mixed" || source.relation === "none" ? "unclear" : source.relation);
              setOpen((value) => !value);
            }}
          >
            {open ? "取消修正" : corrected ? "再次修正这条判断" : "修正这条判断"}
          </button>
        ) : null}
        <details className="trace-evidence-why">
          <summary>为什么这样判断</summary>
          <ul className="trace-notes">
            {source.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
            <li>{source.dateNote}</li>
          </ul>
        </details>
      </div>
      {corrected?.impact ? (
        <p className="trace-impact">对结论的影响：{impactText(corrected.impact)}</p>
      ) : null}
      {open ? (
        <div className="trace-correct">
          <p className="trace-correct-head">
            这条来源与事实的关系应该是？
            <span>只改判断，不改原始搜索返回与摘录。</span>
          </p>
          <div className="trace-correct-options" role="radiogroup" aria-label="选择正确的证据关系">
            {correctable.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={relation === item}
                data-active={relation === item ? "true" : "false"}
                className="trace-correct-option"
                onClick={() => setRelation(item)}
              >
                {relationText[item]}
              </button>
            ))}
          </div>
          <input
            className="trace-input"
            maxLength={200}
            value={note}
            placeholder="一句话说明为什么（例如：原文标题已明确写出投运时间）"
            onChange={(event) => setNote(event.target.value)}
          />
          {error ? <div className="trace-alert">{error}</div> : null}
          <div className="trace-correct-actions">
            <button type="button" className="trace-btn trace-btn-primary" onClick={save} disabled={busy}>
              {busy ? "正在重算…" : "保存修正并重算结论"}
            </button>
            <span className="trace-hint">重算后结论若变化，需要重新确认才会生成新版本档案。</span>
          </div>
        </div>
      ) : null}
    </article>
  );
}

const order: Relation[] = ["supports", "contradicts", "unclear", "irrelevant"];

export function FactBlock({
  fact,
  factId,
  clusters,
  freshPageIds,
  onFollowup,
  onCorrect,
}: {
  fact: FactAssessment;
  factId: string;
  clusters: SourceCluster[];
  freshPageIds: Set<string>;
  onFollowup: (fact: FactAssessment, source?: SourceAssessment) => void;
  onCorrect?: CorrectHandler;
}) {
  const clusterById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const sorted = [...fact.sources].sort(
    (a, b) => order.indexOf(a.relation) - order.indexOf(b.relation) || b.relevance - a.relevance,
  );
  const shown = sorted.filter((source) => source.relation !== "irrelevant");
  const irrelevant = sorted.filter((source) => source.relation === "irrelevant");

  return (
    <section className="trace-fact" id={`fact-${factId}`}>
      <header className="trace-fact-head">
        <h3>{fact.fact}</h3>
        <Tag tone={relationTone(fact.relation as Relation)}>{relationText[fact.relation]}</Tag>
      </header>
      <div className="trace-fact-stats">
        <span>
          支持 <b>{fact.supports}</b>
        </span>
        <span>
          反对 <b>{fact.contradicts}</b>
        </span>
        <span>
          无法确认 <b>{fact.unclear ?? 0}</b>
        </span>
        <span>
          无关 <b>{fact.irrelevant ?? 0}</b>
        </span>
        <span>
          独立来源 <b>{fact.independentClusters}</b>
        </span>
        <span>
          取得原文 <b>{fact.bodyBackedClusters}</b>
        </span>
      </div>

      {shown.length ? (
        <div className="trace-evidence-list">
          {shown.map((source) => (
            <SourceCard
              key={source.pageId}
              source={source}
              cluster={clusterById.get(source.clusterId)}
              fresh={freshPageIds.has(source.pageId)}
              onFollowup={(item) => onFollowup(fact, item)}
              onCorrect={onCorrect}
            />
          ))}
        </div>
      ) : (
        <p className="trace-empty-inline">
          没有任何来源直接表述这条事实。可以换个更具体的检索式，或就这条继续追问。
        </p>
      )}

      <div className="trace-fact-foot">
        <button type="button" className="trace-btn trace-btn-ghost" onClick={() => onFollowup(fact)}>
          就这条事实补充检索
        </button>
        {irrelevant.length ? (
          <details className="trace-details">
            <summary>{irrelevant.length} 条命中但与本事实无关（不计入判断）</summary>
            <ul className="trace-notes">
              {irrelevant.map((source) => (
                <li key={source.pageId}>
                  <a className="trace-link" href={source.url} target="_blank" rel="noreferrer noopener">
                    {source.title}
                  </a>
                  <span className="trace-mono"> · {source.site}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}

export function StepRail({ run }: { run: RunRecord }) {
  const done = run.steps.filter((step) => step.status === "completed").length;
  const total = run.steps.length;
  return (
    <div className="trace-progress" aria-label="调查进度">
      <div className="trace-progress-bar">
        <span style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} />
      </div>
      <ol className="trace-progress-steps">
        {run.steps.map((step) => {
          const state =
            step.status === "completed"
              ? "complete"
              : step.status === "running" || step.status === "waiting_approval"
                ? "current"
                : step.status === "failed" || step.status === "canceled" || step.status === "rejected"
                  ? "failed"
                  : "pending";
          return (
            <li key={step.id} data-state={state}>
              <span className="trace-progress-dot" aria-hidden="true" />
              <span className="trace-progress-label">{stepText[step.capabilityId] || step.capabilityId}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function BackLink({ label = "新的调查" }: { label?: string }) {
  return (
    <Link className="trace-btn trace-btn-ghost" to="/">
      ← {label}
    </Link>
  );
}
