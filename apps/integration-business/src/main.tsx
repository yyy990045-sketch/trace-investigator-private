import { createRoot } from "react-dom/client";
import { useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useParams,
  useNavigate,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Layers3, Folder, Plus } from "lucide-react";
import { BusinessShell, type ShellConfig } from "@personal/app-shell";
import { RuntimeResultWorkspace } from "@personal/business-ui";
import { ProjectExecutionForm } from "@personal/agent-ui";
import { EmptyState, Badge } from "@personal/ui-core";
import {
  createRuntimeClient,
  type DocumentBundle,
} from "@personal/capability-sdk";
import "@personal/ui-core/styles.css";
const title = "资料交付空间";
const projectId = String("project_630caa19-3c00-4f0b-aa3a-698bcc5f9ab9") || import.meta.env.VITE_PROJECT_ID || "";
const client = createRuntimeClient(
  import.meta.env.VITE_RUNTIME_API_URL || "/api",
);
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const config: ShellConfig = {
  name: title,
  subtitle: "连接真实Runtime的商业应用",
  mark: "成",
  home: "/",
  contextLabel: title,
  theme: { accent: "#315f52", accentSoft: "#edf3f0", sidebar: "#f4f6f5" },
  navigation: [
    { to: "/", label: "成果与待办", icon: Layers3, end: true },
    { to: "/materials", label: "资料对象", icon: Folder },
    { to: "/intake", label: "提交资料", icon: Plus },
  ],
};
function Outcomes() {
  const q = useQuery({
    queryKey: ["outcomes", projectId],
    queryFn: () => client.runs(projectId || undefined),
    refetchInterval: 1500,
  });
  return (
    <div className="page business-page">
      <div className="page-title-row">
        <h1>成果与待办</h1>
        <Link className="ui-button button-primary" to="/intake">
          提交资料
        </Link>
      </div>
      {q.isError ? (
        <p role="alert">{q.error.message}</p>
      ) : q.data?.length ? (
        q.data.map((r) => (
          <article className="outcome-entry" key={r.id}>
            <span className="section-kicker">{r.projectName}</span>
            <h2>{r.input.filename}</h2>
            <p>
              {r.status === "completed"
                ? (r.artifacts.length ? "已生成真实交付文件。" : "执行已完成，当前组合未生成交付文件。")
                : r.status === "waiting_approval"
                  ? "处理已完成到确认节点，需要你作出决定。"
                  : r.error?.message || "本次任务尚未形成交付。"}
            </p>
            <Link className="plain-link" to={"/deliverables/" + r.id}>
              {r.status === "waiting_approval"
                ? "审阅这次成果"
                : "打开运行成果"}
            </Link>
          </article>
        ))
      ) : (
        <EmptyState
          title="尚无实际成果"
          detail="提交资料并完成真实处理后，成果会出现在这里。"
        />
      )}
    </div>
  );
}
function Intake() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["projects"], queryFn: client.projects });
  const [selected, setSelected] = useState(projectId);
  const p = q.data?.find((p) => p.id === selected);
  return (
    <div className="page business-page">
      <div className="page-title-row">
        <h1>提交资料</h1>
      </div>
      {q.isError && <p role="alert">{q.error.message}</p>}
      <label className="field-label" htmlFor="business-project">
        使用的项目流程
      </label>
      <select
        id="business-project"
        value={selected}
        disabled={!!projectId}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">选择真实项目</option>
        {q.data
          ?.filter((p) => !projectId || p.id === projectId)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      {p && (
        <ProjectExecutionForm
          key={p.id}
          project={p}
          client={client}
          onCreated={(r) => nav("/deliverables/" + r.id)}
        />
      )}
    </div>
  );
}
function Deliverable() {
  const { runId = "" } = useParams(),
    cache = useQueryClient();
  const q = useQuery({
    queryKey: ["run", runId],
    queryFn: () => client.run(runId),
    refetchInterval: (query) =>
      ["queued", "running", "waiting_approval", "cancel_requested"].includes(
        query.state.data?.status || "",
      )
        ? 700
        : false,
  });
  if (q.isError)
    return (
      <div className="page">
        <p role="alert">{q.error.message}</p>
      </div>
    );
  if (!q.data)
    return (
      <div className="page" aria-busy="true">
        正在读取成果…
      </div>
    );
  if (projectId && q.data.projectId !== projectId)
    return (
      <div className="page">
        <EmptyState
          error
          title="不属于当前应用项目"
          detail="此应用固定使用生成时选择的项目。"
        />
      </div>
    );
  return (
    <RuntimeResultWorkspace
      run={q.data}
      client={client}
      onUpdate={(r) => cache.setQueryData(["run", r.id], r)}
    />
  );
}
function Materials() {
  const q = useQuery({
    queryKey: ["materials", projectId],
    queryFn: () => client.runs(projectId || undefined),
  });
  return (
    <div className="page business-page">
      <div className="page-title-row">
        <h1>实际资料对象</h1>
      </div>
      {q.isLoading ? <p aria-busy="true">正在读取实际资料…</p> : q.isError ? (
        <p role="alert">{q.error.message}</p>
      ) : q.data?.length ? (
        <div className="actual-documents">
          {q.data.map((r) => (
            <details key={r.id}>
              <summary>
                {r.input.filename} · {r.projectName}
              </summary>
              {((r.steps.find((s) => s.capabilityId === "documents.parse")?.output as DocumentBundle | undefined)?.documents || []).map((d) => <article key={d.id}><p>{d.text}</p><p className="field-help">来源：{d.source}</p></article>)}
              {!r.steps.some((s) => s.capabilityId === "documents.parse" && s.status === "completed") && <p>尚无解析结果，请查看本次处理与错误。</p>}
              <details><summary>查看原始输入</summary><pre className="input-preview">{r.input.text}</pre></details>
              <Link className="plain-link" to={"/deliverables/" + r.id}>
                查看本次处理与交付
              </Link>
            </details>
          ))}
        </div>
      ) : (
        <EmptyState
          title="尚无资料对象"
          detail="资料来自实际提交的任务，不读取历史客户文件。"
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}>
    <BrowserRouter>
      <BusinessShell config={config}>
        <Routes>
          <Route path="/" element={<Outcomes />} />
          <Route path="/intake" element={<Intake />} />
          <Route path="/deliverables/:runId" element={<Deliverable />} />
          <Route path="/materials" element={<Materials />} />
          <Route
            path="*"
            element={
              <div className="page">
                <EmptyState
                  title="页面不存在"
                  detail="请从本应用导航打开真实成果。"
                />
              </div>
            }
          />
        </Routes>
      </BusinessShell>
    </BrowserRouter>
  </QueryClientProvider>,
);
