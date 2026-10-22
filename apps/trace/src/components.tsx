/** TRACE 共用视图组件：只渲染真实运行数据，不引入演示内容。 */
import { Link } from "react-router-dom";
import type { RunRecord } from "@personal/capability-sdk";
import {
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

export function SourceCard({
  source,
  cluster,
  onFollowup,
  fresh,
}: {
  source: SourceAssessment;
  cluster?: SourceCluster;
  onFollowup?: (source: SourceAssessment) => void;
  fresh?: boolean;
}) {
  const keyText = source.bodyExcerpt || source.excerpt;
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
      </div>
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
}: {
  fact: FactAssessment;
  factId: string;
  clusters: SourceCluster[];
  freshPageIds: Set<string>;
  onFollowup: (fact: FactAssessment, source?: SourceAssessment) => void;
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
