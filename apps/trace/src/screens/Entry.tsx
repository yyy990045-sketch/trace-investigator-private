import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, X, Search } from "lucide-react";
import {
  client,
  ensureProject,
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 未拿到可用性前也不允许提交：宁可等一下，也不要发出注定失败的调查。
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
      setError("请先写下要调查的问题。");
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
      setError("至少需要一条可核查事实。");
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
      <header className="trace-masthead">
        <span className="trace-eyebrow">溯证 TRACE · 调查入口</span>
        <h1>要核查哪一句说法？</h1>
        <p className="trace-lede">
          系统会用元宝搜索做多轮真实检索，逐条比对来源、合并同源转载，最后给你一份带原始链接的调查档案。
          查不清就写查不清，不会替你下结论。
        </p>
      </header>

      {blocked ? (
        <div className="trace-blocker" role="status">
          <strong>联网检索当前不可用，无法开始调查</strong>
          <p>{blockerReason}</p>
          <p>
            配置方法：在项目根目录创建 <code>.env.platform</code>，填入{" "}
            <code>PLATFORM_WSA_API_KEY=sk-...</code>（腾讯云 → 元宝搜索 → 概览 → 服务 API KEY
            方式创建），然后重启 Runtime。密钥只保存在服务端。
          </p>
        </div>
      ) : null}

      <section className="trace-section">
        <div className="trace-field">
          <label className="trace-label" htmlFor="trace-question">
            调查问题
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
        </div>
        <div className="trace-field">
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
      </section>

      <section className="trace-section">
        <div className="trace-section-head">
          <h2>待核查事实与检索式</h2>
          <span>人工确认 · 非 AI 拆解</span>
        </div>
        <p className="trace-lede" style={{ marginTop: -4 }}>
          模型未配置，事实拆解由你确认。一条事实配 1–3 条检索式，系统会逐条发出真实请求。
        </p>
        {facts.map((fact, index) => (
          <div className="trace-fact" key={fact.id}>
            <div className="trace-fact-head">
              <span>事实 {index + 1}</span>
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
              placeholder={claim.trim() || "写成一句可判断真假的事实"}
              value={fact.text}
              onChange={(e) => updateFact(index, { text: e.target.value })}
            />
            <div className="trace-queries">
              {fact.queries.map((query, queryIndex) => (
                <div className="trace-query-row" key={queryIndex}>
                  <input
                    className="trace-input"
                    maxLength={120}
                    placeholder={queryIndex === 0 ? "检索式（搜索框里会真的输入这句话）" : "补充检索式"}
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
            <details className="trace-details">
              <summary>时间与主体限定（可选，用于判断来源是否适用）</summary>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                <input
                  className="trace-input"
                  maxLength={60}
                  placeholder="适用时间，如 2024年 / 最近一年"
                  value={fact.timeScope || ""}
                  onChange={(e) => updateFact(index, { timeScope: e.target.value })}
                />
                <input
                  className="trace-input"
                  maxLength={60}
                  placeholder="主体或地区，如 中国大陆 / 某市教育局"
                  value={fact.subjectScope || ""}
                  onChange={(e) => updateFact(index, { subjectScope: e.target.value })}
                />
              </div>
            </details>
          </div>
        ))}
        {facts.length < MAX_FACTS ? (
          <button
            type="button"
            className="trace-btn trace-btn-ghost"
            style={{ alignSelf: "flex-start" }}
            onClick={() => setFacts((list) => [...list, blankFact(list.length + 1)])}
          >
            <Plus size={14} /> 再加一条事实
          </button>
        ) : null}
      </section>

      {error ? (
        <div className="trace-alert" role="alert">
          {error}
        </div>
      ) : null}

      <div className="trace-action-bar">
        <p className="trace-action-hint">
          开始后会把检索式发送到元宝搜索；来源与结论都保存在本机运行记录里。
        </p>
        <button
          type="button"
          className="trace-btn trace-btn-primary"
          disabled={busy || blocked || question.trim().length < 2}
          onClick={submit}
        >
          <Search size={15} /> {busy ? "正在立案…" : "开始调查"}
        </button>
      </div>

      <section className="trace-section" style={{ marginTop: 8 }}>
        <div className="trace-section-head">
          <h2>最近调查</h2>
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
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
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
            写上第一句要核查的说法，从这里开始。
          </div>
        )}
      </section>
    </div>
  );
}
