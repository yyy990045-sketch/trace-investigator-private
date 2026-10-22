import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  Play,
  ShieldCheck,
  CircleAlert,
  ChevronRight,
} from "lucide-react";
import type { RunView, EvidenceItem, RunStep } from "@personal/capability-sdk";
import {
  Badge,
  Button,
  DemoNotice,
  Modal,
  EmptyState,
  TabBar,
  ContentReviewList,
} from "@personal/ui-core";

const stepLabel = (step: RunStep) =>
  step.state === "failed"
    ? "演示失败"
    : step.state === "current"
      ? step.kind === "confirmation"
        ? "待确认"
        : "当前步骤"
      : step.state === "complete"
        ? "示例已处理"
        : "尚未开始";
export function AgentWorkspace({
  run,
  counterpartHref,
  spaceName,
}: {
  run: RunView;
  counterpartHref?: string;
  spaceName?: string;
}) {
  const [stepId, setStep] = useState(
    () =>
      run.steps.find((s) => s.state === "current")?.id ||
      run.steps[0]?.id ||
      "",
  );
  const [stepsOpen, setStepsOpen] = useState(false);
  const [tab, setTab] = useState("overview");
  const tabId = useId();
  const [evidence, setEvidence] = useState<EvidenceItem | null>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const [input, setInput] = useState(run.input);
  const [note, setNote] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  useEffect(() => {
    setStep(
      run.steps.find((s) => s.state === "current")?.id ||
        run.steps[0]?.id ||
        "",
    );
    setInput(run.input);
    setNote("");
  }, [run.id, run.input]);
  const selected = run.steps.find((s) => s.id === stepId) || run.steps[0];
  if (!selected)
    return (
      <div className="page">
        <DemoNotice />
        <EmptyState
          title="暂无处理步骤"
          detail="这份记录没有可显示的步骤，不替换为成功示例。"
        />
      </div>
    );
  const confirmation =
    selected.kind === "confirmation" &&
    selected.state === "current" &&
    !run.steps.some((s) => s.state === "failed");
  return (
    <div
      className={`page agent-page ${confirmation && tab === "overview" ? "has-confirmation" : ""}`}
    >
      <div className="task-header">
        <div>
          <div className="context-line">
            {spaceName || "任务实验室"}
            <span>/</span>当前任务
          </div>
          <h1>{run.agentHeading}</h1>
        </div>
        <div className="task-header-actions">
          <Button variant="secondary" onClick={() => setInputOpen(true)}>
            <FileText size={16} />
            输入资料
          </Button>
          <Button disabled title="运行服务未连接">
            <Play size={15} />
            执行任务
          </Button>
        </div>
      </div>
      <div className="preview-strip">
        <DemoNotice />
        <button className="plain-link" onClick={() => setInfoOpen(true)}>
          任务详情 <ChevronRight size={14} />
        </button>
      </div>
      <div className="agent-workspace">
        <section
          className={`step-panel ${stepsOpen ? "expanded" : ""}`}
          aria-label="执行步骤"
        >
          <button
            className="mobile-step-toggle"
            onClick={() => setStepsOpen(!stepsOpen)}
            aria-expanded={stepsOpen}
            aria-controls="task-step-list"
          >
            全部步骤（{run.steps.length}）<ChevronDown size={16} />
          </button>
          <div className="panel-heading">
            <h2>执行步骤</h2>
            <span>{run.steps.length} 步</span>
          </div>
          <div className="step-list" id="task-step-list">
            {run.steps.map((s, i) => (
              <button
                key={s.id}
                aria-current={s.id === selected.id ? "step" : undefined}
                className={`step-item ${s.id === selected.id ? "selected" : ""} step-${s.state}`}
                onClick={() => {
                  setStep(s.id);
                  setTab("overview");
                  setStepsOpen(false);
                  setNote("");
                }}
              >
                <span className="step-node">
                  {s.state === "complete" ? (
                    <Check size={15} />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                <span className="step-copy">
                  <strong>{s.title}</strong>
                  <small>
                    {s.state === "current"
                      ? "当前阶段"
                      : s.state === "failed"
                        ? "查看异常"
                        : s.state === "pending"
                          ? "等待前序步骤"
                          : "示例内容"}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          <p className="step-footnote">此处仅预览处理路径。</p>
        </section>
        <section className="step-detail">
          <header className="detail-heading">
            <div>
              <span className="section-kicker">
                步骤 {String(run.steps.indexOf(selected) + 1).padStart(2, "0")}{" "}
                / {String(run.steps.length).padStart(2, "0")}
              </span>
              <h2>{selected.title}</h2>
            </div>
            <Badge
              tone={
                selected.state === "failed"
                  ? "red"
                  : selected.state === "current"
                    ? "amber"
                    : "neutral"
              }
            >
              {stepLabel(selected)}
            </Badge>
          </header>
          <TabBar
            id={tabId}
            label="步骤信息"
            value={tab}
            onChange={setTab}
            items={[
              { id: "overview", label: "处理内容" },
              { id: "data", label: "输入与输出" },
              { id: "evidence", label: `证据 (${selected.evidence.length})` },
            ]}
          />
          <div
            className="detail-content"
            role="tabpanel"
            id={`${tabId}-panel`}
            aria-labelledby={`${tabId}-tab-${tab}`}
          >
            {tab === "overview" && (
              <>
                {selected.state === "failed" ? (
                  <div className="failure-message" role="alert">
                    <CircleAlert size={20} />
                    <div>
                      <h3>该步骤未完成</h3>
                      <p>{selected.detail}</p>
                      <p>先检查输入资料。运行服务未连接，当前无法重试。</p>
                      <Button
                        variant="secondary"
                        onClick={() => setInputOpen(true)}
                      >
                        检查输入
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="detail-lead">
                      {confirmation
                        ? `核对以下 ${run.records.length} 条示例记录，决定是否进入报告生成。`
                        : selected.caption}
                    </p>
                    {(confirmation || selected.state === "complete") && (
                      <ContentReviewList
                        items={run.records.map((r) => ({
                          id: r.id,
                          title: r.title,
                          body: r.outcome,
                          context: (
                            <p>
                              {r.source}。资料由{r.owner}负责，计划于{r.due}
                              完成；内容尚未执行核验。
                            </p>
                          ),
                        }))}
                      />
                    )}
                    {selected.state === "pending" && (
                      <div className="pending-note">
                        <FileText size={22} />
                        <h3>尚未生成交付文件</h3>
                        <p>前序步骤确认后才可继续；当前没有真实执行记录。</p>
                        {counterpartHref && (
                          <Link className="plain-link" to={counterpartHref}>
                            查看成果版式 <ArrowRight size={14} />
                          </Link>
                        )}
                      </div>
                    )}
                    {!confirmation && selected.state !== "pending" && (
                      <p className="context-description">{selected.detail}</p>
                    )}
                    {confirmation && (
                      <div className="decision-zone">
                        <div>
                          <ShieldCheck size={17} />
                          <p>预览决定，不会提交真实审批。</p>
                        </div>
                        <div className="decision-actions">
                          <Button
                            onClick={() =>
                              setNote(
                                "已选择通过预览；未提交审批，未生成报告。",
                              )
                            }
                          >
                            预览通过
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              setNote("已选择拒绝预览；未修改真实运行状态。")
                            }
                          >
                            预览拒绝
                          </Button>
                        </div>
                        {note && (
                          <p role="status" className="inline-note">
                            {note}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {tab === "data" && (
              <>
                <h3 className="content-label">输入资料</h3>
                <pre className="input-preview">{input}</pre>
                <h3 className="content-label">结构化示例 · 非执行输出</h3>
                <ContentReviewList
                  items={run.records.map((r) => ({
                    id: r.id,
                    title: r.title,
                    body: r.outcome,
                    context: (
                      <p>
                        {r.source}。{r.owner}负责，计划于{r.due}
                        完成。以上均为示例资料。
                      </p>
                    ),
                  }))}
                />
              </>
            )}
            {tab === "evidence" && (
              <div className="evidence-list">
                {selected.evidence.length ? (
                  selected.evidence.map((id) => {
                    const item = run.evidence.find((e) => e.id === id);
                    return item ? (
                      <button
                        className="evidence-row"
                        key={id}
                        onClick={() => setEvidence(item)}
                      >
                        <FileText size={20} />
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.description}</small>
                        </span>
                        <ArrowRight size={16} />
                      </button>
                    ) : (
                      <p key={id} className="muted-note">
                        证据 {id} 暂不可读；未以其他内容替代。
                      </p>
                    );
                  })
                ) : (
                  <EmptyState
                    title="此步骤暂无证据"
                    detail="真实产物生成后才会记录依据。"
                  />
                )}
              </div>
            )}
            {note && !(confirmation && tab === "overview") && (
              <div role="status" className="inline-note">
                {note}
              </div>
            )}
          </div>
          <div className="detail-bottom">
            <span>运行服务未连接</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setNote("取消操作仅作预览；不存在可取消的真实运行。")
              }
            >
              预览取消
            </Button>
          </div>
        </section>
      </div>
      {counterpartHref && selected.kind !== "delivery" && (
        <div className="workspace-related">
          <Link to={counterpartHref}>
            查看同一资料的成果预览 <ArrowRight size={14} />
          </Link>
        </div>
      )}
      {infoOpen && (
        <Modal title="任务详情" onClose={() => setInfoOpen(false)}>
          <h3>{run.title}</h3>
          <p>
            {run.id} · {run.createdAt}
          </p>
          <p className="muted-note">
            当前步骤规划使用 {selected.capability}
            ，能力尚未接入。模型未配置，没有AI输出。
          </p>
          <p className="muted-note">
            {run.records.length} 条示例记录 · 固定前端示例，不是运行历史。
          </p>
        </Modal>
      )}
      {evidence && (
        <Modal title="查看关联证据" onClose={() => setEvidence(null)}>
          <Badge>示例依据</Badge>
          <h3>{evidence.title}</h3>
          <p className="muted-note">{evidence.source}</p>
          <pre className="evidence-content">{evidence.content}</pre>
        </Modal>
      )}
      {inputOpen && (
        <Modal
          title="任务输入 · 本地预览"
          wide
          onClose={() => setInputOpen(false)}
        >
          <label className="field-label" htmlFor="task-input">
            输入资料
          </label>
          <textarea
            id="task-input"
            rows={7}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <p className="field-help">
            仅保留在当前页面；不会执行处理，也不会更改固定示例输出。
          </p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setInput(run.input)}>
              恢复示例
            </Button>
            <Button
              onClick={() => {
                setInputOpen(false);
                setNote("已保留本地输入；尚未处理或创建真实任务。");
              }}
            >
              保留预览
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export * from './runtime';
