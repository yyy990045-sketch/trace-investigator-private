import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  FileText,
  ChevronDown,
  ArrowRight,
  Download,
  Square,
} from "lucide-react";
import { Button, Badge, Modal, EmptyState, TabBar } from "@personal/ui-core";
import "./runtime.css";
import type {
  RuntimeApi,
  RunRecord,
  ProjectRecord,
  DocumentBundle,
} from "@personal/capability-sdk";
export const runLabels: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  waiting_approval: "等待人工确认",
  cancel_requested: "正在取消",
  completed: "已完成",
  failed: "执行失败",
  rejected: "已拒绝",
  canceled: "已取消",
  pending: "尚未执行",
};
export function ProjectExecutionForm({
  project,
  client,
  onCreated,
}: {
  project: ProjectRecord;
  client: RuntimeApi;
  onCreated: (run: RunRecord) => void;
}) {
  const [text, setText] = useState(""),
    [filename, setFilename] = useState("资料.txt"),
    [authorized, setAuthorized] = useState(false),
    [modelConsent, setModelConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const model = project.permissions.includes("data:external");
  return (
    <form
      className="execution-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          onCreated(
            await client.execute(project.id, { filename, text, modelConsent }, project.revision),
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : "创建任务失败");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>执行资料处理</h2>
      <label className="field-label" htmlFor="upload-input">
        上传授权测试资料
      </label>
      <input
        id="upload-input"
        type="file"
        accept=".txt,.md,.json"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 262144) {
            setError("文件最大256KB。");
            return;
          }
          setFilename(file.name);
          setText(await file.text());
          setError("");
        }}
      />
      <p className="field-help">
        支持UTF-8文本、Markdown、JSON；不支持PDF、图片或Office。
      </p>
      <label className="field-label" htmlFor="source-text">
        资料内容
      </label>
      <textarea
        id="source-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        required
        placeholder="上传后可核对内容，也可以粘贴有权处理的资料。"
      />
      <label className="review-checkbox">
        <input
          type="checkbox"
          checked={authorized}
          onChange={(e) => setAuthorized(e.target.checked)}
        />
        我有权使用这些测试资料并在本机处理
      </label>
      {model && (
        <label className="review-checkbox">
          <input
            type="checkbox"
            checked={modelConsent}
            onChange={(e) => setModelConsent(e.target.checked)}
          />
          允许将本次资料发送至当前平台明确配置的模型
        </label>
      )}
      {!project.validation.ready && (
        <div className="runtime-issues" role="alert">
          <strong>当前组合不能执行</strong>
          {project.validation.issues.map((i, n) => (
            <p key={n}>{i.message}</p>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="inline-note error-note">
          {error}
        </p>
      )}
      <div className="execution-submit">
        <span>{filename} · 资料不会自动发送到旧服务</span>
        <Button
          type="submit"
          disabled={
            busy ||
            !authorized ||
            !text.trim() ||
            !project.validation.ready ||
            (model && !modelConsent)
          }
        >
          {busy ? "正在创建任务…" : "创建并执行真实任务"}
        </Button>
      </div>
    </form>
  );
}
export function RuntimeAgentWorkspace({
  run,
  client,
  onUpdate,
  counterpartHref,
}: {
  run: RunRecord;
  client: RuntimeApi;
  onUpdate: (run: RunRecord) => void;
  counterpartHref?: string;
}) {
  const [selectedId, setSelected] = useState(
    () =>
      run.steps.find((s) =>
        ["running", "waiting_approval", "failed", "canceled", "rejected"].includes(s.status),
      )?.id ||
      run.steps[0]?.id ||
      "",
  );
  const [openSteps, setOpenSteps] = useState(false),
    [tab, setTab] = useState("overview"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [actor, setActor] = useState("本人"),
    [inputOpen, setInputOpen] = useState(false);
  useEffect(() => {
    setSelected(
      run.steps.find((s) =>
        ["running", "waiting_approval", "failed", "canceled", "rejected"].includes(s.status),
      )?.id ||
        run.steps.at(-1)?.id ||
        "",
    );
    setError("");
  }, [run.id, run.status]);
  const selected = run.steps.find((s) => s.id === selectedId) || run.steps[0];
  const approval = run.approvals.find(
    (a) => a.stepId === selected?.id && a.status === "pending",
  );
  async function action(fn: () => Promise<RunRecord>) {
    setBusy(true);
    setError("");
    try {
      onUpdate(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  if (!selected)
    return <EmptyState title="没有执行步骤" detail="该任务的步骤记录为空。" />;
  const title =
    run.assembly[selected.position]?.manifest?.name || selected.capabilityId;
  const bundle = (selected.output || selected.input) as DocumentBundle | null;
  return (
    <div className={`page agent-page runtime-agent ${approval && run.status === "waiting_approval" ? "runtime-confirmation" : ""}`}>
      <div className="task-header">
        <div>
          <div className="context-line">{run.id}</div>
          <h1>{run.projectName}</h1>
        </div>
        <Badge
          tone={
            run.status === "failed"
              ? "red"
              : run.status === "completed"
                ? "green"
                : "neutral"
          }
        >
          {runLabels[run.status]}
        </Badge>
      </div>
      <div className="runtime-task-actions">
        <Button variant="secondary" onClick={() => setInputOpen(true)}>
          <FileText size={15} />
          查看实际输入
        </Button>
        {["queued", "running", "waiting_approval", "cancel_requested"].includes(
          run.status,
        ) && (
          <Button
            variant="ghost"
            disabled={busy || run.status === "cancel_requested"}
            onClick={() => action(() => client.cancel(run.id))}
          >
            <Square size={14} />
            取消任务
          </Button>
        )}
        {run.status === "failed" && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => action(() => client.retry(run.id))}
          >
            新建一次重试运行
          </Button>
        )}
      </div>
      {run.error && (selected.error?.code !== run.error.code || tab !== "overview") && (
        <div className="runtime-issues" role="alert">
          <strong>{run.error.code}</strong>
          <p>{run.error.message}</p>
        </div>
      )}
      {error && (
        <p className="inline-note error-note" role="alert">
          {error}
        </p>
      )}
      <div className="agent-workspace">
        <section
          className={`step-panel ${openSteps ? "expanded" : ""}`}
          aria-label="真实执行步骤"
        >
          <button
            className="mobile-step-toggle"
            aria-expanded={openSteps}
            onClick={() => setOpenSteps(!openSteps)}
          >
            全部步骤（{run.steps.length}）<ChevronDown size={16} />
          </button>
          <div className="panel-heading">
            <h2>执行步骤</h2>
            <span>真实记录</span>
          </div>
          <div className="step-list">
            {run.steps.map((s) => (
              <button
                className={`step-item ${s.id === selected.id ? "selected" : ""}`}
                key={s.id}
                aria-current={s.id === selected.id ? "step" : undefined}
                onClick={() => {
                  setSelected(s.id);
                  setOpenSteps(false);
                  setTab("overview");
                }}
              >
                <span className="step-node">{s.position + 1}</span>
                <span className="step-copy">
                  <strong>
                    {run.assembly[s.position]?.manifest?.name || s.capabilityId}
                  </strong>
                  <small>{runLabels[s.status] || s.status}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
        <section className="step-detail">
          <header className="detail-heading">
            <div>
              <span className="section-kicker">
                步骤 {selected.position + 1} · 尝试 {selected.attempts} 次
                {selected.durationMs !== null
                  ? ` · ${selected.durationMs}ms`
                  : ""}
              </span>
              <h2>{title}</h2>
            </div>
            <Badge
              tone={
                selected.status === "failed"
                  ? "red"
                  : selected.status === "completed"
                    ? "green"
                    : "neutral"
              }
            >
              {runLabels[selected.status] || selected.status}
            </Badge>
          </header>
          <TabBar
            id={"runtime-" + selected.id}
            label="实际步骤信息"
            value={tab}
            onChange={setTab}
            items={[
              { id: "overview", label: "处理结果" },
              { id: "data", label: "输入与输出" },
              { id: "evidence", label: "证据记录" },
            ]}
          />
          <div
            className="detail-content"
            role="tabpanel"
            id={"runtime-" + selected.id + "-panel"}
            aria-labelledby={"runtime-" + selected.id + "-tab-" + tab}
          >
            {tab === "overview" && (
              <>
                {run.status === "completed" && run.artifacts.length > 0 && (
                  <div className="actual-files">
                    {run.artifacts.map((a) => (
                      <a
                        className="ui-button button-secondary"
                        href={client.artifactUrl(run.id, a.id)}
                        key={a.id}
                      >
                        <Download size={15} />
                        {a.filename}
                      </a>
                    ))}
                    {run.steps.some((s) => s.capabilityId === "report.export" && s.status === "completed") &&
                      <a className="ui-button button-secondary" href={client.receiptUrl(run.id)}>最终运行凭证</a>}
                  </div>
                )}
                {approval && run.status === "waiting_approval" && (
                  <div className="decision-zone">
                    <p className="detail-lead">请核对以下实际资料、规则结果与引用；批准后才继续交付。</p>
                    <div className="actual-documents">
                      {bundle?.documents?.map((d) => <details key={d.id}><summary>{d.source}</summary><p>{d.text}</p></details>)}
                    </div>
                    <label className="field-label" htmlFor="approval-actor">
                      确认人
                    </label>
                    <input
                      id="approval-actor"
                      value={actor}
                      onChange={(e) => setActor(e.target.value)}
                      maxLength={80}
                    />
                    <p className="field-help">
                      决定绑定本次输入摘要，批准才会继续执行。
                      {run.assembly[
                        selected.position
                      ]?.manifest?.effects.includes("external_write")
                        ? "此步骤声明了外部写入副作用。"
                        : ""}
                    </p>
                    <div className="decision-actions">
                      <Button
                        disabled={busy || !actor.trim()}
                        onClick={() =>
                          action(() =>
                            client.decide(
                              run.id,
                              approval.id,
                              "approve",
                              actor,
                            ),
                          )
                        }
                      >
                        批准并继续
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy || !actor.trim()}
                        onClick={() =>
                          action(() =>
                            client.decide(run.id, approval.id, "reject", actor),
                          )
                        }
                      >
                        拒绝任务
                      </Button>
                    </div>
                  </div>
                )}
                {selected.error ? (
                  <div role="alert" className="runtime-issues">
                    <strong>{selected.error.code}</strong>
                    <p>{selected.error.message}</p>
                    <p>
                      检查输入、项目配置或依赖后再创建新的运行，旧记录会保留。
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="detail-lead">
                      {selected.status === "waiting_approval"
                        ? "核对本次真实处理内容后决定是否继续。"
                        : selected.status === "completed"
                          ? "该能力已实际执行，输出和证据保存在本次运行中。"
                          : selected.status === "pending"
                            ? "尚未执行，不显示预制结果。"
                            : selected.status === "canceled" ? "该步骤已取消，没有生成执行结果。" : selected.status === "rejected" ? "人工已拒绝继续执行。" : "正在执行当前能力。"}
                    </p>
                    {bundle?.checks && (
                      <ul className="actual-checks">
                        {bundle.checks.map((c) => (
                          <li key={c.name}>
                            <strong>
                              {c.name} · {c.status === "not_evaluated" ? "未核验" : c.passed ? "通过" : "需处理"}
                            </strong>
                            <p>{c.detail}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    {bundle?.documents && !approval && (
                      <div className="actual-documents">
                        {bundle.documents.map((d) => (
                          <details key={d.id}>
                            <summary>
                              {d.id} · {d.source}
                            </summary>
                            <p>{d.text}</p>
                          </details>
                        ))}
                      </div>
                    )}
                  </>
                )}

              </>
            )}
            {tab === "data" && (
              <>
                <h3>实际输入</h3>
                <pre className="input-preview">
                  {JSON.stringify(selected.input, null, 2)}
                </pre>
                <h3>实际输出</h3>
                <pre className="input-preview">
                  {selected.output
                    ? JSON.stringify(selected.output, null, 2)
                    : "尚无执行输出"}
                </pre>
              </>
            )}
            {tab === "evidence" && (
              <div className="actual-documents">
                {run.evidence
                  .filter((e) => e.stepId === selected.id)
                  .map((e) => (
                    <details key={e.id}>
                      <summary>{e.kind}</summary>
                      <p>SHA-256 {e.sha256}</p>
                      <pre className="input-preview">
                        {JSON.stringify(e.data, null, 2)}
                      </pre>
                    </details>
                  ))}
                {!run.evidence.some((e) => e.stepId === selected.id) && (
                  <p className="muted-note">此步骤尚无证据记录。</p>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
      <div className="workspace-related">
        {counterpartHref && (
          <Link to={counterpartHref}>
            查看这次运行的成果 <ArrowRight size={14} />
          </Link>
        )}
      </div>
      {inputOpen && (
        <Modal title="任务实际输入" wide onClose={() => setInputOpen(false)}>
          <h3>{run.input.filename}</h3>
          <pre className="input-preview">{run.input.text}</pre>
          <p className="muted-note">
            项目组合版本：{run.projectRevision}。
            {run.input.modelConsent
              ? "本次已授权平台模型使用资料。"
              : "本次未授权外发模型资料。"}
          </p>
        </Modal>
      )}
    </div>
  );
}
