import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
  Link,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Workflow, Library, BookOpen, ArrowRight } from "lucide-react";
import {
  AppShell,
  type AppModule,
  type ShellConfig,
} from "@personal/app-shell";
import { AgentWorkspace } from "@personal/agent-ui";
import { DemoNotice, EmptyState, Button } from "@personal/ui-core";
import { demoRun } from "@personal/demo-fixture";
import "@personal/ui-core/styles.css";

const title = "复用验证空间";
const config: ShellConfig = {
  name: title,
  subtitle: "独立 Agent 示例应用",
  mark: "任",
  home: "/missions/" + demoRun.id,
  contextLabel: title,
  theme: { accent: "#4760ce", accentSoft: "#eef0fd", sidebar: "#f3f5f9" },
  navigation: [
    { to: "/missions/" + demoRun.id, label: "任务工作区", icon: Workflow },
    { to: "/resources", label: "资料来源", icon: Library },
  ],
  footer: {
    title: "独立应用 · 共享底座",
    detail: "应用自有路由、模块和主题",
    href: "/resources",
  },
};
function Resources() {
  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <h1>这次任务，从哪些资料开始？</h1>
          <p className="page-subtitle">
            本页面是 Agent 示例应用自有模块，不属于共享导航或运行引擎。
          </p>
        </div>
      </div>
      <DemoNotice />
      <section className="module-proof">
        <h2>中性示例资料包</h2>
        <ul>
          {demoRun.records.map((r) => (
            <li key={r.id}>
              {r.title} · {r.source}
            </li>
          ))}
        </ul>
        <Button asChild variant="secondary">
          <Link to={"/missions/" + demoRun.id}>
            回到任务路径
            <ArrowRight size={15} />
          </Link>
        </Button>
      </section>
    </div>
  );
}
function Mission() {
  const { runId } = useParams();
  return runId === demoRun.id ? (
    <AgentWorkspace spaceName={title} run={demoRun} />
  ) : (
    <div className="page">
      <EmptyState
        error
        title="未找到任务"
        detail="此独立应用目前仅使用明确标注的演示记录。"
      />
    </div>
  );
}
// Application-owned module registration. Shared packages never import this file.
const modules: AppModule[] = [
  {
    id: "missions",
    path: "/missions/:runId",
    label: "任务工作区",
    element: <Mission />,
  },
  {
    id: "resources",
    path: "/resources",
    label: "资料来源",
    element: <Resources />,
  },
];
const queryClient = new QueryClient();
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AppShell config={config}>
        <Routes>
          {modules.map((m) => (
            <Route key={m.id} path={m.path} element={m.element} />
          ))}
          <Route
            path="/"
            element={<Navigate to={"/missions/" + demoRun.id} replace />}
          />
          <Route
            path="*"
            element={
              <div className="page">
                <EmptyState
                  title="页面不存在"
                  detail="请从本应用导航选择模块。"
                />
              </div>
            }
          />
        </Routes>
      </AppShell>
    </BrowserRouter>
  </QueryClientProvider>,
);
