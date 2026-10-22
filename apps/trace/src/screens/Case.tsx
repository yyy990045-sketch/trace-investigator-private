import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, RotateCcw } from "lucide-react";
import {
  activeRun,
  bundleOf,
  client,
  outcomeText,
  pendingApproval,
  relationText,
  stepOf,
  type FactAssessment,
} from "../api";
import { BackLink, FactSection, StepRail, Tag, formatTime } from "../components";

export function Case() {
  const { runId = "" } = useParams();
  const cache = useQueryClient();
  const [actor, setActor] = useState("本机操作者");
  const [busy, setBusy] = useState<"approve" | "reject" | "retry" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runQuery = useQuery({
    queryKey: ["run", runId],
    queryFn: () => client.run(runId),
    refetchInterval: (query) => (activeRun(query.state.data ?? ({ status: "queued" } as never)) ? 900 : false),
  });

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
          正在读取调查记录…
        </p>
      </div>
    );

  const run = runQuery.data;
  const bundle = bundleOf(run);
  const approval = pendingApproval(run);
  const verdict = bundle?.assessment?.verdict;
  const facts = (bundle?.assessment?.facts || []) as FactAssessment[];
  const search = bundle?.search;
  const failedStep = run.steps.find((step) => step.status === "failed");
  const intake = stepOf(run, "trace.case.intake")?.output as { case?: { claim?: string; question?: string } } | undefined;
  const claimText = intake?.case?.claim || intake?.case?.question || run.input?.text || "调查中";
  const disputed =
    verdict?.outcome === "disputed" || facts.some((fact) => fact.relation === "mixed");
  const contradictionCount = facts.reduce((n, fact) => n + fact.contradicts, 0);

  async function decide(decision: "approve" | "reject") {
    if (!approval) return;
    setBusy(decision === "approve" ? "approve" : "reject");
    setError(null);
    try {
      const updated = await client.decide(run.id, approval.id, decision, actor.trim() || "本机操作者");
      cache.setQueryData(["run", run.id], updated);
      if (decision === "approve") void runQuery.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    setBusy("retry");
    setError(null);
    try {
      const next = await client.retry(run.id);
      window.location.href = `/cases/${next.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="trace-page trace-page-wide">
      <header className="trace-masthead">
        <span className="trace-eyebrow">
          调查过程 · {run.status === "completed" ? "已生成档案" : run.status === "failed" ? "已中断" : "进行中"}
        </span>
        <h1>{claimText}</h1>
        <p className="trace-lede">
          立案于 {formatTime(run.createdAt)} · 共 {run.steps.length} 个步骤
          {search ? ` · 已发出 ${search.totalQueries} 次检索` : ""}
        </p>
      </header>

      <div className="trace-grid">
        <StepRail run={run} />

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {run.status === "failed" ? (
            <div className="trace-alert">
              <strong>调查已中断：{failedStep?.error?.code || run.error?.code || "未知原因"}</strong>
              <p style={{ marginTop: 6 }}>{failedStep?.error?.message || run.error?.message}</p>
              <div style={{ marginTop: 10 }}>
                <button className="trace-btn" onClick={retry} disabled={busy === "retry"}>
                  <RotateCcw size={14} /> {busy === "retry" ? "正在重新发起…" : "用同样的输入重新调查"}
                </button>
              </div>
            </div>
          ) : null}

          {approval ? (
            <section className="trace-section">
              <div className="trace-section-head">
                <h2>等待你确认</h2>
                <span>审批绑定本次输入摘要</span>
              </div>
              <p className="trace-lede">
                核验已完成。通过后会生成可下载的调查档案；驳回则不会产出档案文件。
              </p>
              {verdict ? (
                <div className="trace-verdict" data-outcome={verdict.outcome}>
                  <div className="trace-verdict-head">
                    <h2>{outcomeText[verdict.outcome]}</h2>
                    <Tag tone={verdict.outcome === "supported" ? "support" : verdict.outcome === "contradicted" ? "oppose" : "unclear"}>
                      把握程度 {verdict.confidence === "medium" ? "中" : verdict.confidence === "high" ? "高" : "低"}
                    </Tag>
                  </div>
                  <p className="trace-verdict-text">{verdict.statement}</p>
                </div>
              ) : null}
              <div className="trace-field">
                <label className="trace-label" htmlFor="trace-actor">
                  确认人（写在本机记录里，不是身份认证）
                </label>
                <input
                  id="trace-actor"
                  className="trace-input"
                  maxLength={80}
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                />
              </div>
              {error ? <div className="trace-alert">{error}</div> : null}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="trace-btn trace-btn-primary"
                  onClick={() => decide("approve")}
                  disabled={busy !== null}
                >
                  {busy === "approve" ? "正在确认…" : "确认并生成调查档案"}
                </button>
                <button className="trace-btn" onClick={() => decide("reject")} disabled={busy !== null}>
                  {busy === "reject" ? "正在驳回…" : "驳回，不出档案"}
                </button>
              </div>
            </section>
          ) : null}

          {run.status === "completed" ? (
            <section className="trace-section">
              <div className="trace-section-head">
                <h2>这份调查已归档</h2>
                <span>{run.artifacts.length} 个文件</span>
              </div>
              <a className="trace-btn trace-btn-primary" href={`/archive/${run.id}`} style={{ alignSelf: "flex-start" }}>
                打开调查档案 <ArrowRight size={14} />
              </a>
            </section>
          ) : null}

          {search ? (
            <section className="trace-section">
              <div className="trace-section-head">
                <h2>检索概览</h2>
                <span>{search.endpointHost || "元宝搜索"}</span>
              </div>
              {search.available ? (
                <p className="trace-lede">
                  共发出 {search.totalQueries} 次检索：{search.succeededQueries} 次返回网页，
                  {search.emptyQueries} 次无结果，{search.failedQueries} 次失败
                  {search.rateLimitedQueries ? `（其中限流 ${search.rateLimitedQueries} 次）` : ""}；
                  累计耗时 {(search.totalDurationMs / 1000).toFixed(1)} 秒。
                  {bundle?.bodies?.length
                    ? ` 原文抓取成功 ${bundle.bodies.filter((b) => b.ok).length}/${bundle.bodies.length} 个网址。`
                    : " 本次未抓取原文正文，所有判断仅基于搜索摘要。"}
                </p>
              ) : (
                <div className="trace-blocker">
                  <strong>检索不可用</strong>
                  <p>{search.reason}</p>
                </div>
              )}
              {bundle?.searches?.length ? (
                <details className="trace-details">
                  <summary>检索技术记录（{bundle.searches.length} 条请求）</summary>
                  <table className="trace-table">
                    <thead>
                      <tr>
                        <th>检索式</th>
                        <th>状态</th>
                        <th>结果</th>
                        <th>耗时</th>
                        <th>RequestId</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.searches.map((attempt, index) => (
                        <tr key={index}>
                          <td>{attempt.query}</td>
                          <td>
                            {attempt.error
                              ? `${attempt.error.code}${attempt.attempts > 1 ? ` · ${attempt.attempts} 次尝试` : ""}`
                              : `HTTP ${attempt.httpStatus ?? "—"}`}
                          </td>
                          <td>{attempt.resultCount}</td>
                          <td>{(attempt.durationMs / 1000).toFixed(1)}s</td>
                          <td className="trace-mono">{attempt.requestId || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ) : null}
            </section>
          ) : null}

          {disputed || contradictionCount > 0 ? (
            <section className="trace-section">
              <div className="trace-section-head">
                <h2>{disputed ? "来源之间说法不一致" : "存在反对来源"}</h2>
                <span>{contradictionCount} 条来源给出相反说法</span>
              </div>
              <p className="trace-lede">
                {disputed
                  ? "同一条事实既有支持来源也有反对来源。系统不会替你选择相信哪一边，请打开原始链接逐条核对。"
                  : "有来源对这条事实给出相反表述，结论里已按存在反证处理。"}
              </p>
            </section>
          ) : null}

          {facts.length ? (
            <section className="trace-section">
              <div className="trace-section-head">
                <h2>事实与来源</h2>
                <span>
                  {facts.length} 条事实 · {bundle?.assessment?.independentSources ?? 0} 个独立来源
                </span>
              </div>
              {facts.map((fact) => (
                <FactSection key={fact.factId} fact={fact} />
              ))}
            </section>
          ) : (
            <section className="trace-section">
              <div className="trace-empty" aria-busy={run.status === "running"}>
                {run.status === "running"
                  ? "正在检索与比对，来源出现后会逐条列出。"
                  : "这一步还没有可比对的来源。"}
              </div>
            </section>
          )}

          <BackLink />
        </div>
      </div>
    </div>
  );
}
