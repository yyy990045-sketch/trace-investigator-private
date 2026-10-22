import { useState } from "react";
import { Link } from "react-router-dom";
import { Download, ArrowRight } from "lucide-react";
import { Button, Badge, Modal, EmptyState } from "@personal/ui-core";
import type {
  RuntimeApi,
  RunRecord,
  DocumentBundle,
} from "@personal/capability-sdk";
export function RuntimeResultWorkspace({
  run,
  client,
  onUpdate,
  counterpartHref,
}: {
  run: RunRecord;
  client: RuntimeApi;
  onUpdate: (run: RunRecord) => void;
  counterpartHref?: string;
}) {
  const [panel, setPanel] = useState<"review" | "sources" | "audit" | null>(
      null,
    ),
    [actor, setActor] = useState("本人"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const output = run.steps.filter((s) => s.output).at(-1)?.output as
    DocumentBundle | undefined;
  const approval = run.approvals.find((a) => a.status === "pending");
  const completed = run.status === "completed";
  const delivered = completed && run.artifacts.length > 0;
  const decision = async (value: "approve" | "reject") => {
    if (!approval) return;
    setBusy(true);
    setError("");
    try {
      onUpdate(await client.decide(run.id, approval.id, value, actor));
      setPanel(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "决定未提交");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page business-page">
      <div className="object-heading">
        <div>
          <div className="context-line">{run.projectName}</div>
          <h1>{run.input.filename}</h1>
        </div>
        <Badge
          tone={
            completed ? "green" : run.status === "failed" ? "red" : "neutral"
          }
        >
          {completed
            ? (delivered ? "已交付" : "执行完成 · 无交付文件")
            : run.status === "waiting_approval"
              ? "待确认"
              : run.status === "rejected"
                ? "已拒绝"
                : run.status === "canceled"
                  ? "已取消"
                  : run.status === "failed"
                    ? "处理失败"
                    : "处理中"}
        </Badge>
      </div>
      <p className="runtime-run-reference">{run.id}</p>
      {run.error && (
        <div className="runtime-issues" role="alert">
          <strong>{run.error.code}</strong>
          <p>{run.error.message}</p>
        </div>
      )}
      <section className="outcome-workspace">
        <span className="section-kicker">
          {delivered ? "实际交付成果" : "当前处理结果"}
        </span>
        <h2 className="outcome-title">
          {completed
            ? (delivered ? "运行交付文件" : "处理已完成，当前组合未生成文件")
            : run.status === "waiting_approval"
              ? "资料已处理，等待人工确认"
              : "尚未形成正式交付"}
        </h2>
        {output?.checks && (
          <ul className="actual-checks">
            {output.checks.map((c) => (
              <li key={c.name}>
                <strong>
                  {c.name} · {c.status === "not_evaluated" ? "未核验" : c.passed ? "通过" : "需处理"}
                </strong>
                <p>{c.detail}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="module-intro">
          {output?.verification
            ? output.verification.summary
            : "本次未执行模型核验。规则检查和上传资料检索结果不等于AI核验。"}
        </p>
        {approval && run.status === "waiting_approval" && (
          <div className="next-decision">
            <div>
              <span className="next-label">下一步</span>
              <p>核对资料和引用，确认后才生成正式文件。</p>
            </div>
            <Button onClick={() => setPanel("review")}>审阅并确认</Button>
          </div>
        )}
        {completed && run.artifacts.length > 0 && (
          <div className="actual-files">
            {run.artifacts.map((a) => (
              <a
                key={a.id}
                className="ui-button button-primary"
                href={client.artifactUrl(run.id, a.id)}
              >
                <Download size={15} />
                {a.filename}
              </a>
            ))}
            {run.steps.some((s) => s.capabilityId === "report.export" && s.status === "completed") &&
              <a className="ui-button button-secondary" href={client.receiptUrl(run.id)}>最终运行凭证</a>}
          </div>
        )}
      </section>
      <section className="business-record-section">
        <div className="section-heading">
          <h2>来源引用</h2>
          <Button variant="ghost" onClick={() => setPanel("sources")}>
            展开依据
          </Button>
        </div>
        {output?.citations?.length ? (
          <p className="module-intro">已关联{output.citations.length}条检索引用；按需展开原文与定位。相关度是词项匹配结果，不是AI置信度。</p>
        ) : (
          <EmptyState
            title="尚无检索引用"
            detail={output?.query?.trim() ? "本次问题未召回满足词项阈值的资料；未以无关内容填充。" : "本次未提供检索问题，不生成相关度或检索引用。"}
          />
        )}
      </section>
      <div className="outcome-support">
        <Button variant="secondary" onClick={() => setPanel("audit")}>
          查看运行与交付记录
        </Button>
        {counterpartHref && (
          <Link className="plain-link" to={counterpartHref}>
            查看执行过程 <ArrowRight size={14} />
          </Link>
        )}
      </div>
      {panel && (
        <Modal
          title={
            panel === "review"
              ? "确认本次交付"
              : panel === "sources"
                ? "实际来源与依据"
                : "运行与交付记录"
          }
          wide
          onClose={() => setPanel(null)}
        >
          {panel === "review" && (
            <>
              <p>确认范围：{run.input.filename}。</p>
              <details className="source-disclosure"><summary>高级：本次审批绑定的输入摘要</summary><p className="source-path">{approval?.inputHash}</p></details>
              <div className="actual-documents">
                {output?.documents.map((d) => (
                  <details key={d.id}>
                    <summary>{d.source}</summary>
                    <p>{d.text}</p>
                  </details>
                ))}
              </div>
              <label className="field-label" htmlFor="result-actor">
                确认人
              </label>
              <input
                id="result-actor"
                value={actor}
                onChange={(e) => setActor(e.target.value)}
              />
              <p className="field-help">
                批准将继续真实执行报告导出。拒绝会终止此任务。
              </p>
              {error && (
                <p role="alert" className="error-text">
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <Button
                  variant="secondary"
                  disabled={busy || !actor.trim()}
                  onClick={() => decision("reject")}
                >
                  拒绝任务
                </Button>
                <Button
                  disabled={busy || !actor.trim()}
                  onClick={() => decision("approve")}
                >
                  批准并生成报告
                </Button>
              </div>
            </>
          )}
          {panel === "sources" && (
            <div className="actual-documents">
              {output?.citations?.map((c) => <details key={c.id}><summary>{c.source}</summary><p>{c.excerpt}</p><p className="field-help">{c.documentId} · 词项相关度 {c.score}（非AI置信度）</p></details>)}
              <details><summary>执行证据与摘要</summary>{run.evidence.map((e) => <details key={e.id}><summary>{e.kind}</summary><pre className="input-preview">{JSON.stringify(e.data,null,2)}</pre><p className="field-help">SHA-256 {e.sha256}</p></details>)}</details>
            </div>
          )}
          {panel === "audit" && (
            <>
              <p className="muted-note">
                {run.id} · 项目组合版本 {run.projectRevision}
              </p>
              <ol className="record-timeline">
                {run.events.map((e) => (
                  <li key={e.id}>
                    {e.at} · {e.type}
                  </li>
                ))}
              </ol>
              <p className="field-help">
                模型实际调用：{run.modelCalls.length}
                次。状态、耗时、返回和错误保存在此运行接口。
              </p>
              {run.modelCalls.map((c) => (
                <details key={c.id}>
                  <summary>
                    {c.model} · {c.status} · {c.durationMs}ms
                  </summary>
                  <pre className="input-preview">
                    {JSON.stringify(c.response || c.error, null, 2)}
                  </pre>
                </details>
              ))}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
