import { useEffect, useRef, useState } from "react";
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
import { WorkflowStateEditor, workflowInput, checkExecutionInput, workflowCapabilityId } from "./workflow-input";
import type {
  RuntimeApi,
  RunRecord,
  ProjectRecord,
  DocumentBundle,
  CapabilityInfo,
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
export { CapabilityConfigFields, schemaErrors, withCapability, workflowCapabilityId } from "./workflow-input";
export function ProjectExecutionForm({ project, client, onCreated }: {
  project: ProjectRecord; client: RuntimeApi; onCreated: (run: RunRecord) => void;
}) {
  const hasWorkflow = project.steps.some((s) => s.capabilityId === workflowCapabilityId);
  const [mode, setMode] = useState<"visual" | "file">(hasWorkflow ? "visual" : "file");
  const [text, setText] = useState(""), [filename, setFilename] = useState(hasWorkflow ? "工作流轨迹.json" : "资料.txt");
  const [source, setSource] = useState(""), [note, setNote] = useState("");
  const [states, setStates] = useState<string[]>(["", ""]);
  const scopes = project.steps.find((s) => s.capabilityId === "documents.scope-check")?.config.allowedScopes;
  const allowedScopes = Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === "string") : ["general"];
  const [scope, setScope] = useState(allowedScopes[0] || "general");
  const [authorized, setAuthorized] = useState(false), [modelConsent, setModelConsent] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [caps, setCaps] = useState<CapabilityInfo[]>([]), [catalogError, setCatalogError] = useState("");
  const [readError, setReadError] = useState("");
  const [reading, setReading] = useState(false);
  const fileSelection = useRef(0);
  const stopReading = () => { fileSelection.current++; setReading(false); };
  useEffect(() => {
    let active = true; fileSelection.current++; setReading(false);
    setText(""); setFilename(hasWorkflow ? "工作流轨迹.json" : "资料.txt");
    setMode(hasWorkflow ? "visual" : "file"); setSource(""); setNote("");
    setStates(["", ""]); setScope(allowedScopes[0] || "general");
    setAuthorized(false); setModelConsent(false); setError(""); setReadError(""); setCatalogError(""); setCaps([]);
    if (hasWorkflow) client.catalog().then((data) => { if (active) setCaps(data.capabilities); })
      .catch((err) => { if (active) setCatalogError(err instanceof Error ? err.message : "无法读取输入要求"); });
    return () => { active = false; fileSelection.current++; };
  }, [project.id, client]);
  const model = project.steps.some((s) => s.capabilityId === "model.verify");
  const visual = hasWorkflow && mode === "visual";
  const inputText = visual ? workflowInput(project, states, source, scope, note) : text;
  const issues = checkExecutionInput(filename, inputText, project, caps);
  if (visual && !source.trim()) issues.unshift("请填写这条轨迹的实际资料来源。");
  const waitingForSchema = hasWorkflow && !caps.length && !catalogError;
  return <form className="execution-form" onSubmit={async (e) => {
    e.preventDefault();
    if (issues.length || readError || reading || !authorized || !project.validation.ready || (model && !modelConsent)) return;
    setBusy(true); setError("");
    try { onCreated(await client.execute(project.id, { filename, text: inputText, modelConsent }, project.revision)); }
    catch (err) { setError(err instanceof Error ? err.message : "创建任务失败"); }
    finally { setBusy(false); }
  }}>
    <h2>{hasWorkflow ? "核验工作流轨迹" : "执行资料处理"}</h2>
    {hasWorkflow && <><p className="field-help">填写状态即可生成输入文件。这里只核验你提供的轨迹，不会启动或证明外部任务。</p>
      <fieldset className="input-mode"><legend>输入方式</legend>
        <label><input type="radio" name={"input-mode-" + project.id} checked={mode === "visual"} onChange={() => { stopReading(); setMode("visual"); setReadError(""); }} />填写状态</label>
        <label><input type="radio" name={"input-mode-" + project.id} checked={mode === "file"} onChange={() => { stopReading(); if (mode === "visual") setText(inputText); setMode("file"); }} />上传或粘贴文件</label>
      </fieldset></>}
    <label className="field-label" htmlFor="execution-filename">文件名</label>
    <input id="execution-filename" required maxLength={180} value={filename} onChange={(e) => setFilename(e.target.value)} />
    <p className="field-help">{hasWorkflow ? "文件格式：JSON（.json）。内容需包含 documents 数组；状态选择器会自动生成。" : "文件格式：UTF-8 .txt、.md、.json；不支持PDF、图片或Office。"}</p>
    {visual ? <>
      <WorkflowStateEditor value={states} onChange={setStates} />
      <label className="field-label" htmlFor="workflow-source">资料来源</label>
      <input id="workflow-source" required value={source} onChange={(e) => setSource(e.target.value)} placeholder="例如：本机授权合成轨迹，或实际记录的出处" />
      {allowedScopes.length > 1 && <label className="field-label" htmlFor="workflow-scope">资料范围<select id="workflow-scope" value={scope} onChange={(e) => setScope(e.target.value)}>{allowedScopes.map((s) => <option key={s}>{s}</option>)}</select></label>}
      <label className="field-label" htmlFor="workflow-note">轨迹说明（选填，可用于本地检索）</label>
      <textarea id="workflow-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="可填写这条轨迹的背景和需要核对的问题。" />
      <details className="source-disclosure"><summary>查看将提交的JSON内容</summary><pre className="input-preview">{inputText}</pre></details>
    </> : <>
      <label className="field-label" htmlFor="upload-input">上传有权处理的资料</label>
      <input id="upload-input" type="file" accept=".txt,.md,.json" onChange={async (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        const selection = ++fileSelection.current;
        setReading(true); setAuthorized(false); setError(""); setText(""); setFilename(file.name);
        if (file.size > 262144) { setReadError("文件最大256KB，请选择更小的文件。"); setReading(false); return; }
        try {
          const content = await file.text();
          if (selection === fileSelection.current) { setText(content); setReadError(""); }
        } catch { if (selection === fileSelection.current) setReadError("文件无法读取，请重新选择UTF-8文本文件。"); }
        finally { if (selection === fileSelection.current) setReading(false); }
      }} />
      <label className="field-label" htmlFor="source-text">文件内容</label>
      <textarea id="source-text" value={text} onChange={(e) => { stopReading(); setText(e.target.value); setReadError(""); }} rows={6} required placeholder={hasWorkflow ? "粘贴含 documents 数组的JSON资料；不会把只有 states 的对象当作完整文件。" : "上传后可核对内容，也可以粘贴有权处理的资料。"} />
    </>}
    {waitingForSchema ? <p aria-busy="true" className="field-help">正在读取Runtime输入要求…</p> : catalogError ? <p className="error-text" role="alert">{catalogError}</p> : issues.length > 0 && <ul className="input-issues" aria-label="执行前输入提示">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
    {reading && <p className="field-help" aria-busy="true">正在读取选中的文件，完成前不能执行…</p>}
    {readError && <p role="alert" className="error-text">{readError}</p>}
    <label className="review-checkbox"><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />我有权使用这些资料并在本机处理</label>
    {model && <label className="review-checkbox"><input type="checkbox" checked={modelConsent} onChange={(e) => setModelConsent(e.target.checked)} />允许将本次资料发送至当前平台明确配置的模型</label>}
    {!project.validation.ready && <div className="runtime-issues" role="alert"><strong>当前组合不能执行</strong>{project.validation.issues.map((i, n) => <p key={n}>{i.message}</p>)}</div>}
    {error && <p role="alert" className="inline-note error-note">{error}</p>}
    <div className="execution-submit"><span>先检查文件与结构；转换规则由Runtime核验。</span><Button type="submit" disabled={busy || !authorized || issues.length > 0 || !!readError || reading || !!catalogError || waitingForSchema || !project.validation.ready || (model && !modelConsent)}>{busy ? "正在创建任务…" : "创建并执行真实任务"}</Button></div>
  </form>;
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
