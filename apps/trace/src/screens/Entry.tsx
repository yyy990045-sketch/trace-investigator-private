import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileSearch, Link2, Plus, Search, ShieldQuestion, X } from "lucide-react";
import {
  SHOWCASE,
  bundleOf,
  client,
  digestOf,
  ensureProject,
  outcomeText,
  sampleCases,
  searchAvailability,
  showcaseCases,
  startInvestigation,
  stepOf,
  type CaseDigest,
  type FactDraft,
} from "../api";
import { Tag, caseHref, formatTime } from "../components";

const MAX_FACTS = 6;
const MAX_QUERIES = 6;

function blankFact(index: number): FactDraft {
  return { id: `fact-${index}`, text: "", queries: [""] };
}

/**
 * 首页需要的数据：三个案例 + 本机历史调查。
 * 公网版直接用导出的历史记录；本机版先列运行再逐个取详情——
 * 列表接口不带证据链，只有详情里才有重算后的结论与追问、修正记录。
 */
function useDigests() {
  const local = useQuery({
    queryKey: ["home-digests"],
    enabled: !SHOWCASE,
    queryFn: async () => {
      const runs = await client.runs();
      const completed = runs.filter(
        (run) => run.status === "completed" && run.assembly.some((step) => step.capabilityId === "trace.case.intake"),
      );
      const details = await Promise.all(completed.slice(0, 8).map((run) => client.run(run.id)));
      return details.map((run) => ({ digest: digestOf(run), run }));
    },
  });

  return useMemo(() => {
    const rows = SHOWCASE
      ? showcaseCases().map((item) => ({ digest: digestOf(item.run), run: item.run }))
      : local.data || [];
    const pick = (keys: string[]) => rows.find((row) => keys.some((key) => row.digest.claim.includes(key))) || null;
    return {
      rows,
      A: pick(["个人信息保护法", "民法典"]),
      B: pick(["新能源汽车", "产量"]),
      C: pick(["氢能", "加氢"]),
      loading: !SHOWCASE && local.isLoading,
      error: local.isError ? (local.error as Error).message : null,
    };
  }, [local.data, local.isLoading, local.isError, local.error]);
}

