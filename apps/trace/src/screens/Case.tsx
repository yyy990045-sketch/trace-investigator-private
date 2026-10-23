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
import { InvestigationStory } from "../InvestigationStory";
import { ConditionSplitter } from "../ConditionSplitter";
import { Watershed } from "../Watershed";
import { useSearchParams } from "react-router-dom";
import { digestOf } from "../api";
import { InvestigationRoles } from "../InvestigationRoles";
import { ExperienceReuse } from "../ExperienceReuse";
import { ClueCase } from "./ClueCase";
import { ModelReview } from "../ModelReview";
import { evidenceWording } from "../presentation";

export function Case() {
  const { runId = "" } = useParams();
  const cache = useQueryClient();
  const [actor, setActor] = useState("本机操作者");
  const [busy, setBusy] = useState<"approve" | "reject" | "retry" | "followup" | "redeliver" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ factId?: string; label?: string; query: string } | null>(null);
  const [followupError, setFollowupError] = useState<string | null>(null);

  const [searchParams] = useSearchParams();
  const compareId = searchParams.get("compare") || "";
  const compareQuery = useQuery({
    queryKey: ["run", compareId],
    queryFn: () => client.run(compareId),
    enabled: !!compareId && !SHOWCASE,
  });
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
  const supportCount = facts.reduce((sum, fact) => sum + fact.supports, 0);
  /** 有相关来源，但它们都是摘要/未通过独立性核对，因此结论只能停在「证据不足」。 */
  const weakOpposition =
    verdict?.outcome === "insufficient" && supportCount + contradictionCount > 0;
  /** 两个以上机构各自给出数字：这是「口径对照」而不是「谁错了」。 */
  const quantityBySource = (() => {
    const map = new Map<string, { value: number; unit: string; url: string; sentence: string; approximate: boolean }>();
    for (const fact of facts)
      for (const source of fact.sources)
        for (const item of source.quantityEvidence || []) {
          const key = `${item.statisticalSource}|${item.value}${item.unit}`;
          if (map.has(key)) continue;
          map.set(key, {
            value: item.value,
            unit: item.unit,
            url: source.url,
            sentence: item.sentence,
            approximate: item.approximate,
          });
        }
    return [...map.entries()].map(([key, value]) => ({ source: key.split("|")[0], ...value }));
  })();
  /** 真正取得网页正文的来源（含正文里没有相关句子的）：取得就是取得，不能笼统说没有原文。 */
  const bodiesFetched = facts
    .flatMap((fact) => fact.sources)
    .filter((source) => source.bodyAvailable === true)
    .filter((source, index, list) => list.findIndex((other) => other.pageId === source.pageId) === index)
    .slice(0, 4);
  /** 其中正文里真的找到对应句子的来源。 */
  const bodyFindings = bodiesFetched.filter(
    (source) => source.bodyStatus === "evidence_sentence" && (source.keySentence || "").trim(),
  );
  /** 有来源明确写了统计范围/口径时，才谈口径差异；否则只能说「原因尚未核实」。 */
  const scopeEvidence = facts
    .flatMap((fact) => fact.sources)
    .filter((source) => /(规模以上|统计范围|统计口径|全口径|工业统计)/.test(source.keySentence || ""))
    .slice(0, 2);
  const nationwideClaim = /全国|全面|均已|覆盖全国/.test(claimText);
  const bodySaysNationwide = bodyFindings.some((source) => /全国|全面|均已|覆盖全国/.test(source.keySentence || ""));
  const disputed = verdict?.outcome === "disputed" || facts.some((fact) => fact.relation === "mixed");
  const statisticalDifference = verdict?.headline.includes("统计口径差异") === true;
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

  // 线索调查走另一套呈现：正在寻找什么 → 搜索过程 → 候选对照 → 最终结果。
  if (bundle?.case?.mode === "clue")
    return (
      <div className="trace-page trace-page-wide">
        <ClueCase run={run} bundle={bundle} runId={run.id} />
      </div>
    );

  return (
    <div className="trace-page trace-page-wide">
      <header className="trace-masthead">
        <span className="trace-eyebrow">
          调查过程 ·{" "}
          {run.status === "completed"
            ? "已完成"
            : run.status === "rejected"
              ? "已驳回"
              : run.status === "canceled"
                ? "已取消"
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
          {assessment ? ` · 未检测到重复的来源簇 ${assessment.independentSources} 个` : ""}
          {followups.length ? ` · 追加检索 ${followups.length} 次` : ""}
        </p>
      </header>

      {compareId && compareQuery.data && assessment?.verdict ? (
        <Watershed
          historical={false}
          left={{
            label: "原始调查",
            claim: digestOf(compareQuery.data).claim,
            digest: digestOf(compareQuery.data),
          }}
          right={{ label: "改条件后重新调查", claim: claimText, digest: digestOf(run) }}
        />
      ) : null}
      {SHOWCASE ? null : <ConditionSplitter digest={digestOf(run)} />}

      {run.status === "rejected" || run.status === "canceled" ? (
        <section className="trace-blocker" role="status">
          <strong>{run.status === "rejected" ? "人工确认已驳回" : "调查已取消"}</strong>
          <p>这次调查已终止，没有交付档案。已取得的证据和模型返回仅作为过程记录保留。</p>
        </section>
      ) : null}

      {verdict ? (
        <section className="case-now" data-outcome={verdict.outcome}>
          <div className="case-now-head">
            <span className="case-now-label">当前规则结论</span>
            <b>{outcomeText[verdict.outcome]}</b>
            <span className="case-now-state">
              {run.status === "completed"
                ? "调查已完成"
                : run.status === "rejected"
                  ? "人工确认已驳回"
                  : run.status === "canceled"
                    ? "调查已取消"
                : run.status === "waiting_approval"
                  ? "等待人工确认"
                  : run.status === "failed"
                    ? "调查中断"
                    : "正在检索与核验"}
            </span>
          </div>
          <p className="case-now-text">{evidenceWording(verdict.statement)}</p>
          {quantityBySource.length > 1 ? (
            <div className="trace-quantity-diff" aria-label="已核实的不同来源数字">
              <h3>已找到的两组数字</h3>
              <ul>
                {quantityBySource.slice(0, 2).map((item) => (
                  <li key={`${item.source}-${item.value}`}>
                    <b>{item.source}：{item.value}{item.unit}{item.approximate ? "（约）" : ""}</b>
                    <span>{item.sentence.slice(0, 90)}</span>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">打开原始页面</a>
                  </li>
                ))}
              </ul>
              <p className="trace-hint">两组数字都有可查出处。具体差异原因尚未核实，不能断定任何一方计算错误。</p>
            </div>
          ) : null}
          {weakOpposition ? (
            <div className="case-now-note">
              {bodiesFetched.length ? (
                <>
                  <p>
                    这次确实取得了 {bodiesFetched.length} 份网页正文（不是「没有任何原文」），它们各自能说明的是：
                  </p>
                  <ul className="case-body-findings">
                    {bodiesFetched.map((source) => (
                      <li key={source.pageId}>
                        <a href={source.url} target="_blank" rel="noreferrer noopener">
                          {source.site || source.url}
                        </a>
                        {source.bodyStatus === "evidence_sentence" ? (
                          <span>「{(source.keySentence || "").slice(0, 90)}」</span>
                        ) : source.bodyStatus === "boilerplate_only" ? (
                          <span>正文取到了，但基本是导航/样板内容，没有可引用的实质表述。</span>
                        ) : (
                          <span>正文取到了，但正文里没有出现与该说法直接相关的句子。</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p>
                    {bodyFindings.length
                      ? nationwideClaim && !bodySaysNationwide
                        ? `有 ${bodyFindings.length} 份正文能找到对应句子，但都没有写到「全国 / 全面 / 均已」建成或覆盖，只能说明局部情况；连同 ${contradictionCount} 条相反表述、${supportCount} 条支持表述，仍不足以证明「${claimText}」。`
                        : `这些正文与 ${contradictionCount} 条相反表述、${supportCount} 条支持表述都还没有通过独立性核对，因此仍不足以证明「${claimText}」。`
                      : `但这 ${bodiesFetched.length} 份正文里都没有能直接支撑该说法的句子，${contradictionCount} 条相反表述也仍然只有摘要，因此还不足以证明「${claimText}」。`}
                  </p>
                </>
              ) : (
                <p>
                  补充说明：这次确实检索到相关内容（{contradictionCount} 条给出与说法相反的表述、{supportCount} 条给出支持表述），
                  但没有取得可核对的网页正文，按规则不能当作依据，所以结论停在「证据不足」。
                </p>
              )}
            </div>
          ) : null}
          <p className="trace-hint">来源簇仅按已识别的同源线索归并；未检测到重复不等于已证明来源独立。</p>
          <div className="case-now-counts">
            <span title="未检测到与其它来源重复的来源簇，不等于已证实独立">
              未检测到重复 <b>{assessment?.independentSources ?? "—"}</b>
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

      <InvestigationStory run={run} assessment={assessment} revisions={revisions} />
      <InvestigationRoles run={run} />
      <ExperienceReuse runId={run.id} hints={assessment?.experiences} />

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
                  <li key={index}>{evidenceWording(item)}</li>
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
                    {item.changes?.length ? evidenceWording(item.changes.join("；")) : "与上一版相比结论与来源统计没有变化。"}
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
              <p className="trace-verdict-text">{evidenceWording(verdict.statement)}</p>
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
          <h2>{statisticalDifference ? "统计口径差异：先明确适用范围" : disputed ? "来源之间说法不一致" : "有来源给出相反说法"}</h2>
          <p>
            {statisticalDifference
              ? "统计局相关统计与中汽协口径分别保留。支持或反对是各自口径对指定门槛的判断，不表示同口径权威来源直接矛盾，也不认定其中一方错误。"
              : disputed
                ? "同一条事实既有支持也有反对来源。下面把它们并排列出，请直接打开原始网页判断。"
                : weakOpposition
                  ? `共 ${contradictionCount} 条来源给出相反数字、${supportCount} 条给出支持数字，但它们都只有搜索摘要、且没有通过独立性核对，因此结论停在「证据不足」，不按任一方下判断。`
                  : `共 ${contradictionCount} 条来源与待核查说法相反，结论已按「存在反证」处理。`}
          </p>
          {quantityBySource.length > 1 ? (
            <div className="trace-quantity-diff">
              <h3>两个数字分别来自哪里</h3>
              <ul>
                {quantityBySource.slice(0, 4).map((item) => (
                  <li key={`${item.source}-${item.value}`}>
                    <b>
                      {item.source}：{item.value}
                      {item.unit}
                      {item.approximate ? "（约）" : ""}
                    </b>
                    <span>{item.sentence.slice(0, 90)}</span>
                    <a href={item.url} target="_blank" rel="noreferrer noopener">打开原始页面</a>
                  </li>
                ))}
              </ul>
              {scopeEvidence.length ? (
                <div className="trace-scope-evidence">
                  <p className="trace-hint">检索到的原文里有关于统计范围的说明：</p>
                  <ul>
                    {scopeEvidence.map((source) => (
                      <li key={source.pageId}>
                        <a href={source.url} target="_blank" rel="noreferrer noopener">
                          {source.site}
                        </a>
                        「{(source.keySentence || "").slice(0, 100)}」
                      </li>
                    ))}
                  </ul>
                  <p className="trace-hint">这些说明只解释各自统计的是什么，仍不能推出两个数字差异的全部原因。</p>
                </div>
              ) : null}
              <p className="trace-hint">
                能确认的是：两个数字分别出自这两个机构的公开报道。具体差异原因尚未核实——本次没有取得能证明统计范围或口径差异的原文说明，因此不推断差异机制，也不认定哪一方错误。
              </p>
            </div>
          ) : null}
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

      <ModelReview run={run} />

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
