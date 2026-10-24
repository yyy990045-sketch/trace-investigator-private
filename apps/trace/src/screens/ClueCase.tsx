import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, CircleDashed, Link2, Search, X } from "lucide-react";
import {
  SHOWCASE,
  client,
  fetchClueAssessment,
  postClueAnswer,
  postClueSearch,
  postClueAuto,
  type CandidateView,
  type ClueAssessmentView,
  type ClueItemView,
  type TraceBundleView,
} from "../api";
import type { RunRecord } from "@personal/capability-sdk";
import { formatTime } from "../components";
import { needsDetectiveFollowup } from "../clue-followup-policy";

const clueKindName: Record<ClueItemView["kind"], string> = {
  genre: "题材",
  role: "职业/身份",
  time: "时间",
  region: "地区",
  subject: "对象",
  other: "细节",
};

const targetKindName: Record<string, string> = {
  screen_work: "一部剧 / 电影",
  book: "一本书",
  person: "一个人（演员或角色）",
  unknown: "还没说清",
};
const relationName: Record<string, string> = {
  alias: "别名",
  source: "原著",
  character: "剧中角色",
  sequel: "续作 / 某一季",
  remake: "翻拍作品",
  not_screen_work: "不是影视作品",
  unconfirmed: "关系未确认",
  competitor: "候选",
  target: "目标",
};
const graphName: Record<string, string> = {
  alias: "同一部作品的别名",
  adaptation: "改编自",
  sequel: "是它的续集",
  remake: "翻拍自",
  character_of: "角色出自",
  competitor: "彼此无关",
};

const stateCopy: Record<ClueAssessmentView["decision"]["state"], { title: string; tone: string }> = {
  // 不写「全部线索都对上」：用户自己的某条记忆可能已被资料纠正，
  // 只有具体剧情线索都在资料里核到时才会走到 found。
  found: { title: "在资料里核到了你说的剧情线索", tone: "found" },
  ambiguous: { title: "有几个候选都能对上部分线索", tone: "ambiguous" },
  insufficient: { title: "还没有足够证据给出答案", tone: "insufficient" },
};

/**
 * 线索调查页：正在寻找什么 → 搜索过程 → 候选对照 → 最终结果。
 * 所有文案都绑定真实步骤与真实检索记录，没发生的步骤不会出现。
 */