export function Entry() {
  const nav = useNavigate();
  const availability = useQuery({ queryKey: ["search-availability"], queryFn: searchAvailability });
  const digests = useDigests();
  const [question, setQuestion] = useState("");
  const [claim, setClaim] = useState("");
  const [facts, setFacts] = useState<FactDraft[]>([blankFact(1)]);
  const [planOpen, setPlanOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = !SHOWCASE && availability.data?.available !== true;
  const blockerReason = availability.isError
    ? (availability.error as Error).message
    : (availability.data?.reason ?? "正在读取检索能力状态…");

  const hero = digests.C || digests.B || digests.A;

  function applySample(index: number) {
    const sample = sampleCases[index];
    setQuestion(sample.question);
    setClaim(sample.claim);
    setFacts(sample.facts.map((fact) => ({ ...fact, queries: [...fact.queries] })));
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateFact(index: number, patch: Partial<FactDraft>) {
    setFacts((list) => list.map((fact, i) => (i === index ? { ...fact, ...patch } : fact)));
  }

  function updateQuery(factIndex: number, queryIndex: number, value: string) {
    setFacts((list) =>
      list.map((fact, i) =>
        i === factIndex
          ? { ...fact, queries: fact.queries.map((q, j) => (j === queryIndex ? value : q)) }
          : fact,
      ),
    );
  }

  async function submit() {
    setError(null);
    if (SHOWCASE) {
      setError("这是只读的历史调查展示，不带联网检索。需要自己提问并真实联网调查，请在本机运行 Runtime 后打开工作区版本。");
      return;
    }
    const trimmedQuestion = question.trim();
    const effectiveClaim = claim.trim() || trimmedQuestion;
    if (trimmedQuestion.length < 2) {
      setError("先写下一句需要调查的问题。");
      return;
    }
    const prepared = facts
      .map((fact, index) => {
        const text = fact.text.trim() || effectiveClaim;
        const queries = fact.queries.map((q) => q.trim()).filter(Boolean);
        return {
          id: fact.id || `fact-${index + 1}`,
          text,
          queries: queries.length ? queries : [text],
          ...(fact.timeScope ? { timeScope: fact.timeScope } : {}),
          ...(fact.subjectScope ? { subjectScope: fact.subjectScope } : {}),
        };
      })
      .filter((fact) => fact.text.length >= 2);
    if (!prepared.length) {
      setError("至少需要一条可核查的说法。");
      return;
    }
    setBusy(true);
    try {
      const project = await ensureProject();
      const run = await startInvestigation(project, {
        question: trimmedQuestion,
        claim: effectiveClaim,
        facts: prepared,
      });
      nav(`/cases/${run.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="trace-page trace-home">
      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="home-brand">溯证 TRACE</span>
          <h1>
            一句可疑的说法，
            <br />
            值不值得信？
          </h1>
          <p className="home-lede">
            它去真实检索、抓取原文，按同一内容归并来源，逐条说明「支持 / 反对 / 无法确认」的理由。
            证据不够就明确说不下结论，并写出还缺什么。
          </p>

          {SHOWCASE ? (
            <div className="home-actions">
              <a className="trace-btn trace-btn-primary trace-btn-lg" href={hero ? caseHref(hero.digest.runId) : "#/"}>
                查看完整调查 <ArrowRight size={16} />
              </a>
              <span className="home-mode">
                <ShieldQuestion size={14} /> 历史真实调查记录（只读，不联网）
              </span>
            </div>
          ) : (
            <div className="home-form">
              <label className="trace-label" htmlFor="trace-question">
                要调查什么
                <small>{question.trim().length}/500</small>
              </label>
              <textarea
                id="trace-question"
                className="trace-textarea"
                maxLength={500}
                placeholder="例：网传某市2024年新能源汽车产量达到120万辆，是真的吗？"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <label className="trace-label" htmlFor="trace-claim">
                要核查的说法
                <small>留空则与问题相同</small>
              </label>
              <input
                id="trace-claim"
                className="trace-input"
                maxLength={500}
                placeholder="一句可以被证据判断真假的话"
                value={claim}
                onChange={(e) => setClaim(e.target.value)}
              />
              <div className="home-form-actions">
                <button
                  type="button"
                  className="trace-btn trace-btn-primary trace-btn-lg"
                  disabled={busy || blocked || question.trim().length < 2}
                  onClick={submit}
                >
                  <Search size={16} /> {busy ? "正在立案…" : "开始调查"}
                </button>
                <span className="home-form-hint">检索式会发到元宝搜索，来源与结论保存在本机运行记录里。</span>
              </div>
              {blocked ? (
                <div className="trace-blocker" role="status">
                  <strong>联网检索当前不可用，暂时无法开始调查</strong>
                  <p>{blockerReason}</p>
                  <p>
                    在项目根目录的 <code>.env.platform</code> 里填写 <code>PLATFORM_WSA_API_KEY</code>
                    ，重启 Runtime 后即可开始。密钥只保存在服务端。
                  </p>
                </div>
              ) : null}
            </div>
          )}

          <ul className="home-claims">
            <li>
              <Link2 size={15} />
              <span>
                <b>结论必须能点回来源</b>
                每条证据带原始网址与原文摘录，原文取不到就明确标注为「仅搜索摘要」。
              </span>
            </li>
            <li>
              <ShieldQuestion size={15} />
              <span>
                <b>证据不够就不下结论</b>
                只有「≥2 个独立来源 + 至少 1 份原文正文」才给支持结论，否则写清还缺什么。
              </span>
            </li>
            <li>
              <FileSearch size={15} />
              <span>
                <b>改过的地方留痕，出过的档案不改写</b>
                追问与人工修正都会说明结论为什么变，旧版本永远对应旧结论。
              </span>
            </li>
          </ul>
        </div>

        <aside className="home-hero-case" aria-label="主推真实案例">
          {hero ? (
            <HeroCase digest={hero.digest} />
          ) : (
            <div className="home-hero-empty">
              {digests.loading ? "正在读取本机调查记录…" : digests.error || "本机还没有已完成的调查记录。"}
            </div>
          )}
        </aside>
      </section>

      <section className="home-cases">
        <div className="home-section-head">
          <h2>三个真实案例</h2>
          <span>{SHOWCASE ? "点开就是当时的真实调查记录" : "点开看真实调查，或带入表单重新跑一次"}</span>
        </div>
        <div className="home-case-grid">
          <CaseCard
            kind="C"
            digests={digests.C?.digest}
            onApply={SHOWCASE ? undefined : () => applySample(2)}
            title="补充调查后仍证据不足"
            detail="多步调查：查不到就直接说不下结论，并写清还缺什么"
          />
          <CaseCard
            kind="B"
            digests={digests.B?.digest}
            onApply={SHOWCASE ? undefined : () => applySample(1)}
            title="需要跨来源核查"
            detail="同一口径的多个来源如何互相印证，别的指标如何被排除"
          />
          <CaseCard
            kind="A"
            digests={digests.A?.digest}
            onApply={SHOWCASE ? undefined : () => applySample(0)}
            title="有明确原始证据"
            detail="权威原文 + 转载合并，规则判错时人工纠正并留痕"
          />
        </div>
      </section>

      {!SHOWCASE ? (
        <section className="trace-plan home-plan">
          <button type="button" className="trace-plan-toggle" onClick={() => setPlanOpen((open) => !open)} aria-expanded={planOpen}>
            <span>检索计划（{facts.filter((fact) => (fact.text || claim).trim()).length} 条说法 · 通常不用改）</span>
            <span className="trace-mono">{planOpen ? "收起" : "展开调整"}</span>
          </button>
          {planOpen ? (
            <div className="trace-plan-body">
              <p className="trace-hint">
                系统会把每条说法交给元宝搜索。默认用说法本身检索；加上年份、机构名或文件编号通常更准。
              </p>
              {facts.map((fact, index) => (
                <div className="trace-fact-editor" key={fact.id}>
                  <div className="trace-fact-editor-head">
                    <span>说法 {index + 1}</span>
                    {facts.length > 1 ? (
                      <button
                        type="button"
                        className="trace-btn trace-btn-quiet"
                        onClick={() => setFacts((list) => list.filter((_, i) => i !== index))}
                      >
                        <X size={13} /> 移除
                      </button>
                    ) : null}
                  </div>
                  <input
                    className="trace-input"
                    maxLength={400}
                    placeholder={claim.trim() || "写成一句可判断真假的说法"}
                    value={fact.text}
                    onChange={(e) => updateFact(index, { text: e.target.value })}
                  />
                  <div className="trace-queries">
                    {fact.queries.map((query, queryIndex) => (
                      <div className="trace-query-row" key={queryIndex}>
                        <input
                          className="trace-input"
                          maxLength={120}
                          placeholder={queryIndex === 0 ? "检索式" : "补充检索式"}
                          value={query}
                          onChange={(e) => updateQuery(index, queryIndex, e.target.value)}
                        />
                        {fact.queries.length > 1 ? (
                          <button
                            type="button"
                            className="trace-btn trace-btn-quiet"
                            aria-label="删除这条检索式"
                            onClick={() => updateFact(index, { queries: fact.queries.filter((_, j) => j !== queryIndex) })}
                          >
                            <X size={13} />
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {fact.queries.length < MAX_QUERIES ? (
                      <button
                        type="button"
                        className="trace-btn trace-btn-quiet"
                        style={{ alignSelf: "flex-start" }}
                        onClick={() => updateFact(index, { queries: [...fact.queries, ""] })}
                      >
                        <Plus size={13} /> 加一条检索式
                      </button>
                    ) : null}
                  </div>
                  <div className="trace-plan-scope">
                    <input
                      className="trace-input"
                      maxLength={60}
                      placeholder="适用时间（可选），如 2024年"
                      value={fact.timeScope || ""}
                      onChange={(e) => updateFact(index, { timeScope: e.target.value })}
                    />
                    <input
                      className="trace-input"
                      maxLength={60}
                      placeholder="主体或地区（可选），如 中国大陆"
                      value={fact.subjectScope || ""}
                      onChange={(e) => updateFact(index, { subjectScope: e.target.value })}
                    />
                  </div>
                </div>
              ))}
              {facts.length < MAX_FACTS ? (
                <button
                  type="button"
                  className="trace-btn trace-btn-ghost"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => setFacts((list) => [...list, blankFact(list.length + 1)])}
                >
                  <Plus size={14} /> 再加一条说法
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div className="trace-alert" role="alert">
          {error}
        </div>
      ) : null}

      {!SHOWCASE ? (
        <section className="trace-recent-block">
          <div className="trace-section-head">
            <h2>本机历史调查</h2>
            <span>{digests.rows.length ? `${digests.rows.length} 条已完成记录` : "读取中"}</span>
          </div>
          <p className="trace-hint">
            这些是这台机器上真实跑过的调查，打开看到的是当时检索到的来源与结论，不是现在正在联网查询。
          </p>
          {digests.rows.length ? (
            <div className="trace-recent">
              {digests.rows.slice(0, 6).map(({ digest }) => (
                <div className="trace-recent-item" key={digest.runId}>
                  <a href={caseHref(digest.runId)}>{digest.claim}</a>
                  <span className="trace-recent-meta">
                    <Tag tone={digest.outcome === "supported" ? "support" : digest.outcome === "contradicted" ? "oppose" : "unclear"}>
                      {digest.outcome ? outcomeText[digest.outcome] : "记录"}
                    </Tag>
                    {digest.versions > 1 ? <span className="trace-mono">v{digest.versions}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="trace-empty">
              {digests.loading ? "正在读取本机调查记录…" : "还没有已完成的调查。写上第一句要核查的说法，或点上面任意一个真实案例。"}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** 首页主推案例：真实结论 + 多轮调查轨迹 + 还缺什么，全部来自运行记录。 */
function HeroCase({ digest }: { digest: CaseDigest }) {
  const steps = useMemo(() => {
    const list: { label: string; detail: string }[] = [];
    list.push({ label: "检索结果", detail: `${digest.independentSources} 个独立来源 · ${digest.bodyBacked} 份原文正文` });
    for (const query of digest.followupQueries)
      list.push({ label: "追加检索", detail: query });
    for (const correction of digest.corrections)
      list.push({
        label: "人工修正",
        detail: `${correction.impact ? `${relText(correction.impact.sourceBefore)} → ` : ""}${relText(correction.relation)}：${correction.note.slice(0, 28)}`,
      });
    if (digest.versions > 1) list.push({ label: "生成新版", detail: `已交付第 ${digest.versions} 版档案，旧版不改写` });
    return list;
  }, [digest]);

  return (
    <article className="hero-case" data-outcome={digest.outcome || "insufficient"}>
      <header className="hero-case-head">
        <span className="hero-case-tag">主推案例 · C</span>
        <a className="hero-case-link" href={caseHref(digest.runId)}>
          完整调查 <ArrowRight size={14} />
        </a>
      </header>
      <h2 className="hero-case-claim">{digest.claim}</h2>
      <p className="hero-case-verdict">
        <b>{digest.outcome ? outcomeText[digest.outcome] : "记录"}</b>
        <span>{digest.statement.replace(/^就「.*?」而言，/, "")}</span>
      </p>
      <div className="hero-case-counts">
        <span>
          独立来源 <b>{digest.independentSources}</b>
        </span>
        <span>
          原文正文 <b>{digest.bodyBacked}</b>
        </span>
        <span>
          支持 / 无法确认 <b>{digest.factCounts.supports}</b> / <b>{digest.factCounts.unclear}</b>
        </span>
        <span>
          档案 <b>{digest.versions || 1}</b> 版
        </span>
      </div>
      <ol className="hero-case-steps">
        {steps.map((step, index) => (
          <li key={index}>
            <span className="hero-case-step-label">{step.label}</span>
            <span className="hero-case-step-detail">{step.detail}</span>
          </li>
        ))}
      </ol>
      {digest.gaps.length ? (
        <div className="hero-case-gaps">
          <strong>还缺什么</strong>
          <ul>
            {digest.gaps.slice(0, 2).map((gap, index) => (
              <li key={index}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

/** 三个案例用三种不同的信息组织，避免三张一样的卡片。 */
function CaseCard({
  kind,
  digests,
  title,
  detail,
  onApply,
}: {
  kind: "A" | "B" | "C";
  digests?: CaseDigest;
  title: string;
  detail: string;
  onApply?: () => void;
}) {
  const bodyBacked = (digests?.sources || []).filter((source) => source.bodyAvailable).slice(0, 2);
  const supports = (digests?.sources || []).filter((source) => source.relation === "supports").slice(0, 3);
  const correction = digests?.corrections?.[0];

  return (
    <article className="home-case" data-kind={kind}>
      <header>
        <span className="home-case-kind">{kind}</span>
        <h3>{title}</h3>
        <p className="home-case-detail">{detail}</p>
      </header>

      {digests ? (
        <>
          <p className="home-case-claim">{digests.claim}</p>
          <div className="home-case-verdict" data-outcome={digests.outcome || "insufficient"}>
            <b>{digests.outcome ? outcomeText[digests.outcome] : "记录"}</b>
            <span>
              独立来源 {digests.independentSources} · 原文 {digests.bodyBacked}
              {digests.versions > 1 ? ` · ${digests.versions} 版档案` : ""}
            </span>
          </div>

          {kind === "C" ? (
            <ol className="home-case-trace">
              <li>
                <span>来源</span>
                {`${digests.independentSources} 个独立来源 · ${digests.bodyBacked} 份原文`}
              </li>
              {digests.followupQueries.slice(0, 1).map((query, index) => (
                <li key={index}>
                  <span>追问</span>
                  {query}
                </li>
              ))}
              <li>
                <span>修正</span>
                {digests.corrections.length ? `${digests.corrections.length} 条人工修正` : "无人工修正"}
              </li>
              <li>
                <span>结果</span>
                {digests.gaps.length ? `仍是证据不足，缺口 ${digests.gaps.length} 项` : "已形成可交付结论"}
              </li>
            </ol>
          ) : null}

          {kind === "B" ? (
            <ul className="home-case-sources">
              {supports.map((source) => (
                <li key={source.pageId}>
                  <a href={source.url} target="_blank" rel="noreferrer noopener">
                    {source.site}
                  </a>
                  <span>{source.bodyAvailable ? "原文正文已取" : "仅搜索摘要"}</span>
                  <em>{source.title.length > 26 ? `${source.title.slice(0, 26)}…` : source.title}</em>
                </li>
              ))}
            </ul>
          ) : null}

          {kind === "A" ? (
            <div className="home-case-original">
              {bodyBacked.slice(0, 1).map((source) => (
                <blockquote key={source.pageId}>
                  <a href={source.url} target="_blank" rel="noreferrer noopener">
                    {source.title}
                  </a>
                  <p>{(source.bodyExcerpt || source.excerpt || "").slice(0, 88)}…</p>
                </blockquote>
              ))}
              {correction ? (
                <p className="home-case-fix">
                  规则判「{relText(correction.impact?.sourceBefore || "")}」→ 人工改为「{relText(correction.relation)}」
                  {correction.impact ? `，支持来源 ${correction.impact.supportsBefore} → ${correction.impact.supportsAfter} 条` : ""}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="home-case-empty">本机还没有这条案例的记录。</p>
      )}

      <footer className="home-case-actions">
        {digests ? (
          <a className="trace-btn trace-btn-ghost" href={caseHref(digests.runId)}>
            查看调查过程 <ArrowRight size={14} />
          </a>
        ) : null}
        {onApply ? (
          <button type="button" className="trace-link trace-link-button" onClick={onApply}>
            带入表单重新跑
          </button>
        ) : null}
      </footer>
    </article>
  );
}

const REL_TEXT: Record<string, string> = {
  supports: "支持",
  contradicts: "反对",
  unclear: "无法确认",
  irrelevant: "无关",
  mixed: "存在争议",
  none: "无可用来源",
};

function relText(value: string) {
  return REL_TEXT[value] || value || "未记录";
}
