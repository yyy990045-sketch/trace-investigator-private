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
import { Workflow, Library, Plus } from "lucide-react";
import { AppShell, type ShellConfig } from "@personal/app-shell";
import {
  RuntimeAgentWorkspace,
  ProjectExecutionForm,
  runLabels,
} from "@personal/agent-ui";
import { EmptyState, Badge } from "@personal/ui-core";
import { createRuntimeClient } from "@personal/capability-sdk";
import { SourcesModule } from "./modules/sources";
import "@personal/ui-core/styles.css";
const title = "资料协作台";
const projectId = String("project_ba4abdd4-cf69-4c67-ab8a-19f098ffaa17") || import.meta.env.VITE_PROJECT_ID || "";
const client = createRuntimeClient(
  import.meta.env.VITE_RUNTIME_API_URL || "/api",
);
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const config: ShellConfig = {
  name: title,
  subtitle: "连接真实运行服务的Agent应用",
  mark: "任",
  home: "/",
  contextLabel: title,
  theme: { accent: "#3859bd", accentSoft: "#eef2fc", sidebar: "#f3f5f9" },
  navigation: [
    { to: "/", label: "任务记录", icon: Workflow, end: true },
    { to: "/new", label: "执行新任务", icon: Plus },
    { to: "/sources", label: "实际资料来源", icon: Library },
  ],
};
function Missions() {
  const q = useQuery({
    queryKey: ["runs", projectId],
    queryFn: () => client.runs(projectId || undefined),
    refetchInterval: 1500,
  });
  return (
    <div className="page">
      <div className="page-title-row">
        <h1>任务记录</h1>
        <Link className="ui-button button-primary" to="/new">
          执行新任务
        </Link>
      </div>
      {q.isError ? (
        <p role="alert">{q.error.message}</p>
      ) : q.data?.length ? (
        q.data.map((r) => (
          <Link
            className="runtime-run-link"
            key={r.id}
            to={"/missions/" + r.id}
          >
            <div>
              <strong>
                {r.projectName} · {r.input.filename}
              </strong>
              <small>{r.id}</small>
            </div>
            <Badge>{runLabels[r.status]}</Badge>
          </Link>
        ))
      ) : (
        <EmptyState
          title="尚无真实任务"
          detail="从已保存项目创建任务，记录来自SQLite。"
        />
      )}
    </div>
  );
}
function NewMission() {
  const nav = useNavigate();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects,
  });
  const [selected, setSelected] = useState(projectId);
  const p = projects.data?.find((p) => p.id === selected);
  return (
    <div className="page">
      <div className="page-title-row">
        <h1>执行新任务</h1>
      </div>
      {projects.isError && <p role="alert">{projects.error.message}</p>}
      <label className="field-label" htmlFor="agent-project">
        真实项目
      </label>
      <select
        id="agent-project"
        value={selected}
        disabled={!!projectId}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">选择项目</option>
        {projects.data
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
          onCreated={(r) => nav("/missions/" + r.id)}
        />
      )}
    </div>
  );
}
function Mission() {
  const { runId = "" } = useParams(),
    cache = useQueryClient(),
    nav = useNavigate();
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
        正在读取真实运行…
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
    <RuntimeAgentWorkspace
      run={q.data}
      client={client}
      onUpdate={(r) => {
        cache.setQueryData(["run", r.id], r);
        if (r.id !== runId) nav("/missions/" + r.id);
      }}
    />
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}>
    <BrowserRouter>
      <AppShell config={config}>
        <Routes>
          <Route path="/" element={<Missions />} />
          <Route path="/new" element={<NewMission />} />
          <Route path="/missions/:runId" element={<Mission />} />
          <Route
            path="/sources"
            element={
              <SourcesModule
                client={client}
                projectId={projectId || undefined}
              />
            }
          />
          <Route
            path="*"
            element={
              <div className="page">
                <EmptyState
                  title="页面不存在"
                  detail="请从本应用导航打开真实任务。"
                />
              </div>
            }
          />
        </Routes>
      </AppShell>
    </BrowserRouter>
  </QueryClientProvider>,
);
