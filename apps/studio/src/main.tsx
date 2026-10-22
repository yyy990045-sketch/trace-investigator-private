import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AppShell, BusinessShell, type ShellConfig } from "@personal/app-shell";
import { Button, Badge, Modal, EmptyState } from "@personal/ui-core";
import {
  RuntimeAgentWorkspace,
  ProjectExecutionForm,
  runLabels,
} from "@personal/agent-ui";
import { RuntimeResultWorkspace } from "@personal/business-ui";
import {
  createRuntimeClient,
  standardAssembly,
  standardPermissions,
  type ProjectDraft,
  type AssemblyStep,
  type ProjectRecord,
  type CapabilityInfo,
  type RunRecord,
} from "@personal/capability-sdk";
import {
  LayoutDashboard,
  FolderOpen,
  Boxes,
  History,
  Workflow,
  Layers3,
  Plus,
  ArrowRight,
  Search,
} from "lucide-react";
import "@personal/ui-core/styles.css";
const client = createRuntimeClient(
  import.meta.env.VITE_RUNTIME_API_URL || "/api",
);
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const statusName: Record<string, string> = {
  verified: "已真实执行验收",
  ready_unverified: "可测试 · 尚未验收",
  registered_missing_dependencies: "缺少依赖，不能执行",
  disabled: "已禁用",
};
const useCatalog = () =>
  useQuery({
    queryKey: ["catalog"],
    queryFn: client.catalog,
    refetchInterval: 5000,
  });
