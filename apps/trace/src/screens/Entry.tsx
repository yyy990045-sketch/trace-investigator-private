import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus, Search, X } from "lucide-react";
import {
  client,
  ensureProject,
  sampleCases,
  searchAvailability,
  startInvestigation,
  type FactDraft,
} from "../api";
import { Tag, formatTime } from "../components";

const MAX_FACTS = 6;
const MAX_QUERIES = 6;

function blankFact(index: number): FactDraft {
  return { id: `fact-${index}`, text: "", queries: [""] };
}

export function Entry() {
  const nav = useNavigate();
  const availability = useQuery({ queryKey: ["search-availability"], queryFn: searchAvailability });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => client.runs() });
  const [question, setQuestion] = useState("");
  const [claim, setClaim] = useState("");
  const [facts, setFacts] = useState<FactDraft[]>([blankFact(1)]);
  const [planOpen, setPlanOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = availability.data?.available !== true;
  const blockerReason = availability.isError
    ? (availability.error as Error).message
    : (availability.data?.reason ?? "正在读取检索能力状态…");

  const recent = useMemo(() => {
    const rows = (runs.data || []).filter((run) =>
      run.assembly.some((step) => step.capabilityId === "trace.case.intake"),
    );
    return rows.slice(0, 6);
  }, [runs.data]);

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
    <div className="trace-page">
      <section className="trace-hero">
        <span className="trace-eyebrow">溯证 TRACE · 调查入口</span>
        <h1>把一句说法交给证据去检验</h1>
        <p className="trace-lede">
          系统会用元宝搜索做多轮真实检索，抓取原文，标出支持、反对与无法确认的来源，
          把转载合并成一条证据，最后交给你一份可复查的调查档案。
        </p>

        <div className="trace-hero-form">
          <label className="trace-label" htmlFor="trace-question">
            要调查什么
            <small>{question.trim().length}/500</small>
          </label>
          <textarea
            id="trace-question"
            className="trace-textarea trace-textarea-hero"
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
        </div>

        <div className="trace-scope">
          <div>
            <strong>调查范围</strong>
            <p>公开网页文字线索；不含微信公众号内容，不读登录后数据。</p>
          </div>
          <div>
            <strong>你会拿到</strong>
            <p>结论类型、逐条证据与原文摘录、来源矛盾、尚未解决的问题、可下载档案。</p>
          </div>
          <div>
            <strong>谁下结论</strong>
            <p>规则负责比对，你负责确认。事实由你确认，系统不假装 AI 已替你拆解。</p>
          </div>
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

        <div className="trace-action-bar">
          <p className="trace-action-hint">开始后会把检索式发送到元宝搜索，来源与结论保存在本机运行记录里。</p>
          <button
            type="button"
            className="trace-btn trace-btn-primary"
            disabled={busy || blocked || question.trim().length < 2}
            onClick={submit}
          >
            <Search size={15} /> {busy ? "正在立案…" : "开始调查"}
          </button>
        </div>
      </section>

      <section className="trace-samples">
        <div className="trace-section-head">
          <h2>三个真实案例</h2>
          <span>点击带入，也可以完全自己提问</span>
        </div>
        <div className="trace-sample-list">
          {sampleCases.map((sample, index) => (
            <button
              type="button"
              className="trace-sample"
              key={sample.id}
              onClick={() => applySample(index)}
            >
              <span className="trace-sample-tag">{sample.tag}</span>
              <span className="trace-sample-question">{sample.question}</span>
              <span className="trace-sample-note">{sample.note}</span>
              <span className="trace-sample-cta">
                带入这个问题 <ArrowRight size={13} />
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="trace-plan">
        <button
          type="button"
          className="trace-plan-toggle"
          onClick={() => setPlanOpen((open) => !open)}
          aria-expanded={planOpen}
        >
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
                          onClick={() =>
                            updateFact(index, { queries: fact.queries.filter((_, j) => j !== queryIndex) })
                          }
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

      {error ? (
        <div className="trace-alert" role="alert">
          {error}
        </div>
      ) : null}

      <section className="trace-recent-block">
        <div className="trace-section-head">
          <h2>最近的调查</h2>
          <span>{runs.data ? `${recent.length} 条本机记录` : "读取中"}</span>
        </div>
        {runs.isError ? (
          <div className="trace-alert">{(runs.error as Error).message}</div>
        ) : recent.length ? (
          <div className="trace-recent">
            {recent.map((run) => {
              const claimText =
                (run.steps.find((s) => s.capabilityId === "trace.case.intake")?.output as
                  | { case?: { claim?: string } }
                  | undefined)?.case?.claim || run.input?.text || "（未记录说法）";
              const target = run.status === "completed" ? `/archive/${run.id}` : `/cases/${run.id}`;
              return (
                <div className="trace-recent-item" key={run.id}>
                  <a href={target}>{claimText}</a>
                  <span className="trace-recent-meta">
                    {run.status === "completed" ? (
                      <Tag tone="support">已成档</Tag>
                    ) : run.status === "failed" ? (
                      <Tag tone="oppose">失败</Tag>
                    ) : run.status === "waiting_approval" ? (
                      <Tag tone="pending">待确认</Tag>
                    ) : (
                      <Tag tone="neutral">进行中</Tag>
                    )}
                    <time>{formatTime(run.createdAt)}</time>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="trace-empty">
            还没有调查记录。
            <br />
            写上第一句要核查的说法，或点上面任意一个真实案例。
          </div>
        )}
      </section>
    </div>
  );
}
