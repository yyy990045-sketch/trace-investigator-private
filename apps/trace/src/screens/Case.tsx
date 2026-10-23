import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, RotateCcw, X } from "lucide-react";
import {
  SHOWCASE,
  activeRun,
  bundleOf,
  client,
  fetchAssessment,
  fetchRevisions,
  followupsOf,
  outcomeText,
  pendingApproval,
  postCorrection,
  postFollowup,
  postReassess,
  postRedeliver,
  stepOf,
  type FactAssessment,
  type FollowupRecord,
  type Relation,
  type SourceAssessment,
} from "../api";
import { BackLink, FactBlock, StepRail, Tag, archiveHref, formatTime } from "../components";

export function Case() {
  const { runId = "" } = useParams();
  const cache = useQueryClient();
  const [actor, setActor] = useState("本机操作者");
  const [busy, setBusy] = useState<"approve" | "reject" | "retry" | "followup" | "redeliver" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ factId?: string; label?: string; query: string } | null>(null);
  const [followupError, setFollowupError] = useState<string | null>(null);

  const runQuery = useQuery({
    queryKey: ["run", runId],
    queryFn: () => client.run(runId),
    refetchInterval: (query) => (activeRun(query.state.data ?? ({ status: "queued" } as never)) ? 900 : false),
  });
  const run = runQuery.data;
  const assessmentQuery = useQuery({
    queryKey: ["assessment", runId],
    queryFn: () => fetchAssessment(runId),
    enabled: !!run && run.steps.some((step) => step.capabilityId === "trace.evidence.verify" && step.output),
  });

  const revisionsQuery = useQuery({
    queryKey: ["revisions", runId],
    queryFn: () => fetchRevisions(runId),
    enabled: !!run && run.status !== "queued",
  });

  const bundle = run ? bundleOf(run) : null;
  const assessment = assessmentQuery.data?.assessment ?? bundle?.assessment;
  const followups: FollowupRecord[] = run ? followupsOf(run) : [];
  const revisions = revisionsQuery.data;
  const pendingVersion = revisions && revisions.dirty && revisions.revisions.length ? revisions : null;

  const freshPageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of followups) for (const page of item.pages || []) ids.add(page.id);
    return ids;
  }, [followups]);

  if (runQuery.isError)
    return (
      <div className="trace-page">
        <div className="trace-alert">{(runQuery.error as Error).message}</div>
        <BackLink />
      </div>
    );
  if (!run)
    return (
      <div className="trace-page">
        <p className="trace-lede" aria-busy="true">
          正在读取调查记录…
        </p>
      </div>
    );

  const approval = pendingApproval(run);
  const facts = (assessment?.facts || []) as FactAssessment[];
  const verdict = assessment?.verdict;
  const clusters = assessment?.clusters || [];
  const search = bundle?.search;
  const failedStep = run.steps.find((step) => step.status === "failed");
  const intake = stepOf(run, "trace.case.intake")?.output as
    | { case?: { question?: string; claim?: string; modeNote?: string } }
    | undefined;
  const claimText = intake?.case?.claim || intake?.case?.question || run.input?.text || "调查中";
  const contradictionCount = facts.reduce((sum, fact) => sum + fact.contradicts, 0);
  const disputed = verdict?.outcome === "disputed" || facts.some((fact) => fact.relation === "mixed");
  const running = run.status === "running" || run.status === "queued";

  function openComposer(fact?: FactAssessment, source?: SourceAssessment) {
    setFollowupError(null);
    setComposer({
      factId: fact?.factId,
      label: source ? `来源：${source.site}｜${source.title}` : fact ? `事实：${fact.fact}` : "整条说法",
      query: fact ? (fact.fact.length > 40 ? fact.fact.slice(0, 40) : fact.fact) : claimText.slice(0, 40),
    });
  }

  async function submitFollowup() {
    const current = runQuery.data;
    if (!composer || busy || !current) return;
    const query = composer.query.trim();
    if (query.length < 2) {
      setFollowupError("请写一条具体的检索式。");
      return;
    }
    setBusy("followup");
    setFollowupError(null);
    try {
      await postFollowup(current.id, query, composer.factId);
      // 追加成功后立刻用同一套规则重算，让结论跟着新证据一起更新。
      await postReassess(current.id);
      await Promise.all([runQuery.refetch(), assessmentQuery.refetch()]);
      setComposer(null);
    } catch (e) {
      setFollowupError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function decide(decision: "approve" | "reject") {
    const current = runQuery.data;
    if (!approval || !current) return;
    setBusy(decision === "approve" ? "approve" : "reject");
    setError(null);
    try {
      const updated = await client.decide(current.id, approval.id, decision, actor.trim() || "本机操作者");
      cache.setQueryData(["run", current.id], updated);
      if (decision === "approve") void runQuery.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    const current = runQuery.data;
    if (!current) return;
    setBusy("retry");
    setError(null);
    try {
      const next = await client.retry(current.id);
      window.location.href = `/cases/${next.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function correct(source: SourceAssessment, relation: Relation, note: string) {
    const current = runQuery.data;
    if (!current) return "调查记录已失效，请刷新页面。";
    try {
      await postCorrection(current.id, {
        pageId: source.pageId,
        factId: factIdOf(source, assessment?.facts as FactAssessment[] | undefined),
        relation,
        note,
        actor: actor.trim() || "本机操作者",
      });
      // 修正保存后立刻用同一套规则重算；结论变化要在页面上看得见。
      await postReassess(current.id);
      await Promise.all([runQuery.refetch(), assessmentQuery.refetch(), revisionsQuery.refetch()]);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  async function redeliver() {
    const current = runQuery.data;
    if (!current) return;
    setBusy("redeliver");
    setError(null);
    try {
      await postRedeliver(current.id, actor.trim() || "本机操作者");
      await Promise.all([runQuery.refetch(), revisionsQuery.refetch()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="trace-page trace-page-wide">
      <header className="trace-masthead">
        <span className="trace-eyebrow">
          调查过程 ·{" "}
          {run.status === "completed"
            ? "已完成"
            : run.status === "failed"
              ? "已中断"
              : approval
                ? "等待你确认"
                : "进行中"}
        </span>
        <h1>{claimText}</h1>
        <p className="trace-lede">
          立案 {formatTime(run.createdAt)}
          {search ? ` · 已检索 ${search.totalQueries + followups.length} 次` : ""}
          {assessment ? ` · 独立来源 ${assessment.independentSources} 个` : ""}
          {followups.length ? ` · 追加检索 ${followups.length} 次` : ""}
        </p>
      </header>

      <StepRail run={run} />

      {verdict ? (
        <section className="case-now" data-outcome={verdict.outcome}>
          <div className="case-now-head">
            <span className="case-now-label">当前结论</span>
            <b>{outcomeText[verdict.outcome]}</b>
            <span className="case-now-state">
              {run.status === "completed"
                ? "调查已完成"
                : run.status === "waiting_approval"
                  ? "等待人工确认"
                  : run.status === "failed"
                    ? "调查中断"
                    : "正在检索与核验"}
            </span>
          </div>
          <p className="case-now-text">{verdict.statement}</p>
          <div className="case-now-counts">
            <span>
              独立来源 <b>{assessment?.independentSources ?? "—"}</b>
            </span>
            <span>
              原文正文 <b>{assessment?.bodyAvailable ?? "—"}</b>
            </span>
            <span>
              支持 <b>{facts.reduce((sum, fact) => sum + (fact.supports || 0), 0)}</b> · 反对{" "}
              <b>{facts.reduce((sum, fact) => sum + (fact.contradicts || 0), 0)}</b> · 无法确认{" "}
              <b>{facts.reduce((sum, fact) => sum + (fact.unclear || 0), 0)}</b>
            </span>
            {facts.reduce((sum, fact) => sum + (fact.unconfirmedSources || 0), 0) ? (
              <span title="可能是转载但缺少可核对依据，未计入独立来源">
                独立性未确认 <b>{facts.reduce((sum, fact) => sum + (fact.unconfirmedSources || 0), 0)}</b>
              </span>
            ) : null}
            {assessment?.openQuestions?.length ? <span className="case-now-gap">还缺 {assessment.openQuestions.length} 项证据</span> : null}
          </div>
          <div className="case-now-actions">
            <a className="trace-btn trace-btn-ghost" href={archiveHref(run.id)}>
              打开调查档案
            </a>
            {revisions && revisions.revisions.length ? (
              <span className="trace-hint">已交付第 {revisions.deliveredRevision} 版，档案按版本冻结</span>
            ) : null}
          </div>
        </section>
      ) : null}

      {revisions && revisions.revisions.length ? (
        <section className="trace-versions" data-dirty={pendingVersion ? "true" : "false"}>
          <div className="trace-versions-head">
            <strong>
              已交付第 {revisions.deliveredRevision} 版
              {pendingVersion ? "，当前结论有新变化待确认" : "，当前结论与档案一致"}
            </strong>
            <span>
              交付时间 {formatTime(revisions.revisions[revisions.revisions.length - 1]?.at)} ·{" "}
              {revisions.revisions[revisions.revisions.length - 1]?.actor}
            </span>
          </div>
          {pendingVersion ? (
            <>
              <ul className="trace-verdict-changes">
                {revisions.changes.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
              <div className="trace-versions-actions">
                {SHOWCASE ? null : (
                <label className="trace-label trace-actor-inline" htmlFor="trace-redeliver-actor">
                  确认人
                  <input
                    id="trace-redeliver-actor"
                    className="trace-input"
                    maxLength={80}
                    value={actor}
                    onChange={(e) => setActor(e.target.value)}
                  />
                </label>
                )}
                {SHOWCASE ? null : (
                <button className="trace-btn trace-btn-primary" onClick={redeliver} disabled={busy !== null}>
                  {busy === "redeliver"
                    ? "正在生成新版本…"
                    : `重新确认，生成第 ${revisions.deliveredRevision + 1} 版档案`}
                </button>
                )}
                <a className="trace-link" href={archiveHref(run.id)}>
                  先看当前结论与旧版本
                </a>
              </div>
              <p className="trace-hint">
                第 {revisions.deliveredRevision} 版档案不会被改写；重新确认后会另存为
                「调查档案-v{revisions.deliveredRevision + 1}.md/.json」，旧链接仍然下载旧版本。
              </p>
            </>
          ) : (
            <div className="trace-versions-actions">
              <a className="trace-link" href={archiveHref(run.id)}>
                查看已交付档案与版本记录
              </a>
            </div>
          )}
          {revisions.revisions.length > 1 ? (
            <details className="trace-version-changes">
              <summary>这次调查是怎么一步步走到现在结论的</summary>
              <ul className="trace-verdict-changes">
                {revisions.revisions.slice(1).map((item) => (
                  <li key={item.revision}>
                    第 {item.revision} 版（{formatTime(item.at)}）：
                    {item.changes?.length ? item.changes.join("；") : "与上一版相比结论与来源统计没有变化。"}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {error && pendingVersion ? <div className="trace-alert">{error}</div> : null}
        </section>
      ) : null}

      {run.status === "failed" ? (
        <div className="trace-alert">
          <strong>调查中断：{failedStep?.error?.code || run.error?.code || "未知原因"}</strong>
          <p style={{ marginTop: 6 }}>{failedStep?.error?.message || run.error?.message}</p>
          <button className="trace-btn" style={{ marginTop: 10 }} onClick={retry} disabled={busy === "retry"}>
            <RotateCcw size={14} /> {busy === "retry" ? "正在重新发起…" : "用同样的输入重新调查"}
          </button>
        </div>
      ) : null}

      {approval ? (
        <section className="trace-approve">
          <div className="trace-approve-head">
            <h2>核验完成，等你确认</h2>
            <span>通过后会生成可下载的调查档案</span>
          </div>
          {verdict ? (
            <div className="trace-verdict" data-outcome={verdict.outcome}>
              <div className="trace-verdict-head">
                <h2>{outcomeText[verdict.outcome]}</h2>
              </div>
              <p className="trace-verdict-text">{verdict.statement}</p>
            </div>
          ) : null}
          <div className="trace-approve-form">
            <label className="trace-label" htmlFor="trace-actor">
              确认人
              <small>写进本机记录，不是身份认证</small>
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
          <div className="trace-approve-actions">
            <button className="trace-btn trace-btn-primary" onClick={() => decide("approve")} disabled={busy !== null}>
              {busy === "approve" ? "正在确认…" : "确认并生成档案"}
            </button>
            <button className="trace-btn" onClick={() => decide("reject")} disabled={busy !== null}>
              {busy === "reject" ? "正在驳回…" : "驳回，不出档案"}
            </button>
          </div>
        </section>
      ) : null}

      {run.status === "completed" ? (
        <section className="trace-next">
          <div>
            <h2>这次调查已经成档</h2>
            <p>
              结论、关键证据、矛盾与未解问题都在档案页，可以下载 Markdown / JSON。
              {pendingVersion ? " 追加的检索与修正在这里重算，但还没有生成新版本档案。" : ""}
            </p>
          </div>
          <a className="trace-btn trace-btn-primary" href={archiveHref(run.id)}>
            打开调查档案 <ArrowRight size={14} />
          </a>
        </section>
      ) : null}

      {search ? (
        <section className="trace-searchline">
          <span className="trace-searchline-label">元宝搜索</span>
          <p>
            共 {search.totalQueries + followups.length} 次检索：返回网页 {search.succeededQueries + followups.filter((item) => !item.error).length} 次
            {search.emptyQueries ? `，无结果 ${search.emptyQueries} 次` : ""}
            {search.failedQueries ? `，失败 ${search.failedQueries} 次` : ""}
            {search.rateLimitedQueries ? `，限流 ${search.rateLimitedQueries} 次` : ""}。
            {bundle?.bodies?.length
              ? ` 原文抓取成功 ${bundle.bodies.filter((b) => b.ok).length}/${bundle.bodies.length} 个。`
              : " 本次未取得原文正文，判断基于搜索摘要。"}
          </p>
        </section>
      ) : null}

      {disputed || contradictionCount > 0 ? (
        <section className="trace-conflict">
          <h2>{disputed ? "来源之间说法不一致" : "有来源给出相反说法"}</h2>
          <p>
            {disputed
              ? "同一条事实既有支持也有反对来源。下面把它们并排列出，请直接打开原始网页判断。"
              : `共 ${contradictionCount} 条来源与待核查说法相反，结论已按「存在反证」处理。`}
          </p>
        </section>
      ) : null}

      {facts.length ? (
        <section className="trace-facts">
          {facts.map((fact) => (
            <FactBlock
              key={fact.factId}
              fact={fact}
              factId={fact.factId}
              clusters={clusters}
              freshPageIds={freshPageIds}
              onFollowup={(item, source) => openComposer(item, source)}
              onCorrect={
                running || SHOWCASE ? undefined : (source, relation, note) => correct(source, relation, note)
              }
            />
          ))}
        </section>
      ) : (
        <div className="trace-empty" aria-busy={running}>
          {running ? "正在检索与比对，来源会逐条出现在这里。" : "这一步还没有可比对的来源。"}
        </div>
      )}

      {followups.length ? (
        <section className="trace-followups">
          <div className="trace-section-head">
            <h2>本次追加的线索</h2>
            <span>{followups.length} 次追问均已并入同一条调查</span>
          </div>
          {followups.map((item, index) => (
            <details className="trace-followup" key={index} open={index === followups.length - 1}>
              <summary>
                <span className="trace-followup-query">{item.query}</span>
                <span className="trace-followup-meta">
                  {item.error ? `失败：${item.error.code}` : `${item.resultCount} 条网页`} ·{" "}
                  {(item.durationMs / 1000).toFixed(1)}s
                </span>
              </summary>
              {item.error ? (
                <p className="trace-alert">{item.error.message}</p>
              ) : (
                <ul className="trace-followup-list">
                  {item.pages.map((page) => (
                    <li key={page.id}>
                      <a href={page.url} target="_blank" rel="noreferrer noopener">
                        {page.title}
                      </a>
                      <span className="trace-mono"> · {page.site}</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          ))}
        </section>
      ) : null}

      {SHOWCASE ? null : composer ? (
        <section className="trace-composer" aria-label="追加检索">
          <div className="trace-composer-head">
            <div>
              <strong>追加检索</strong>
              <span>{composer.label}</span>
            </div>
            <button className="trace-btn trace-btn-quiet" onClick={() => setComposer(null)} aria-label="关闭">
              <X size={14} />
            </button>
          </div>
          <div className="trace-query-row">
            <input
              className="trace-input"
              autoFocus
              maxLength={120}
              value={composer.query}
              placeholder="换成更具体的说法，例如加上年份、机构名或文件编号"
              onChange={(e) => setComposer({ ...composer, query: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitFollowup();
              }}
            />
            <button className="trace-btn trace-btn-primary" onClick={submitFollowup} disabled={busy === "followup"}>
              {busy === "followup" ? "检索中…" : "检索并重算"}
            </button>
          </div>
          <p className="trace-hint">
            会用元宝搜索真的再查一次，并把结果并入这条调查；结论会按同一套规则重新计算。
          </p>
          {followupError ? <div className="trace-alert">{followupError}</div> : null}
        </section>
      ) : (
        <div className="trace-followup-trigger">
          <button className="trace-btn" onClick={() => openComposer()}>
            <Plus size={14} /> 追加一次检索
          </button>
          <span className="trace-hint">结论不满意时，可以换检索式继续查，记录不会丢。</span>
        </div>
      )}

      {bundle?.searches?.length ? (
        <details className="trace-details trace-tech">
          <summary>检索技术记录（{bundle.searches.length} 条请求，供复查用）</summary>
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
                  <td>{attempt.error ? attempt.error.code : `HTTP ${attempt.httpStatus ?? "—"}`}</td>
                  <td>{attempt.resultCount}</td>
                  <td>{(attempt.durationMs / 1000).toFixed(1)}s</td>
                  <td className="trace-mono">{attempt.requestId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      <div className="trace-foot">
        <BackLink />
        {assessment?.openQuestions?.length ? (
          <a className="trace-link" href={archiveHref(run.id)}>
            看看还缺什么证据
          </a>
        ) : null}
      </div>
    </div>
  );
}

/** 这条来源属于哪条事实：人工修正要同时记录事实与来源，重算才能定位。 */
function factIdOf(source: SourceAssessment, facts?: FactAssessment[]) {
  const hit = (facts || []).find((fact) => fact.sources.some((item) => item.pageId === source.pageId));
  return hit?.factId || (facts?.[0]?.factId ?? "fact-1");
}