function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <EmptyState
      error
      title="无法读取运行服务"
      detail={
        error instanceof Error
          ? error.message
          : "运行服务不可用，未用演示数据替代。"
      }
      action={retry && <Button onClick={retry}>重试连接</Button>}
    />
  );
}
function Home() {
  const projects = useQuery({
      queryKey: ["projects"],
      queryFn: client.projects,
    }),
    runs = useQuery({
      queryKey: ["runs"],
      queryFn: () => client.runs(),
      refetchInterval: 2000,
    });
  const catalog = useCatalog();
  const loc = useLocation();
  const [capQuery, setCapQuery] = useState("");
  const [selectedCap, setSelectedCap] = useState<CapabilityInfo | null>(null);
  const [rememberedProject, setRememberedProject] = useState(() => {
    try { return localStorage.getItem("platform:active-project") || ""; } catch { return ""; }
  });
  const recentProjectTime = (id: string) => runs.data?.find((r) => r.projectId === id)?.createdAt || "";
  const orderedProjects = projects.data?.toSorted((a, b) => recentProjectTime(b.id).localeCompare(recentProjectTime(a.id)));
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [layout, setLayout] = useState<"agent" | "business">("agent"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const projectId = new URLSearchParams(loc.search).get("project") || rememberedProject;
  const current = orderedProjects?.find((p) => p.id === projectId) || orderedProjects?.[0];
  useEffect(() => {
    if (!current?.id) return;
    setRememberedProject(current.id);
    try { localStorage.setItem("platform:active-project", current.id); } catch { /* URL remains the fallback. */ }
  }, [current?.id]);
  const projectRuns = runs.data?.filter((r) => r.projectId === current?.id) || [];
  const layoutRoute = current?.layout === "business" ? "/business" : "/agent";
  return (
    <div className="page real-studio">
      <div className="page-title-row project-toolbar">
        <label className="current-project-picker"><span>当前项目</span>
          <select aria-label="切换当前项目" value={current?.id || ""} onChange={(e) => nav("/?project=" + e.target.value)}>
            {!projects.data?.length && <option value="">暂无项目</option>}
            {orderedProjects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <Button onClick={() => setOpen(true)}><Plus size={16} />新建项目</Button>
      </div>
      {projects.isError ? <ErrorNotice error={projects.error} retry={() => projects.refetch()} />
        : projects.isLoading ? <p aria-busy="true">正在读取SQLite项目记录…</p>
        : current ? <>
          <div className="project-focus-heading"><div><span className="section-kicker">项目工作区</span><h1>{current.name}</h1></div>
            <Link className="plain-link" to={"/projects/" + current.id}>装配与配置 <ArrowRight size={14} /></Link>
          </div>
          {!current.validation.ready && <p className="runtime-issues" role="alert">{current.validation.issues[0]?.message}</p>}
          <nav className="workspace-entries" aria-label="当前项目模块">
            {[
              {title:"执行任务", detail:"提交资料，按已保存流程实际处理。", to:"/projects/" + current.id + "#execute"},
              {title:current.layout === "business" ? "成果与待办" : "任务与步骤", detail:"打开此项目的真实运行，处理当前需要确认的事项。", to:layoutRoute + "?project=" + current.id},
              {title:"能力装配", detail:"选择能力、核对来源和权限，保存执行顺序。", to:"/capabilities?project=" + current.id},
            ].map((m) => <Link className="workspace-entry" key={m.title} to={m.to}><span className="entry-content"><strong>{m.title}</strong><p>{m.detail}</p></span><span className="entry-action">打开 <ArrowRight size={14} /></span></Link>)}
          </nav>
          <section className="recent-executions"><div className="section-heading"><h2>最近运行</h2><Link className="plain-link" to={layoutRoute + "?project=" + current.id}>全部记录</Link></div>
            {runs.isError ? <ErrorNotice error={runs.error} retry={() => runs.refetch()} /> : projectRuns.length ? projectRuns.slice(0,3).map((r) => <Link className="runtime-run-link" key={r.id} to={layoutRoute + "?run=" + r.id}><div><strong>{r.input.filename}</strong><small>{new Date(r.createdAt).toLocaleString("zh-CN")} · {r.id}</small></div><Badge tone={r.status === "completed" ? "green" : r.status === "failed" ? "red" : "neutral"}>{runLabels[r.status]}</Badge></Link>) : <p className="muted-note">此项目尚无运行。先提交有权处理的资料。</p>}
          </section>
          <section className="capability-library"><div className="section-heading"><h2>为当前项目查找能力</h2><Link className="plain-link" to={"/capabilities?project=" + current.id}>完整目录 <ArrowRight size={14} /></Link></div>
            <label className="search-field"><Search size={16}/><input aria-label="搜索当前项目能力" value={capQuery} onChange={(e) => setCapQuery(e.target.value)} placeholder="能力名称、Runtime ID或CAP编号" /></label>
            {catalog.isError ? <ErrorNotice error={catalog.error} retry={() => catalog.refetch()}/> : catalog.isLoading ? <p aria-busy="true">正在读取能力…</p> : <div className="candidate-list">{catalog.data?.capabilities.filter((c) => `${c.name} ${c.id} ${c.assets.map((a) => a.assetId).join(" ")}`.toLowerCase().includes(capQuery.toLowerCase())).slice(0,5).map((c) => <button key={c.id} className="capability-choice" onClick={() => setSelectedCap(c)}><span>{c.name}</span><span className="entry-action">选择 <ArrowRight size={14}/></span></button>)}</div>}
          </section>
        </> : <EmptyState title="还没有真实项目" detail="新建项目后，组合和运行记录会保存到SQLite。"/>}
      {selectedCap && <CapabilityDetail cap={selectedCap} targetProjectId={current?.id} onClose={() => setSelectedCap(null)}/>}
      <p className="service-line">
        {catalog.isLoading ? "正在连接本机Runtime" : catalog.data ? "已连接本机Runtime · SQLite持久化" : "Runtime未连接"} ·{" "}
        {catalog.data?.providers.find((p) => p.id === "platform-model")
          ?.available
          ? "平台模型已配置"
          : "模型未配置，AI链路不可用"}
      </p>
      {open && (
        <Modal title="创建真实项目" onClose={() => setOpen(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const p = await client.createProject({
                  name,
                  layout,
                  permissions: standardPermissions,
                  steps: structuredClone(standardAssembly),
                });
                await qc.invalidateQueries({ queryKey: ["projects"] });
                nav("/projects/" + p.id);
                setOpen(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : "创建失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field-label" htmlFor="project-name">
              项目名称
            </label>
            <input
              id="project-name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <label className="field-label" htmlFor="project-layout">
              应用布局
            </label>
            <select
              id="project-layout"
              value={layout}
              onChange={(e) => setLayout(e.target.value as typeof layout)}
            >
              <option value="agent">Agent · 任务执行</option>
              <option value="business">商业产品 · 成果交付</option>
            </select>
            <p className="field-help">
              先保存一条可编辑的规则组合。后续可选择能力、调整步骤和配置，再执行真实任务。
            </p>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? "正在保存…" : "保存真实项目"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function CapabilityDetail({
  cap,
  onClose,
  targetProjectId,
}: {
  targetProjectId?: string;
  cap: CapabilityInfo;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [error, setError] = useState("");
  return (
    <Modal title={cap.name} wide onClose={onClose}>
      <p>{cap.description}</p>
      <p className="field-help">
        {cap.id}@{cap.version} · {statusName[cap.status]}
      </p>
      <p className="field-help">
        {cap.dependencies
          .filter((d) => !d.ready)
          .map((d) => d.reason)
          .join("；")}
      </p>
      {cap.acceptance && (
        <Link
          className="plain-link"
          to={"/agent?run=" + cap.acceptance.runId}
          onClick={onClose}
        >
          打开真实验收运行 {cap.acceptance.runId}
        </Link>
      )}
      <details className="source-disclosure">
        <summary>来源映射与版本证据</summary>
        {cap.assets.length ? (
          cap.assets.map((a) => (
            <div key={a.assetId}>
              <h3>
                {a.assetId} ·{" "}
                {a.relation === "code_adaptation"
                  ? "历史代码适配"
                  : "历史设计参考，新实现"}
              </h3>
              <p>{a.note}</p>
              <p className="field-help">
                {a.adapter} · 登记源{a.registryVersion} · SHA-256{" "}
                {a.registrySha256}
              </p>
              {a.sourceFiles.map((s) => (
                <p className="source-path" key={s.path}>
                  {s.path}
                  <br />
                  提交锚点：{s.commit}
                  <br />
                  当前文件摘要：{s.sha256}
                </p>
              ))}
            </div>
          ))
        ) : (
          <p className="muted-note">本平台新增能力，无历史代码复用声明。</p>
        )}
      </details>
      <details className="source-disclosure">
        <summary>输入输出、配置、权限与副作用</summary>
        <pre className="input-preview">
          {JSON.stringify(
            {
              inputProtocol: cap.inputProtocol,
              outputProtocol: cap.outputProtocol,
              inputSchema: cap.inputSchema,
              outputSchema: cap.outputSchema,
              configSchema: cap.configSchema,
              permissions: cap.permissions,
              effects: cap.effects,
              implementationHash: cap.implementationHash,
            },
            null,
            2,
          )}
        </pre>
      </details>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        {targetProjectId && <Button disabled={!cap.enabled || cap.dependencies.some((d) => !d.ready)} title={cap.dependencies.find((d) => !d.ready)?.reason} onClick={() => { onClose(); nav("/projects/" + targetProjectId + "?add=" + encodeURIComponent(cap.id + "@" + cap.version)); }}>加入当前项目组合</Button>}
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await client.setEnabled(cap.id, cap.version, !cap.enabled);
              await qc.invalidateQueries({ queryKey: ["catalog"] });
              await qc.invalidateQueries({ queryKey: ["projects"] });
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "更新失败");
            }
          }}
        >
          {cap.enabled ? "禁用此能力版本" : "启用此能力版本"}
        </Button>
      </div>
    </Modal>
  );
}
function CatalogPage() {
  const location = useLocation();
  const catalog = useCatalog();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects,
  });
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<CapabilityInfo | null>(null),
    [pid, setPid] = useState(new URLSearchParams(location.search).get("project") || "");
  const nav = useNavigate();
  const lower = query.toLowerCase();
  const caps = catalog.data?.capabilities.filter((c) =>
    `${c.name} ${c.id} ${c.assets.map((a) => a.assetId).join(" ")}`
      .toLowerCase()
      .includes(lower),
  );
  return (
    <div className="page">
      <div className="page-title-row">
        <h1>能力与来源</h1>
        <Badge>Runtime实际注册</Badge>
      </div>
      {catalog.isError ? (
        <ErrorNotice error={catalog.error} retry={() => catalog.refetch()} />
      ) : (
        <>
          <div className="library-controls">
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="检索能力"
                placeholder="能力名称、Runtime ID或历史CAP编号"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="project-picker">
              装配到
              <select
                aria-label="目标项目"
                value={pid}
                onChange={(e) => setPid(e.target.value)}
              >
                <option value="">选择真实项目</option>
                {projects.data?.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="real-capability-list">
            {caps?.map((c) => (
              <article key={c.id + "@" + c.version}>
                <div>
                  <span className="section-kicker">
                    {c.assets.map((a) => a.assetId).join(" / ") || "平台新增"} ·{" "}
                    {c.id}@{c.version}
                  </span>
                  <button
                    className="capability-title"
                    onClick={() => setSelected(c)}
                  >
                    {c.name}
                  </button>
                  <p>{c.description}</p>
                  <p
                    className={
                      c.status === "registered_missing_dependencies"
                        ? "error-text"
                        : "field-help"
                    }
                  >
                    {statusName[c.status]}
                    {c.dependencies
                      .filter((d) => !d.ready)
                      .map((d) => " · " + d.reason)
                      .join("")}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={
                    !pid ||
                    !c.enabled ||
                    c.status === "registered_missing_dependencies"
                  }
                  title={
                    !pid
                      ? "先选择目标项目"
                      : c.dependencies.find((d) => !d.ready)?.reason
                  }
                  onClick={() =>
                    nav(
                      "/projects/" +
                        pid +
                        "?add=" +
                        encodeURIComponent(c.id + "@" + c.version),
                    )
                  }
                >
                  加入组合
                </Button>
              </article>
            ))}
          </div>
          <section className="unconnected-assets">
            <h2>尚未形成运行能力的历史资产</h2>
            {catalog.data?.assets
              .filter(
                (a) =>
                  !a.runtimeCapabilities.length &&
                  `${a.id} ${a.name}`.toLowerCase().includes(lower),
              )
              .map((a) => (
                <details key={a.id}>
                  <summary>
                    {a.id} · {a.name}
                  </summary>
                  <p className="muted-note">
                    只有历史源码登记，尚未适配或接入。不能执行。来源：
                    {a.sourceProjects.join("、")}
                  </p>
                </details>
              ))}
          </section>
          <p className="field-help">
            正式Portfolio v{catalog.data?.registry.version} · SHA-256{" "}
            {catalog.data?.registry.sha256}
          </p>
        </>
      )}
      {selected && (
        <CapabilityDetail cap={selected} targetProjectId={pid || undefined} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
function StepConfig({
  step,
  index,
  cap,
  onChange,
  onRemove,
  onUp,
  onDown,
  onValidity,
  structureLocked,
}: {
  step: AssemblyStep;
  index: number;
  cap?: CapabilityInfo;
  onChange: (s: AssemblyStep) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
  onValidity: (valid: boolean) => void;
  structureLocked: boolean;
}) {
  const [text, setText] = useState(JSON.stringify(step.config, null, 2)),
    [bad, setBad] = useState(false);
  return (
    <li className="assembly-step">
      <div className="assembly-step-title">
        <span className="row-index">{index + 1}</span>
        <strong>{cap?.name || step.capabilityId}</strong>
        <span className="field-help">v{step.version}</span>
      </div>
      <details>
        <summary>配置此步骤</summary>
        <label className="field-label" htmlFor={"config-" + index}>
          能力配置（JSON）
        </label>
        <textarea
          id={"config-" + index}
          rows={4}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            try {
              const config = JSON.parse(e.target.value);
              if (
                !config ||
                Array.isArray(config) ||
                typeof config !== "object"
              )
                throw new Error();
              onChange({ ...step, config });
              setBad(false);
              onValidity(true);
            } catch {
              setBad(true);
              onValidity(false);
            }
          }}
        />
        {bad && (
          <p role="alert" className="error-text">
            JSON无效；保存和执行已阻止，请修正配置。
          </p>
        )}
        <p className="field-help">
          {cap?.inputProtocol} → {cap?.outputProtocol}
        </p>
        <div className="assembly-step-actions">
          <Button
            size="sm"
            variant="ghost"
            disabled={index === 0 || structureLocked}
            onClick={onUp}
          >
            上移
          </Button>
          <Button size="sm" variant="ghost" disabled={structureLocked} onClick={onDown}>
            下移
          </Button>
          <Button size="sm" variant="danger" disabled={structureLocked} onClick={onRemove}>
            移除步骤
          </Button>
        </div>
      </details>
    </li>
  );
}
function ProjectPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["project", id],
    queryFn: () => client.project(id),
  });
  const catalog = useCatalog();
  useEffect(() => {
    if (location.hash === "#execute" && query.data) requestAnimationFrame(() => document.getElementById("execute")?.scrollIntoView());
  }, [location.hash, query.data?.id]);
  const [draft, setDraft] = useState<ProjectDraft | null>(null),
    [dirty, setDirty] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [adding, setAdding] = useState(""),
    [invalidDrafts, setInvalidDrafts] = useState<Record<number, boolean>>({}),
    [editingRevision, setEditingRevision] = useState(0),
    [editingProjectId, setEditingProjectId] = useState("");
  useEffect(() => {
    if (query.data) {
      if (draft && editingProjectId === id && (dirty || Object.values(invalidDrafts).some(Boolean))) {
        setMessage("项目已有新版本；本地草稿已保留。请刷新页面核对新配置后重新编辑。");
        return;
      }
      setEditingProjectId(id);
      setEditingRevision(query.data.revision);
      const { name, layout, permissions, steps } = query.data;
      setDraft({ name, layout, permissions, steps });
      setDirty(false);
      setInvalidDrafts({});
    }
  }, [query.data?.id, query.data?.revision]);
  useEffect(() => {
    const add = new URLSearchParams(location.search).get("add");
    if (!add || !draft || !catalog.data) return;
    const c = catalog.data.capabilities.find(
      (c) => c.id + "@" + c.version === add,
    );
    if (c) {
      setDraft((d) =>
        d
          ? {
              ...d,
              steps: [
                ...d.steps,
                {
                  capabilityId: c.id,
                  version: c.version,
                  config: structuredClone(c.defaultConfig),
                },
              ],
            }
          : d,
      );
      setDirty(true);
      nav("/projects/" + id, { replace: true });
    }
  }, [location.search, draft?.name, catalog.data?.registry.sha256]);
  if (query.isError)
    return (
      <div className="page">
        <ErrorNotice error={query.error} />
      </div>
    );
  if (!draft || !query.data || editingProjectId !== id)
    return (
      <div className="page" aria-busy="true">
        正在读取真实项目配置…
      </div>
    );
  const project = query.data;
  const change = (next: ProjectDraft) => {
    setDraft(next);
    setDirty(true);
    setMessage("");
  };
  const available = catalog.data?.capabilities || [];
  const hasInvalidDraft = Object.values(invalidDrafts).some(Boolean);
  const save = async () => {
    if (hasInvalidDraft) return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await client.saveProject(id, {
        ...draft,
        revision: editingRevision,
      });
      setEditingRevision(saved.revision);
      setDraft({ name: saved.name, layout: saved.layout, permissions: saved.permissions, steps: saved.steps });
      setInvalidDrafts({});
      qc.setQueryData(["project", id], saved);
      await qc.invalidateQueries({ queryKey: ["projects"] });
      setDirty(false);
      setMessage(
        saved.validation.ready
          ? "组合已保存并通过执行前校验。"
          : "组合已保存，但存在执行阻塞。",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page project-assembly">
      <div className="workspace-heading">
        <div>
          <span className="section-kicker">
            真实项目 · 组合版本 {project.revision}
          </span>
          <h1>{project.name}</h1>
        </div>
        <Button disabled={busy || !dirty || hasInvalidDraft} onClick={save}>
          {busy ? "正在保存…" : "保存组合"}
        </Button>
      </div>
      <section>
        <h2>能力执行顺序</h2>
        <p className="field-help">
          上一步输出传给下一步；版本、Schema、依赖及权限由服务端校验。
        </p>
        <ol className="assembly-steps">
          {draft.steps.map((s, i) => (
            <StepConfig
              key={id + "-" + editingRevision + "-" + s.capabilityId + "-" + i + "-" + s.version}
              index={i}
              structureLocked={hasInvalidDraft}
              onValidity={(valid) => setInvalidDrafts((old) => ({ ...old, [i]: !valid }))}
              step={s}
              cap={available.find(
                (c) => c.id === s.capabilityId && c.version === s.version,
              )}
              onChange={(next) =>
                change({
                  ...draft,
                  steps: draft.steps.map((x, n) => (n === i ? next : x)),
                })
              }
              onRemove={() =>
                change({
                  ...draft,
                  steps: draft.steps.filter((_, n) => n !== i),
                })
              }
              onUp={() => {
                const steps = [...draft.steps];
                [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                change({ ...draft, steps });
              }}
              onDown={() => {
                if (i === draft.steps.length - 1) return;
                const steps = [...draft.steps];
                [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
                change({ ...draft, steps });
              }}
            />
          ))}
        </ol>
        <div className="add-capability">
          <label htmlFor="add-capability">选择已注册能力</label>
          <select
            id="add-capability"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          >
            <option value="">选择能力与版本</option>
            {available.map((c) => (
              <option key={c.id} value={c.id + "@" + c.version}>
                {c.name} @ {c.version}
                {c.status === "registered_missing_dependencies"
                  ? "（缺依赖）"
                  : ""}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            disabled={!adding || hasInvalidDraft}
            onClick={() => {
              const c = available.find(
                (c) => c.id + "@" + c.version === adding,
              );
              if (c)
                change({
                  ...draft,
                  steps: [
                    ...draft.steps,
                    {
                      capabilityId: c.id,
                      version: c.version,
                      config: structuredClone(c.defaultConfig),
                    },
                  ],
                });
              setAdding("");
            }}
          >
            添加步骤
          </Button>
        </div>
        <details className="permission-config">
          <summary>配置项目执行权限</summary>
          <div className="permission-options">
            {[
              ...new Set([
                ...standardPermissions,
                ...available.flatMap((c) => c.permissions),
                "external:write",
              ]),
            ].map((permission) => (
              <label key={permission}>
                <input
                  type="checkbox"
                  checked={draft.permissions.includes(permission)}
                  onChange={(e) =>
                    change({
                      ...draft,
                      permissions: e.target.checked
                        ? [...draft.permissions, permission]
                        : draft.permissions.filter((p) => p !== permission),
                    })
                  }
                />
                {permission}
              </label>
            ))}
          </div>
          <p className="field-help">
            外部写入仍需每次人工确认；模型还需要本次资料授权。
          </p>
        </details>
        {message && (
          <p className="inline-note" role="status">
            {message}
          </p>
        )}
        {project.validation.issues.length > 0 && (
          <div className="runtime-issues" role="alert">
            {project.validation.issues.map((issue, i) => (
              <p key={i}>
                {issue.step !== undefined ? `步骤${issue.step + 1}：` : ""}
                {issue.message}
              </p>
            ))}
          </div>
        )}
      </section>
      <section id="execute" className="run-project-section">
        {dirty || hasInvalidDraft ? (
          <p className="inline-note">
            有未保存或无效的配置。请先修正并保存组合，再执行。
          </p>
        ) : (
          <ProjectExecutionForm
            project={project}
            client={client}
            onCreated={(r) => {
              qc.setQueryData(["run", r.id], r);
              nav("/agent?run=" + r.id);
            }}
          />
        )}
      </section>
      <details className="source-disclosure">
        <summary>生成独立应用并连接此项目</summary>
        <p className="field-help">
          在平台根目录运行，目录名需唯一；生成后由SDK调用本项目的真实API。
        </p>
        <pre className="input-preview">
          npm run create:app -- {project.layout} my-{project.layout}-app --port
          4316 --title '{project.name.replaceAll("'", "")}' --project-id{" "}
          {project.id}
          {"\n"}npm install{"\n"}npm run dev --workspace @personal/my-
          {project.layout}-app
        </pre>
      </details>
    </div>
  );
}
function RunPage({ business = false }: { business?: boolean }) {
  const loc = useLocation(),
    nav = useNavigate(),
    qc = useQueryClient();
  const id = new URLSearchParams(loc.search).get("run") || "";
  const projectFilter = new URLSearchParams(loc.search).get("project") || undefined;
  const q = useQuery({
    queryKey: ["run", id],
    queryFn: () => client.run(id),
    enabled: !!id,
    refetchInterval: (query) =>
      ["queued", "running", "waiting_approval", "cancel_requested"].includes(
        query.state.data?.status || "",
      )
        ? 700
        : false,
  });
  const list = useQuery({
    queryKey: ["runs", projectFilter],
    queryFn: () => client.runs(projectFilter),
    enabled: !id,
    refetchInterval: !id ? 2000 : false,
  });
  const update = (r: RunRecord) => {
    qc.setQueryData(["run", r.id], r);
    if (r.id !== id) nav((business ? "/business" : "/agent") + "?run=" + r.id);
    qc.invalidateQueries({ queryKey: ["runs"] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
  };
  if (!id)
    return (
      <div className="page">
        <div className="page-title-row">
          <h1>{business ? "真实成果" : "任务与运行历史"}</h1>
        </div>
        {list.isError ? (
          <ErrorNotice error={list.error} />
        ) : list.data?.length ? (
          <div className="actual-documents">
            {list.data.map((r) => (
              <Link
                className="runtime-run-link"
                key={r.id}
                to={(business ? "/business" : "/agent") + "?run=" + r.id}
              >
                <div>
                  <strong>
                    {r.projectName} · {r.input.filename}
                  </strong>
                  <small>{r.id}</small>
                </div>
                <Badge>{runLabels[r.status]}</Badge>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="暂无真实记录"
            detail="在项目中上传资料并执行后，再从这里打开。"
            action={
              <Button asChild>
                <Link to="/">进入项目工作区</Link>
              </Button>
            }
          />
        )}
      </div>
    );
  if (q.isError)
    return (
      <div className="page">
        <ErrorNotice error={q.error} retry={() => q.refetch()} />
      </div>
    );
  if (!q.data)
    return (
      <div className="page" aria-busy="true">
        正在读取真实执行记录…
      </div>
    );
  return business ? (
    <RuntimeResultWorkspace
      run={q.data}
      client={client}
      onUpdate={update}
      counterpartHref={"/agent?run=" + id}
    />
  ) : (
    <RuntimeAgentWorkspace
      run={q.data}
      client={client}
      onUpdate={update}
      counterpartHref={"/business?run=" + id}
    />
  );
}
function Studio() {
  const loc = useLocation();
  const business = loc.pathname.startsWith("/business");
  const config: ShellConfig = {
    name: business ? "成果工作区" : "序 · Studio",
    subtitle: business ? "真实业务执行与交付" : "Personal AI Workbench",
    mark: business ? "成" : "序",
    home: "/",
    contextLabel: business ? "实际成果" : "个人工作区",
    pageLabel: loc.pathname.startsWith("/projects/") ? "能力装配与执行" : undefined,
    navigation: business
      ? [
          { to: "/business", label: "成果与交付", icon: Layers3, end: true },
          { to: "/", label: "项目工作区", icon: FolderOpen, end: true },
        ]
      : [
          { to: "/", label: "项目工作区", icon: LayoutDashboard, end: true },
          { to: "/capabilities", label: "能力与来源", icon: Boxes },
          { to: "/agent", label: "任务与运行", icon: Workflow },
          { to: "/business", label: "实际成果", icon: Layers3 },
        ],
    theme: business
      ? { accent: "#315f52", accentSoft: "#edf3f0", sidebar: "#f4f6f5" }
      : undefined,
  };
  const Shell = business ? BusinessShell : AppShell;
  return (
    <Shell config={config}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/spaces" element={<Home />} />
        <Route path="/projects/:id" element={<ProjectPage />} />
        <Route path="/capabilities" element={<CatalogPage />} />
        <Route path="/agent" element={<RunPage />} />
        <Route path="/tasks" element={<RunPage />} />
        <Route path="/history" element={<RunPage />} />
        <Route path="/business" element={<RunPage business />} />
        <Route path="/results" element={<RunPage business />} />
        <Route
          path="*"
          element={
            <div className="page">
              <EmptyState
                title="页面不存在"
                detail="请从项目工作区打开真实任务。"
              />
            </div>
          }
        />
      </Routes>
    </Shell>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Studio />
    </BrowserRouter>
  </QueryClientProvider>,
);
