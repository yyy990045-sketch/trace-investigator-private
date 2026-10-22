import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, FileJson, ShieldCheck } from "lucide-react";
import {
  archiveArtifacts,
  bundleOf,
  client,
  outcomeText,
  stepOf,
  type FactAssessment,
} from "../api";
import { BackLink, FactSection, Tag, formatTime } from "../components";

export function Archive() {
  const { runId = "" } = useParams();
  const runQuery = useQuery({ queryKey: ["run", runId], queryFn: () => client.run(runId) });

  if (runQuery.isError)
    return (
      <div className="trace-page">
        <div className="trace-alert">{(runQuery.error as Error).message}</div>
        <BackLink />
      </div>
    );
  if (!runQuery.data)
    return (
      <div className="trace-page">
        <p className="trace-lede" aria-busy="true">
          正在读取调查档案…
        </p>
      </div>
    );

  const run = runQuery.data;
  const bundle = bundleOf(run);
  const verdict = bundle?.assessment?.verdict;
  const facts = (bundle?.assessment?.facts || []) as FactAssessment[];
  const files = archiveArtifacts(run);
  const intake = stepOf(run, "trace.case.intake")?.output as
    | { case?: { question?: string; claim?: string; createdAt?: string; modeNote?: string } }
    | undefined;
  const caseInfo = intake?.case;
  const search = bundle?.search;

  if (!verdict || run.status !== "completed")
    return (
      <div className="trace-page">
        <header className="trace-masthead">
          <span className="trace-eyebrow">调查档案</span>
          <h1>这次调查还没有形成档案</h1>
        </header>
        <div className="trace-blocker">
          <strong>
            {run.status === "waiting_approval"
              ? "核验已完成，等待你在调查过程中确认。"
              : run.status === "failed"
                ? "调查在生成档案前中断。"
                : "调查尚未完成。"}
          </strong>
          <p>档案只在人工确认通过、导出步骤真实执行后才会生成，这里不会用预览替代。</p>
        </div>
        <a className="trace-btn" href={`/cases/${run.id}`}>
          回到调查过程
        </a>
        <BackLink />
      </div>
    );

  const tone =
    verdict.outcome === "supported" ? "support" : verdict.outcome === "contradicted" ? "oppose" : "unclear";

  return (
    <div className="trace-page trace-page-wide">
      <header className="trace-masthead">
        <span className="trace-eyebrow">调查档案 · {formatTime(run.updatedAt)} 归档</span>
        <h1>{caseInfo?.claim || caseInfo?.question || "调查档案"}</h1>
        <p className="trace-lede">
          {caseInfo?.question && caseInfo.question !== caseInfo.claim ? `原始问题：${caseInfo.question} · ` : ""}
          事实拆解：人工确认（未使用 AI 拆解）
          {search ? ` · 元宝搜索 ${search.totalQueries} 次检索` : ""}
        </p>
      </header>

      <section className="trace-verdict" data-outcome={verdict.outcome}>
        <div className="trace-verdict-head">
          <h2>{outcomeText[verdict.outcome]}</h2>
          <Tag tone={tone}>
            把握程度 {verdict.confidence === "medium" ? "中" : verdict.confidence === "high" ? "高" : "低"}
          </Tag>
        </div>
        <p className="trace-verdict-text">{verdict.statement}</p>
        <div className="trace-counts">
          <span>
            独立来源 <b>{verdict.counts.independentSources}</b>
          </span>
          <span>
            取得原文 <b>{verdict.counts.bodyAvailable}</b>
          </span>
          <span>
            命中网页 <b>{verdict.counts.pages}</b>
          </span>
          <span>
            检索 <b>{verdict.counts.queries}</b> 次（失败 <b>{verdict.counts.failedQueries}</b>）
          </span>
        </div>
        <ul className="trace-notes">
          {verdict.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      </section>

      <section className="trace-section">
        <div className="trace-section-head">
          <h2>关键证据</h2>
          <span>点开标题可直接复核原文</span>
        </div>
        {facts.map((fact) => (
          <FactSection key={fact.factId} fact={fact} showNotes />
        ))}
      </section>

      <section className="trace-section">
        <div className="trace-section-head">
          <h2>下载与复查</h2>
          <span>{files.length} 个文件</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {files.map((file) => (
            <a
              key={file.id}
              className="trace-btn trace-btn-primary"
              href={client.artifactUrl(run.id, file.id)}
              download={file.filename}
            >
              {file.filename.endsWith(".json") ? <FileJson size={14} /> : <Download size={14} />}
              {file.filename}（{(file.bytes / 1024).toFixed(1)} KB）
            </a>
          ))}
          <a className="trace-btn" href={client.receiptUrl(run.id)}>
            <ShieldCheck size={14} /> 最终运行凭证
          </a>
        </div>
        <p className="trace-lede">
          档案文件在导出步骤生成并记录 SHA-256；最终完成状态以运行凭证为准，凭证会逐个校验文件摘要。
        </p>
      </section>

      <section className="trace-section">
        <div className="trace-section-head">
          <h2>这份档案的边界</h2>
        </div>
        <ul className="trace-notes" style={{ fontSize: 12.5 }}>
          <li>{caseInfo?.modeNote || "事实与检索式由人工确认，系统未执行 AI 事实拆解。"}</li>
          <li>检索命中不等于事实为真：支持性判断要求多个独立来源，且至少一个取得原文正文。</li>
          <li>内容雷同的同源转载已合并计数；标记为重复的来源不构成独立证据。</li>
          <li>系统未调用任何模型为结论背书；结论只基于本档案列出的公开来源。</li>
          <li>若要反驳结论，请直接打开上列网址复核原文。</li>
        </ul>
        <details className="trace-details">
          <summary>过程判定明细（{bundle?.checks?.length || 0} 项检查 · {bundle?.searches?.length || 0} 条检索请求）</summary>
          <ul className="trace-notes" style={{ marginTop: 8 }}>
            {(bundle?.checks || []).map((check, index) => (
              <li key={index}>
                {check.name}：{check.status === "not_evaluated" ? "未完成" : check.passed ? "通过" : "未通过"} · {check.detail}
              </li>
            ))}
          </ul>
          {bundle?.searches?.length ? (
            <table className="trace-table">
              <thead>
                <tr>
                  <th>检索式</th>
                  <th>HTTP</th>
                  <th>结果</th>
                  <th>耗时</th>
                  <th>RequestId</th>
                </tr>
              </thead>
              <tbody>
                {bundle.searches.map((attempt, index) => (
                  <tr key={index}>
                    <td>{attempt.query}</td>
                    <td>{attempt.error ? attempt.error.code : attempt.httpStatus}</td>
                    <td>{attempt.resultCount}</td>
                    <td>{(attempt.durationMs / 1000).toFixed(1)}s</td>
                    <td className="trace-mono">{attempt.requestId || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </details>
      </section>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <a className="trace-btn" href={`/cases/${run.id}`}>
          查看调查过程
        </a>
        <BackLink />
      </div>
    </div>
  );
}