export function ClueCase({
  run,
  bundle,
  runId,
}: {
  run: RunRecord;
  bundle: TraceBundleView;
  runId: string;
}) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [autoState, setAutoState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const assessmentQuery = useQuery({
    queryKey: ["clue-assessment", runId],
    queryFn: () => fetchClueAssessment(runId),
    enabled: run.steps.some((step) => step.capabilityId === "trace.clue.candidates" && step.output),
  });
  const assessment =
    (assessmentQuery.data as ClueAssessmentView | null) ||
    ((bundle.assessment as unknown as ClueAssessmentView | undefined) ?? null);
  const plan = bundle.case?.plan;
  const clues = assessment?.clues || bundle.case?.clues || [];

  const rounds = useMemo(
    () =>
      run.evidence
        .filter((item) => item.kind === "trace.clue.search" || item.kind === "trace.followup")
        .map((item) => item.data as { query: string; reason?: string; resultCount?: number; error?: unknown; requestedAt?: string }),
    [run.evidence],
  );
  const relationRounds = useMemo(
    () =>
      run.evidence
        .filter((item) => item.kind === "trace.clue.question")
        .map((item) => item.data as { question: string; query: string; reason: string; subject: string; object: string; kind?: string; stateBefore?: string; stateAfter?: string; resultCount?: number }),
    [run.evidence],
  );
  const graph = assessment?.graph || [];
  /** 这一轮关系查询之后，是否真的补到了关系。 */
  const relationFoundFor = (round: { subject: string; object: string }) => {
    const fromGraph = graph.filter(
      (item) =>
        [item.subject, item.object].includes(round.subject) &&
        [item.subject, item.object].includes(round.object) &&
        item.status !== "unconfirmed",
    );
    // 有些问题不是「两个作品的关系」，而是「它到底是什么」：候选身份一旦确定也算查清。
    const typed = (assessment?.candidates || []).filter(
      (candidate) => [round.subject, round.object].includes(candidate.name) && candidate.entity?.role && candidate.entity.role !== "unconfirmed",
    );
    const fromType = typed.length > 1
      ? [`${typed[0].name}：${relationName[typed[0].entity!.role] || typed[0].entity!.role}`]
      : [];
    return [...fromGraph.map((item) => `${item.subject} ——${graphName[item.relation] || item.relation}→ ${item.object}`), ...fromType];
  };
  const searches = bundle.searches || [];
  const started = run.steps.find((step) => step.capabilityId === "trace.clue.intake");
  const candidates = assessment?.candidates || [];

  // 发现关系疑点就自动补查（只读回放不发请求；同一页面只自动触发一次）。
  const pendingCount = assessment?.pending?.length || 0;
  const decision = assessment?.decision;
  const actionable = needsDetectiveFollowup({
    status: run.status,
    decision,
    pendingCount,
    candidates,
    followupCount: assessment?.followupCount || 0,
  });
  useEffect(() => {
    if (SHOWCASE || autoState !== "idle" || !actionable) return;
    if ((assessment?.followupCount || 0) >= 4) {
      setAutoState("done");
      return;
    }
    setAutoState("running");
    void (async () => {
      try {
        await postClueAuto(runId, 2);
        await cache.invalidateQueries({ queryKey: ["clue-assessment", runId] });
        await cache.invalidateQueries({ queryKey: ["run", runId] });
        setAutoState("done");
      } catch {
        setAutoState("failed");
      }
    })();
  }, [actionable, autoState, assessment?.followupCount, cache, runId]);

  async function continueSearch(query: string, reason: string) {
    setBusy(query);
    setError(null);
    try {
      await postClueSearch(runId, query, reason);
      await cache.invalidateQueries({ queryKey: ["clue-assessment", runId] });
      await cache.invalidateQueries({ queryKey: ["run", runId] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "继续追查失败。");
    } finally {
      setBusy("");
    }
  }

  async function submitAnswer() {
    const text = answer.trim();
    if (text.length < 2) return;
    setBusy("answer");
    setError(null);
    try {
      await postClueAnswer(runId, text);
      setAnswer("");
      await cache.invalidateQueries({ queryKey: ["clue-assessment", runId] });
      await cache.invalidateQueries({ queryKey: ["run", runId] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "补充线索失败。");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="clue-page" aria-label="线索调查">
      {/* 区域一：正在寻找什么 */}
      <header className="clue-intro">
        <span className="clue-kicker">
          线索调查 · {run.status === "completed" ? "已完成" : run.status === "failed" ? "已中断" : "进行中"}
        </span>
        <h1>{bundle.case?.question}</h1>
        {bundle.case?.goal ? <p className="clue-goal">调查目标：{bundle.case.goal}</p> : null}
        <ul className="clue-chips" aria-label="已识别的线索">
          {clues.map((clue) => (
            <li key={clue.id} data-added={clue.addedByUser ? "true" : "false"}>
              <span className="clue-chip-kind">{clueKindName[clue.kind] || "细节"}</span>
              {clue.text}
              {clue.addedByUser ? <em>你补充的</em> : null}
              {clue.uncertain ? <em>你不确定</em> : null}
            </li>
          ))}
        </ul>
        {assessment?.targetKind ? (
          <p className="clue-target-kind">
            你要找的是：<b>{targetKindName[assessment.targetKind] || "还没说清"}</b>
            {assessment.targetKind === "unknown" ? "（按作品处理，候选类型会在下面标出）" : ""}
          </p>
        ) : null}
        <p className="clue-meta">
          {plan
            ? plan.source === "model"
              ? `线索与检索式由 ${plan.model || "模型"} 规划（${(plan.durationMs / 1000).toFixed(1)} 秒），答案只来自真实检索。`
              : `线索与检索式按规则拆分（${plan.fallbackReason || "未使用模型"}），答案只来自真实检索。`
            : "正在识别线索…"}
        </p>
      </header>

      {/* 首屏：答案、依据与未解疑点，优先于搜索过程 */}
      <section className="clue-result" data-state={decision?.state || "insufficient"} aria-label="调查结果">
        <h2>{decision ? stateCopy[decision.state].title : "调查进行中"}</h2>
        <p className="clue-headline">{decision?.headline}</p>
        {decision?.state === "found" && candidates[0] ? (
          <div className="clue-answer">
            <b>{candidates[0].name}</b>
            <span>对上 {candidates[0].matchedClues}/{clues.length} 条线索</span>
          </div>
        ) : null}

        {/* 答案已确定，但有的情节并没有在资料里核到：必须单独列出来，不能默认成立。 */}
        {decision?.state === "found" && decision.unverified?.length ? (
          <div className="clue-hint" aria-label="尚未核实的情节">
            <b>还没在资料里核到的情节：</b>
            {decision.unverified.join("、")}（没查到不等于不存在，只是这次没有找到对应原文）
          </div>
        ) : null}

        {/* 用户记忆与资料冲突：有原文依据才展示，且不改写用户原话。 */}
        {decision?.conflicts?.length ? (
          <div className="clue-conflict" aria-label="记忆与资料不一致的线索">
            <h3>你有一条线索和资料不一致</h3>
            <ul>
              {decision.conflicts.map((item, index) => (
                <li key={`${item.clue}-${index}`}>
                  <p>
                    你说的是「<b>{item.clue}</b>」，但资料里关于《{item.candidate}》的原文是这样写的：
                  </p>
                  <blockquote>{item.quote}</blockquote>
                  <p className="trace-mono">
                    {item.site || item.url}
                    {item.from === "body" ? " · 原文正文" : " · 搜索摘要"}
                    {item.url ? (
                      <>
                        {" "}
                        <a href={item.url} target="_blank" rel="noreferrer noopener">
                          打开原始页面
                        </a>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
            <p className="clue-hint">
              这条冲突不影响其余线索的核对；最终答案按资料判定，你的原始描述没有被改写。
            </p>
          </div>
        ) : null}

        {/* 还没定案时：最可能答案 + 已确认的事实 + 待确认的事实，一次说清。 */}
        {decision && decision.state !== "found"
          ? (() => {
              // 没有「最可能答案」时不要拿候选第一名冒充它（检索噪声会被读成结论）。
              if (!decision.bestGuess) return null;
              const guess = candidates.find((candidate) => candidate.name === decision.bestGuess);
              if (!guess) return null;
              const confirmed = guess.matches.filter((match) => match.found).map((match) => match.clue);
              const pending = guess.missingClues;
              const corrected = (decision.conflicts || []).map((item) => item.clue);
              return (
                <div className="clue-explain" aria-label="最可能答案的已确认与待确认事实">
                  <h3>最可能的答案：{guess.name}</h3>
                  <div className="clue-hint">
                    已确认：{confirmed.length ? confirmed.join("、") : "暂无"}
                  </div>
                  <div className="clue-hint">
                    待确认：{pending.length ? pending.join("、") : "暂无"}
                  </div>
                  {corrected.length ? (
                    <div className="clue-hint">
                      与资料不符的记忆：{corrected.join("、")}（原文见上方「记忆与资料不一致」）
                    </div>
                  ) : null}
                  <p className="clue-hint">所以现在只能给「最可能」，不能当成已经确认。</p>
                </div>
              );
            })()
          : null}

        {/* 还无法排除其他候选时：先给最可能答案，再摊开各候选符合/缺少的情节。 */}
        {decision?.bestGuess ? (
          <div className="clue-answer clue-answer-partial">
            <b>最可能：{decision.bestGuess}</b>
            <span>尚未完全排除其他候选</span>
          </div>
        ) : null}

        {/* 作品身份：类型 / 年份 / 导演 / 主演，都带来源，第一屏就能核对。 */}
        {candidates[0]?.identity ? (
          <div className="clue-hint" aria-label="作品身份">
            <b>作品身份：</b>
            {[
              (candidates[0].identity.types || []).map((item: any) => (item.value === "tv" ? "电视剧" : item.value === "film" ? "电影" : item.value === "anime" ? "动画" : item.value === "book" ? "小说/原著" : "类型未知")),
              (candidates[0].identity.years || []).map((item: any) => `${item.value} 年`),
              (candidates[0].identity.directors || []).map((item: any) => `导演 ${item.value}`),
              (candidates[0].identity.cast || []).slice(0, 3).map((item: any) => `主演 ${item.value}`),
            ].flat().filter(Boolean).join(" · ") || "现有资料没有写清类型、年份或演职员"}
            {(candidates[0].identity.conflicts || []).length ? (
              <span data-identity-conflict="true">
                {" "}（{(candidates[0].identity?.conflicts || []).join("；")}）
              </span>
            ) : null}
            {(() => {
              const evidence = [
                ...(candidates[0].identity.types || []),
                ...(candidates[0].identity.years || []),
              ].find((item: any) => item.url);
              return evidence ? (
                <>
                  {" "}
                  <a href={evidence.url} target="_blank" rel="noreferrer noopener">
                    {evidence.site || "来源"}
                  </a>
                </>
              ) : null;
            })()}
          </div>
        ) : null}

        {decision?.comparison?.length ? (
          <div className="clue-explain" aria-label="候选对照">
            <h3>各候选符合哪些情节</h3>
            <ul>
              {decision.comparison.map((item) => (
                <li key={item.name}>
                  <b>{item.name}</b>
                  <span>{`（${item.type}，${item.note}）`}</span>
                  <div className="clue-hint">
                    {item.matched.length ? `符合：${item.matched.join("、")}` : "符合：暂无可核对的直接情节"}
                  </div>
                  <div className="clue-hint">
                    {item.missing.length ? `资料里还没核到：${item.missing.join("、")}` : "资料里没有缺失情节"}
                  </div>
                </li>
              ))}
            </ul>
            <p className="clue-hint">
              要区分它们，还缺一条能对上其中一部的具体情节（人物做了什么、发生在哪里、结局是什么）。
            </p>
          </div>
        ) : null}

        {decision?.yearCheck ? (
          <div className="clue-hint" data-year-check="true">
            <b>年份核对：</b>
            {decision.yearCheck.note}
            {decision.yearCheck.candidateYears.length ? (
              <ul>
                {decision.yearCheck.candidateYears.map((item, index) => (
                  <li key={`${item.year}-${index}`}>
                    {item.year} 年 · {item.quote}
                    {item.url ? (
                      <>
                        {" "}
                        <a href={item.url} target="_blank" rel="noreferrer noopener">
                          {item.site || "原始页面"}
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {decision?.decisiveClues?.length ? (
          <div className="clue-decisive">
            <h3>用来定案的决定性线索</h3>
            <ul>
              {decision.decisiveClues.map((clue) => {
                const hit = candidates[0]?.matches.find((match) => match.clue === clue && match.found);
                return (
                  <li key={clue} data-hit={hit ? "true" : "false"}>
                    <b>{clue}</b>
                    {hit ? (
                      <span>「{hit.sentence}」 · <a href={hit.url} target="_blank" rel="noopener noreferrer">{hit.site || "查看来源"}（{hit.from === "body" ? "原文" : "搜索摘要"}）</a></span>
                    ) : <span>还没有直接证据</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {decision?.state === "found" && decision.auxiliaryClues?.length ? (
          <p className="clue-hint">
            说明：{decision.auxiliaryClues.join("、")} 属于题材/地区类线索，网页里没有和片名出现在同一句，按整页内容判断，未单独取证。
          </p>
        ) : null}

        {/* 同一个名字的不同版本（动画/真人/不同年份）：这是「多个相似候选」最常见的形态。 */}
        {assessment?.variants?.length ? (
          <div className="clue-explain" aria-label="同名作品的版本">
            <h3>同名作品的版本</h3>
            {assessment.variantNote ? <p className="clue-hint">{assessment.variantNote}</p> : null}
            <ul>
              {assessment.variants.map((variant) => (
                <li key={`${variant.year}-${variant.form}`}>
                  <b>{variant.label}</b>
                  <span>{`：${variant.quote}`}</span>
                  {variant.url ? (
                    <>
                      {" "}
                      <a href={variant.url} target="_blank" rel="noreferrer noopener">
                        {variant.site || "原始页面"}
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {candidates.length > 1 && decision?.state === "found" ? (
          <div className="clue-explain">
            <h3>为什么不是其他候选</h3>
            <ul>
              {candidates.slice(1, 4).map((candidate) => (
                <li key={candidate.name}>
                  <b>{candidate.name}</b>
                  {candidate.missingClues.length
                    ? `：缺少「${candidate.missingClues.slice(0, 2).join("」「")}」的对应证据`
                    : `：线索也能对上，但被指认它的网页标题只有 ${candidate.titleHits ?? 0} 条（${candidates[0].name} 是 ${candidates[0].titleHits ?? 0} 条），没有它那么明确`}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {candidates.length > 1 && decision?.state !== "found" ? (
          <div className="clue-explain">
            <h3>还不能确定的原因</h3>
            <ul>
              {candidates.slice(0, 3).map((candidate) => (
                <li key={candidate.name}>
                  <b>{candidate.name}</b>
                  {candidate.missingClues.length
                    ? `：没有找到「${candidate.missingClues.slice(0, 2).join("」「")}」的对应证据`
                    : "：线索都对上了，但还没有能排除其它候选的证据"}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {decision?.askUser ? (
          <div className="clue-ask">
            <h3>需要你补一条线索</h3>
            <p>{decision.askUser}</p>
            {SHOWCASE ? (
              <p className="clue-hint">只读展示：本机运行时可以回答，并会立刻发起真实检索。</p>
            ) : (
              <div className="clue-ask-form">
                <input
                  aria-label="补充线索"
                  maxLength={120}
                  placeholder="例如：现代城市、2016 年播出、主角姓秦…"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitAnswer();
                  }}
                />
                <button
                  className="trace-btn trace-btn-primary"
                  disabled={busy === "answer" || answer.trim().length < 2}
                  onClick={() => void submitAnswer()}
                >
                  {busy === "answer" ? "正在检索…" : "按这条线索再查"}
                </button>
              </div>
            )}
          </div>
        ) : null}

        {decision?.nextQueries?.length ? (
          <div className="clue-next">
            <h3>继续追查</h3>
            {decision.nextQueries.map((item) => (
              <div key={item.query} className="clue-next-row">
                <div>
                  <b>「{item.query}」</b>
                  <span>{item.reason}</span>
                </div>
                {SHOWCASE ? (
                  <span className="clue-hint">只读展示，不在公网发起新搜索</span>
                ) : (
                  <button
                    className="trace-btn"
                    disabled={Boolean(busy)}
                    onClick={() => void continueSearch(item.query, item.reason)}
                  >
                    <Search size={13} /> {busy === item.query ? "检索中…" : "再搜一次"}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {autoState === "running" ? (
          <p className="clue-hint">正在根据证据缺口主动补查，查询结果会写入本次调查…</p>
        ) : null}
        {decision?.openRelations?.length ? (
          <div className="clue-open-relations">
            <h3>与答案无关、但还没查清的关系</h3>
            <ul>
              {decision.openRelations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? <div className="trace-alert" role="alert">{error}</div> : null}

        <div className="clue-sources">
          <h3>这次用到的来源</h3>
          <ul>
            {(assessment?.candidates || [])
              .slice(0, 2)
              .flatMap((candidate) => candidate.pages.slice(0, 2))
              .filter((page, index, list) => list.findIndex((other) => (other.title || other.url) === (page.title || page.url)) === index)
              .map((page) => (
                <li key={page.url}>
                  <a href={page.url} target="_blank" rel="noreferrer noopener">
                    {page.title || page.url}
                  </a>
                  <span>{page.site}</span>
                </li>
              ))}
          </ul>
          {assessment?.pageCount && assessment.pageCount > 4 ? (
            <p className="clue-hint">
              共 {assessment.pageCount} 条网页、{assessment.bodyAvailable} 份取得原文；其余在下方技术记录里。
            </p>
          ) : null}
        </div>
      </section>

      {/* 区域二：搜索过程 */}
      <details className="clue-timeline" aria-label="搜索过程">
        <summary>搜索与主动补查过程（{searches.length + rounds.length} 次检索，{rounds.length} 轮追查）</summary>
        <ol>
          <li data-done={started?.status === "completed" ? "true" : "false"}>
            <span className="clue-step-dot" />
            <div>
              <b>理解你的描述</b>
              <p>
                {started?.status === "completed"
                  ? `识别出 ${clues.length} 条线索，生成 ${bundle.case?.plan?.queries?.length || searches.length} 条检索式`
                  : "正在识别线索…"}
              </p>
            </div>
          </li>
          {searches.map((search, index) => (
            <li key={`${search.query}-${index}`} data-done={search.error ? "false" : "true"}>
              <span className="clue-step-dot" />
              <div>
                <b>元宝搜索 · 第 {index + 1} 条检索式</b>
                <p>
                  「{search.query}」 · 返回 {search.resultCount} 条 · {(search.durationMs / 1000).toFixed(1)} 秒
                  {search.error ? ` · 失败：${(search.error as { message?: string }).message || "未知原因"}` : ""}
                </p>
              </div>
            </li>
          ))}
          {rounds.map((round, index) => (
            <li key={`round-${index}`} data-done={round.error ? "false" : "true"}>
              <span className="clue-step-dot" />
              <div>
                <b>继续追查 · 第 {index + 1} 轮</b>
                <p>
                  「{round.query}」{round.reason ? ` · ${round.reason}` : ""} · 返回 {round.resultCount ?? 0} 条
                </p>
              </div>
            </li>
          ))}
          {relationRounds.map((round, index) => {
            const found = relationFoundFor(round);
            return (
              <li key={`relation-${index}`} data-done={found.length ? "true" : "false"}>
                <span className="clue-step-dot" />
                <div>
                  <b>{round.kind === "decisive_clue" ? "关键线索补证" : round.kind === "discovery" ? "主动拓展检索" : "候选关系核验"} · 第 {index + 1} 轮</b>
                  <p>{round.question}</p>
                  <p>
                    正在查询「{round.query}」
                    {round.kind && round.kind !== "relationship"
                      ? ` · 返回 ${round.resultCount ?? 0} 条；${round.stateBefore === round.stateAfter ? "目前结论未改变" : `判断从${round.stateBefore || "待确认"}变为${round.stateAfter || "待确认"}`}`
                      : found.length
                        ? ` · 找到关系证据：${found.join("；")}`
                        : " · 本轮没有获得能确认关系的直接证据"}
                  </p>
                </div>
              </li>
            );
          })}
          <li data-done={assessment ? "true" : "false"}>
            <span className="clue-step-dot" />
            <div>
              <b>比对候选</b>
              <p>
                {assessment
                  ? `从 ${assessment.pageCount} 条网页里读出 ${candidates.length} 个候选，逐条核对线索`
                  : "正在比对…"}
              </p>
            </div>
          </li>
        </ol>
      </details>

      {/* 区域三：候选对照 */}
      {candidates.length ? (
        <section className="clue-candidates" aria-label="候选结果">
          <header className="clue-section-head">
            <h2>{decision?.state === "found" ? "最匹配的答案" : "候选对照"}</h2>
            <span>
              {candidates.length} 个候选 · 共 {assessment?.pageCount} 条网页
              {decision?.state !== "found" ? " · 未给出确定排名" : ""}
            </span>
          </header>
          <div className="clue-candidate-grid" data-state={decision?.state}>
            {candidates.slice(0, 4).map((candidate) => (
              <CandidateCard
                key={candidate.name}
                candidate={candidate}
                highlight={decision?.state === "found" && candidate === candidates[0]}
                clues={clues}
              />
            ))}
          </div>
        </section>
      ) : null}

      {graph.length ? (
        <section className="clue-relations" aria-label="作品之间的关系">
          <header className="clue-section-head">
            <h2>查到的作品关系</h2>
            <span>每条都绑定了本次检索到的句子</span>
          </header>
          <ul>
            {graph.map((relation, index) => (
              <li key={`${relation.subject}-${index}`} data-role={relation.relation}>
                <div className="clue-relation-head">
                  <b>{relation.subject}</b>
                  <span>
                    {graphName[relation.relation] || relation.relation} → {relation.object}
                  </span>
                  {relation.status === "conflicting" ? <em>方向存在冲突</em> : null}
                </div>
                <p>{relation.reason}</p>
                {relation.evidence.slice(0, 1).map((item) => (
                  <p key={item.url} className="clue-evidence">
                    「{item.quote}」
                  </p>
                ))}
                {relation.evidence[0]?.url ? (
                  <a href={relation.evidence[0].url} target="_blank" rel="noreferrer noopener">
                    <Link2 size={12} /> {relation.evidence[0].site || "打开来源"}
                  </a>
                ) : null}
                {relation.conflicts.length ? (
                  <p className="clue-missing">
                    另有来源写成相反方向：「{relation.conflicts[0].quote}」
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {assessment?.relations?.length ? (
        <section className="clue-relations" aria-label="同一部作品的关系">
          <header className="clue-section-head">
            <h2>和这部作品相关的东西</h2>
            <span>这些不是其它候选，不参与排名</span>
          </header>
          <ul>
            {assessment.relations.map((relation) => (
              <li key={relation.name} data-role={relation.entity.role}>
                <div className="clue-relation-head">
                  <b>{relation.name}</b>
                  <span>{relationName[relation.entity.role] || relation.entity.role}</span>
                </div>
                <p>{relation.entity.reason}</p>
                {relation.entity.sentence ? (
                  <p className="clue-evidence">「{relation.entity.sentence}」</p>
                ) : null}
                {relation.entity.url ? (
                  <a href={relation.entity.url} target="_blank" rel="noreferrer noopener">
                    <Link2 size={12} /> {relation.entity.site || "打开来源"}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="clue-details">
        <summary>调查记录与技术细节</summary>
        <div>
          <p>
            开始 {formatTime(run.createdAt)} · 检索 {searches.length + rounds.length} 次 · 追加追查 {rounds.length} 轮
            {assessment ? ` · 取得原文 ${assessment.bodyAvailable}/${assessment.pageCount}` : ""}
          </p>
          <table className="trace-table">
            <thead>
              <tr>
                <th>检索式</th>
                <th>返回</th>
                <th>耗时</th>
                <th>RequestId</th>
              </tr>
            </thead>
            <tbody>
              {[...searches, ...rounds.map((round) => ({ ...round, durationMs: 0, requestId: "" }))].map((item, index) => (
                <tr key={index}>
                  <td>{String((item as { query?: string }).query || "")}</td>
                  <td>{String((item as { resultCount?: number }).resultCount ?? "")}</td>
                  <td>{Number((item as { durationMs?: number }).durationMs || 0)}ms</td>
                  <td>{String((item as { requestId?: string }).requestId || "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {bundle.checks?.length ? (
            <ul className="clue-checks">
              {bundle.checks.map((check) => (
                <li key={check.name} data-ok={check.passed ? "true" : "false"}>
                  {check.passed ? <Check size={13} /> : <CircleDashed size={13} />}
                  <b>{check.name}</b>
                  <span>{check.detail}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
    </main>
  );
}

function CandidateCard({
  candidate,
  highlight,
  clues,
}: {
  candidate: CandidateView;
  highlight: boolean;
  clues: ClueItemView[];
}) {
  const decisiveMatches = candidate.matches.filter((match) => match.decisive);
  // 决定性线索排前面：先看能不能定案，再看补充信息。
  const orderedMatches = [...candidate.matches].sort(
    (a, b) => Number(b.decisive) - Number(a.decisive) || Number(b.found) - Number(a.found),
  );
  return (
    <article className="clue-candidate" data-highlight={highlight ? "true" : "false"}>
      <header>
        <h3>{candidate.name}</h3>
        <span>
          决定性 {decisiveMatches.filter((match) => match.found).length}/{decisiveMatches.length} · 全部线索{" "}
          {candidate.matchedClues}/{clues.length} · {candidate.sites} 个来源提到
        </span>
        {candidate.entity && candidate.entity.role !== "competitor" ? (
          <em className="clue-entity-tag">
            {relationName[candidate.entity.role] || candidate.entity.role}
            {candidate.entity.role === "unconfirmed" ? "（没有句子能说明它是什么）" : ""}
          </em>
        ) : null}
      </header>
      <ul className="clue-matches">
        {orderedMatches.map((match) => (
          <li key={match.clueId} data-found={match.found ? "true" : "false"}>
            <span className="clue-match-icon">{match.found ? <Check size={12} /> : <X size={12} />}</span>
            <div>
              <b>{match.clue}</b>
            <em className="clue-match-tag" data-kind={match.decisive ? "decisive" : "ordinary"}>
              {match.decisive ? "决定性线索" : "普通线索"}
            </em>
              {match.found ? (
                <>
                  <p className="clue-evidence">「{match.sentence}」</p>
                  <a href={match.url} target="_blank" rel="noreferrer noopener">
                    <Link2 size={12} /> {match.site || match.title}
                  </a>
                  <span className="clue-from">
                    {match.from === "body" ? "网页正文" : "搜索摘要"}
                    {match.scope === "page" ? " · 同一网页内出现，未同句" : match.scope === "paragraph" ? " · 同段出现" : ""}
                  </span>
                </>
              ) : match.relation === "indirect" ? (
                <>
                  <p className="clue-evidence">「{match.sentence}」</p>
                  <p className="clue-missing">
                    这句在讲别的对象，不能算 {candidate.name} 的证据（未计入）
                  </p>
                </>
              ) : (
                <p className="clue-missing">还没有找到对应证据</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {candidate.pages.length ? (
        <footer>
          {candidate.pages.slice(0, 2).map((page) => (
            <a key={page.url} href={page.url} target="_blank" rel="noreferrer noopener">
              {page.site}
              <ArrowRight size={11} />
            </a>
          ))}
        </footer>
      ) : null}
    </article>
  );
}

/** 供 Case 页判断：这条调查是不是线索调查。 */
export function isClueRun(bundle: TraceBundleView | undefined) {
  return bundle?.case?.mode === "clue";
}

export { client };
