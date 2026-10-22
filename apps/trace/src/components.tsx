/** TRACE 共用视图组件：只用业务数据渲染，不引入任何演示数据。 */
import { Link } from "react-router-dom";
import type { RunRecord } from "@personal/capability-sdk";
import {
  relationText,
  stepText,
  type FactAssessment,
  type SourceAssessment,
} from "./api";

export function Tag({
  tone,
  children,
}: {
  tone: "support" | "oppose" | "unclear" | "pending" | "neutral";
  children: React.ReactNode;
}) {
  return <span className={`trace-tag trace-tag-${tone}`}>{children}</span>;
}

export function relationTone(relation: string): "support" | "oppose" | "unclear" {
  if (relation === "supports") return "support";
  if (relation === "contradicts") return "oppose";
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
  showNotes = false,
}: {
  source: SourceAssessment;
  showNotes?: boolean;
}) {
  return (
    <article
      className="trace-source"
      data-relation={source.relation}
      data-duplicate={source.duplicate ? "true" : "false"}
    >
      <div className="trace-source-top">
        <p className="trace-source-title">
          <a href={source.url} target="_blank" rel="noreferrer noopener">
            {source.title}
          </a>
        </p>
        <Tag tone={relationTone(source.relation)}>{relationText[source.relation]}</Tag>
      </div>
      <div className="trace-source-meta">
        <span>{source.site}</span>
        <span>{source.date || "未标注发布时间"}</span>
        <span>{source.bodyAvailable ? "已取得原文正文" : "仅有搜索摘要"}</span>
        <span>{originalityText[source.originality]}</span>
        {source.duplicate ? <span>与 {source.clusterId} 同源，不计入独立证据</span> : null}
      </div>
      <p className="trace-excerpt">{source.excerpt}</p>
      {showNotes ? (
        <ul className="trace-notes">
          {source.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
          <li>{source.dateNote}</li>
        </ul>
      ) : (
        <details className="trace-details">
          <summary>判定依据（{source.reasons.length + 1} 条）</summary>
          <ul className="trace-notes" style={{ marginTop: 8 }}>
            {source.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
            <li>{source.dateNote}</li>
          </ul>
        </details>
      )}
    </article>
  );
}

export function FactSection({
  fact,
  showNotes = false,
}: {
  fact: FactAssessment;
  showNotes?: boolean;
}) {
  return (
    <section className="trace-fact-block">
      <h3>{fact.fact}</h3>
      <div className="trace-fact-summary">
        <Tag tone={relationTone(fact.relation)}>{relationText[fact.relation]}</Tag>
        <span>独立来源 {fact.independentClusters}</span>
        <span>取得原文 {fact.bodyBackedClusters}</span>
        <span>
          支持 {fact.supports} · 反对 {fact.contradicts}
        </span>
      </div>
      {fact.sources.length === 0 ? (
        <p className="trace-lede">这条事实没有任何可比对的来源。</p>
      ) : (
        fact.sources.map((source) => (
          <SourceCard key={source.pageId + source.clusterId} source={source} showNotes={showNotes} />
        ))
      )}
    </section>
  );
}

export function StepRail({ run }: { run: RunRecord }) {
  return (
    <div className="trace-rail" aria-label="调查进度">
      {run.steps.map((step) => {
        const state =
          step.status === "completed"
            ? "complete"
            : step.status === "failed" || step.status === "canceled" || step.status === "rejected"
              ? "failed"
              : step.status === "running" || step.status === "waiting_approval"
                ? "current"
                : "pending";
        const caption =
          step.status === "completed"
            ? "已完成"
            : step.status === "running"
              ? "进行中"
              : step.status === "waiting_approval"
                ? "等待你确认"
                : step.status === "failed"
                  ? "失败"
                  : step.status === "canceled"
                    ? "已取消"
                    : step.status === "rejected"
                      ? "已驳回"
                      : "待执行";
        return (
          <div className="trace-rail-item" data-state={state} key={step.id}>
            <span className="trace-rail-dot" aria-hidden="true" />
            <div className="trace-rail-body">
              <span className="trace-rail-title">{stepText[step.capabilityId] || step.capabilityId}</span>
              <span className="trace-rail-meta">
                {caption}
                {step.durationMs ? ` · ${(step.durationMs / 1000).toFixed(1)}s` : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BackLink() {
  return (
    <Link className="trace-btn trace-btn-ghost" to="/">
      ← 新的调查
    </Link>
  );
}
