import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, FileJson, ShieldCheck } from "lucide-react";
import {
  SHOWCASE,
  archiveArtifacts,
  bundleOf,
  client,
  fetchAssessment,
  fetchRevisions,
  followupsOf,
  outcomeText,
  stepOf,
  type CorrectionImpact,
  type FactAssessment,
  type SourceAssessment,
  type SourceCluster,
} from "../api";
import { BackLink, Tag, VersionCompare, archiveHref, caseHref, formatTime, impactText, relationTone } from "../components";
import { relationText } from "../api";

export function Archive() {
  const { runId = "" } = useParams();
  const runQuery = useQuery({ queryKey: ["run", runId], queryFn: () => client.run(runId) });
  const assessmentQuery = useQuery({
    queryKey: ["assessment", runId],
    queryFn: () => fetchAssessment(runId),
    enabled: !!runQuery.data,
  });
  const revisionsQuery = useQuery({
    queryKey: ["revisions", runId],
    queryFn: () => fetchRevisions(runId),
    enabled: !!runQuery.data,
  });
  const [pickedVersion, setPickedVersion] = useState<number | null>(null);

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
  const versions = revisionsQuery.data?.revisions || [];
  const shown =
    versions.find((item) => item.revision === pickedVersion) || versions[versions.length - 1] || null;
  const latest = versions[versions.length - 1] || null;
  const viewingLatest = !shown || !latest || shown.revision === latest.revision;
  const pending = revisionsQuery.data?.dirty === true && !!latest;
  // pickedVersion === 0 表示查看「当前结论」（重算后、还没成档的那一版）
  const showCurrent = pickedVersion === 0 && pending;
  const assessment = showCurrent
    ? revisionsQuery.data?.current
    : (shown?.assessment ?? assessmentQuery.data?.assessment ?? bundle?.assessment);
  const verdict = assessment?.verdict;
  const facts = (assessment?.facts || []) as FactAssessment[];
  const clusters: SourceCluster[] = assessment?.clusters || [];
  const files = shown ? shown.artifacts : archiveArtifacts(run);
  const followups = followupsOf(run);
  const intake = stepOf(run, "trace.case.intake")?.output as
    | { case?: { question?: string; claim?: string; createdAt?: string; modeNote?: string } }
    | undefined;
  const caseInfo = intake?.case;

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
          <p>档案只在人工确认通过、导出步骤真实执行后生成，这里不会用预览替代。</p>
        </div>
        <a className="trace-btn" href={caseHref(run.id)}>
          回到调查过程
        </a>
        <BackLink />
      </div>
    );

  const tone = relationTone(verdict.outcome === "supported" ? "supports" : verdict.outcome === "contradicted" ? "contradicts" : "unclear");
  const allSources = [...new Map(facts.flatMap((fact) => fact.sources).map((source) => [source.pageId, source])).values()];
  const keyEvidence = allSources
    .filter((source) => source.relation === "supports")
    .sort((a, b) => Number(b.bodyAvailable) - Number(a.bodyAvailable) || b.relevance - a.relevance)
    .slice(0, 4);
  const opposing = allSources.filter((source) => source.relation === "contradicts").slice(0, 4);
  const missing = assessment?.openQuestions || [];
  const unconfirmedTotal = facts.reduce((sum, fact) => sum + (fact.unconfirmedSources || 0), 0);
  // 档案快照按交付时间冻结；影响数据在运行记录里，老版本快照没带就按 pageId+时间对齐补上。
  const correctionLedger = run.evidence
    .filter((item) => item.kind === "trace.correction")
    .map((item) => item.data as { pageId: string; at: string; impact?: CorrectionImpact });
  const corrections = (assessment?.corrections || []).map((item) => ({
    ...item,
    impact:
      item.impact || correctionLedger.find((entry) => entry.pageId === item.pageId && entry.at === item.at)?.impact,
  }));

  return (
    <div className="trace-page trace-page-wide">
      <header className="trace-masthead">
        <span className="trace-eyebrow">调查档案 · {formatTime(run.updatedAt)}</span>
        <h1>{caseInfo?.claim || caseInfo?.question || "调查档案"}</h1>
        <p className="trace-lede">
          {caseInfo?.question && caseInfo.question !== caseInfo.claim ? `原始问题：${caseInfo.question} · ` : ""}
          {followups.length ? `追加检索 ${followups.length} 次 · ` : ""}
          {shown ? `档案第 ${shown.revision} 版 · ` : ""}
          事实由人工确认（未使用 AI 拆解）
        </p>
      </header>

      {versions.length ? (
        <section className="trace-versionbar">
          <div className="trace-versionbar-head">
            <strong>
              {showCurrent
                ? "当前结论（尚未成档）"
                : shown
                  ? `档案第 ${shown.revision} 版`
                  : "档案版本"}
              {shown?.derived && !showCurrent ? "（历史记录）" : ""}
            </strong>
            <span>
              {shown ? `${formatTime(shown.at)} · ${shown.actor}` : ""}
              {shown ? ` · 追加检索 ${shown.followupCount} 次 · 人工修正 ${shown.correctionCount} 条` : ""}
            </span>
          </div>
          {versions.length > 1 ? (
            <VersionCompare
              revisions={versions}
              activeRevision={showCurrent ? 0 : shown?.revision ?? 0}
              onPick={(revision) => setPickedVersion(revision)}
            />
          ) : (
            <div className="trace-versionbar-chips" role="tablist" aria-label="调查档案版本">
              {versions.map((item) => (
                <button
                  key={item.revision}
                  type="button"
                  role="tab"
                  aria-selected={(shown?.revision ?? 0) === item.revision}
                  data-active={(shown?.revision ?? 0) === item.revision ? "true" : "false"}
                  className="trace-version-chip"
                  onClick={() => setPickedVersion(item.revision)}
                >
                  第 {item.revision} 版
                  <small>{item.verdict ? outcomeText[item.verdict.outcome] : "记录"}</small>
                </button>
              ))}
            </div>
          )}
          {pending ? (
            <button
              type="button"
              className="trace-version-chip trace-version-chip-current"
              data-active={pickedVersion === 0 ? "true" : "false"}
              onClick={() => setPickedVersion(0)}
            >
              当前结论（未成档）
            </button>
          ) : null}
          {pickedVersion === 0 ? (
            <p className="trace-hint">
              这是第 {latest?.revision} 版交付之后、按新证据重算的结论，还没有生成档案。回到调查过程页点「重新确认」即可出新增版本。
            </p>
          ) : null}
          {shown && shown.changes.length ? (
            <details className="trace-version-changes" open={viewingLatest && shown.revision > 1}>
              <summary>这一版为什么变化（相对第 {shown.revision - 1} 版）</summary>
              <ul className="trace-verdict-changes">
                {shown.changes.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {pending && !pickedVersion ? (
            <div className="trace-versionbar-pending">
              <strong>首版之后又有新证据，当前结论尚未成档</strong>
              <ul className="trace-verdict-changes">
                {(revisionsQuery.data?.changes || []).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
              <a className="trace-link" href={caseHref(run.id)}>
                回到调查过程页重新确认
              </a>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="trace-verdict trace-verdict-hero" data-outcome={verdict.outcome}>
        <div className="trace-verdict-head">
          <h2>{outcomeText[verdict.outcome]}</h2>
          <Tag tone={tone}>把握程度 {verdict.confidence === "medium" ? "中" : verdict.confidence === "high" ? "高" : "低"}</Tag>
        </div>
        <p className="trace-verdict-text">{verdict.statement}</p>
        <div className="trace-counts">
          <span title="未检测到与其它来源重复的来源簇，不等于已证实独立">
            未检测到重复 <b>{verdict.counts.independentSources}</b>
          </span>
          <span>
            取得原文 <b>{verdict.counts.bodyAvailable}</b>
          </span>
          <span>
            命中网页 <b>{verdict.counts.pages}</b>
          </span>
          <span>
            检索 <b>{verdict.counts.queries}</b> 次
          </span>
          {unconfirmedTotal ? (
            <span title="可能是转载但缺少可核对依据，未计入独立来源">
              独立性未确认 <b>{unconfirmedTotal}</b>
            </span>
          ) : null}
        </div>
        <ul className="trace-notes">
          {verdict.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      </section>

      {keyEvidence.length ? (
        <section className="trace-block">
          <div className="trace-section-head">
            <h2>最关键的支持依据</h2>
            <span>按「是否取得原文正文」优先排序</span>
          </div>
          <div className="trace-key-evidence">
            {keyEvidence.map((source) => (
              <KeyEvidence key={source.pageId} source={source} />
            ))}
          </div>
        </section>
      ) : null}

      {opposing.length ? (
        <section className="trace-block trace-block-warn">
          <div className="trace-section-head">
            <h2>来源之间的矛盾</h2>
            <span>{opposing.length} 条来源与说法相反</span>
          </div>
          <div className="trace-key-evidence">
            {opposing.map((source) => (
              <KeyEvidence key={source.pageId} source={source} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="trace-block">
        <div className="trace-section-head">
          <h2>尚未解决的问题</h2>
          <span>{missing.length ? `${missing.length} 项` : "本次结论没有遗留缺口"}</span>
        </div>
        {missing.length ? (
          <ul className="trace-missing">
            {missing.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="trace-lede">支持性证据已满足「≥2 个独立来源且至少一份原文」的要求，可直接复核下列链接。</p>
        )}
        {missing.length ? (
          <p className="trace-hint">
            想补齐这些缺口，回到调查过程页用「追加一次检索」换更具体的说法继续查即可，记录会并入同一条调查。
          </p>
        ) : null}
      </section>

      {corrections.length ? (
        <section className="trace-block trace-block-warn">
          <div className="trace-section-head">
            <h2>人工修正记录</h2>
            <span>{corrections.length} 条判断由人改过，系统自动判断同时保留</span>
          </div>
          <ul className="trace-notes">
            {corrections.map((item, index) => (
              <li key={index}>
                <strong>{item.actor}</strong> 将来源 {item.pageId} 的判断修正为「{relationText[item.relation]}」
                {item.impact
                  ? `（系统原判「${relationText[item.impact.sourceBefore]}」）`
                  : ""}
                ：{item.note}
                {item.impact ? <span className="trace-impact">影响：{impactText(item.impact)}</span> : null}
                <span className="trace-mono"> · {formatTime(item.at)}</span>
              </li>
            ))}
          </ul>
          <p className="trace-hint">
            人工修正只改证据关系，不改原始搜索返回与网页摘录；原始判断与「对结论的影响」都按真实重算结果记录。
          </p>
        </section>
      ) : null}

      <section className="trace-block">
        <div className="trace-section-head">
          <h2>来源清单</h2>
          <span>
            {clusters.length ? `${clusters.length} 组独立来源` : `${allSources.length} 条来源`}
          </span>
        </div>
        {clusters.length ? (
          <ul className="trace-clusters">
            {clusters.map((cluster) => (
              <li key={cluster.id} data-reprint={cluster.reprint ? "true" : "false"}>
                <a href={cluster.primary.url} target="_blank" rel="noreferrer noopener">
                  {cluster.primary.title}
                </a>
                <span className="trace-cluster-meta">
                  {cluster.primary.site}
                  {cluster.primary.date ? ` · ${cluster.primary.date.slice(0, 10)}` : ""}
                  {cluster.primary.bodyAvailable ? " · 原文已取" : " · 仅摘要"}
                  {cluster.reprint ? ` · ${cluster.size} 篇同源` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="trace-clusters">
            {allSources.map((source) => (
              <li key={source.pageId}>
                <a href={source.url} target="_blank" rel="noreferrer noopener">
                  {source.title}
                </a>
                <span className="trace-cluster-meta">
                  {source.site}
                  {" · "}
                  {relationText[source.relation]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="trace-block">
        <div className="trace-section-head">
          <h2>下载与复查</h2>
          <span>
            {shown ? `第 ${shown.revision} 版` : ""} {files.length} 个文件
          </span>
        </div>
        <div className="trace-downloads">
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
          {SHOWCASE ? null : (
            <a className="trace-btn" href={client.receiptUrl(run.id)}>
              <ShieldCheck size={14} /> 最终运行凭证
            </a>
          )}
        </div>
        <p className="trace-hint">
          档案在导出步骤生成并记录 SHA-256。每个版本的档案一经生成即固定：这一版下载的永远是这一版的结论与来源。
          {SHOWCASE ? "当前是只读的历史调查展示，下载到的是当时生成的真实档案文件。" : "最终完成状态以运行凭证为准，凭证会逐个校验文件摘要。"}
        </p>
        {versions.length > 1 ? (
          <details className="trace-details">
            <summary>全部版本的档案文件（{versions.length} 版）</summary>
            <ul className="trace-version-files">
              {versions.map((item) => (
                <li key={item.revision}>
                  <span>第 {item.revision} 版 · {formatTime(item.at)}</span>
                  {item.artifacts.map((file) => (
                    <a key={file.id} className="trace-link" href={client.artifactUrl(run.id, file.id)} download={file.filename}>
                      {file.filename}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <details className="trace-details trace-tech">
        <summary>判断方法与过程记录（技术细节，供复查）</summary>
        <ul className="trace-notes">
          <li>{caseInfo?.modeNote || "事实与检索式由人工确认，系统未执行 AI 事实拆解。"}</li>
          <li>支持性判断要求 ≥2 个独立来源，且至少一份取得原文正文；内容雷同的转载按 1 条计算。</li>
          <li>数量断言只在同一计量单位下比较，并尊重「超过 / 以上 / 低于」等比较方向。</li>
          <li>系统未调用任何模型为结论背书；结论文本里的判断全部来自本档案列出的来源。</li>
          {(bundle?.checks || []).map((check, index) => (
            <li key={index}>
              {check.name}：{check.status === "not_evaluated" ? "未完成" : check.passed ? "通过" : "未通过"} ·{" "}
              {check.detail}
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
              {followups.map((item, index) => (
                <tr key={`f-${index}`}>
                  <td>{item.query}（追加）</td>
                  <td>{item.error ? item.error.code : item.httpStatus}</td>
                  <td>{item.resultCount}</td>
                  <td>{(item.durationMs / 1000).toFixed(1)}s</td>
                  <td className="trace-mono">{item.requestId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </details>

      <div className="trace-foot">
        <a className="trace-btn" href={caseHref(run.id)}>
          查看调查过程
        </a>
        <BackLink />
      </div>
    </div>
  );
}

function KeyEvidence({ source }: { source: SourceAssessment }) {
  const quote = source.bodyExcerpt || source.excerpt;
  return (
    <article className="trace-key" data-relation={source.relation}>
      <a className="trace-key-title" href={source.url} target="_blank" rel="noreferrer noopener">
        {source.title}
      </a>
      <div className="trace-key-meta">
        <span>{source.site}</span>
        <span>{source.date ? source.date.slice(0, 10) : "未标注时间"}</span>
        <span>{source.bodyAvailable ? "原文正文" : "搜索摘要"}</span>
        {source.duplicate ? <span>同源转载</span> : null}
      </div>
      {source.manualCorrection ? (
        <p className="trace-evidence-reprint">
          {source.autoRelation
            ? `人工修正：系统自动判断为「${relationText[source.autoRelation]}」，${source.manualCorrection.actor} 改为「${relationText[source.relation]}」：${source.manualCorrection.note}`
            : `人工修正：${source.manualCorrection.actor} 确认为「${relationText[source.relation]}」：${source.manualCorrection.note}`}
        </p>
      ) : null}
      {quote ? <blockquote className="trace-quote">{quote}</blockquote> : null}
    </article>
  );
}
