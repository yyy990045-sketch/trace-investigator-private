import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layers3, Folder, History } from "lucide-react";
import {
  BusinessShell,
  type AppModule,
  type ShellConfig,
} from "@personal/app-shell";
import {
  BusinessReportModule,
  BusinessMaterials,
  BusinessDelivery,
} from "@personal/business-ui";
import { EmptyState } from "@personal/ui-core";
import { demoRun } from "@personal/demo-fixture";
import "@personal/ui-core/styles.css";

const title = "模块复用验证";
const config: ShellConfig = {
  name: title,
  subtitle: "独立商业应用",
  mark: "成",
  home: "/deliverables/" + demoRun.id,
  contextLabel: title,
  theme: { accent: "#315f52", accentSoft: "#edf3f0", sidebar: "#f4f6f5" },
  navigation: [
    { to: "/deliverables/" + demoRun.id, label: "成果", icon: Layers3 },
    { to: "/materials", label: "资料对象", icon: Folder },
    { to: "/delivery", label: "交付记录", icon: History },
  ],
};
function Deliverable() {
  const { recordId } = useParams();
  return recordId === demoRun.id ? (
    <BusinessReportModule spaceName={title} run={demoRun} />
  ) : (
    <div className="page">
      <EmptyState error title="未找到成果" detail="没有对应的交付记录。" />
    </div>
  );
}
// Application-owned modules replace the workspace; the shell never imports a report module.
const modules: AppModule[] = [
  {
    id: "deliverables",
    path: "/deliverables/:recordId",
    label: "成果",
    element: <Deliverable />,
  },
  {
    id: "materials",
    path: "/materials",
    label: "资料对象",
    element: <BusinessMaterials run={demoRun} />,
  },
  {
    id: "delivery",
    path: "/delivery",
    label: "交付记录",
    element: <BusinessDelivery />,
  },
];
const queryClient = new QueryClient();
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <BusinessShell config={config}>
        <Routes>
          {modules.map((m) => (
            <Route key={m.id} path={m.path} element={m.element} />
          ))}
          <Route
            path="/"
            element={<Navigate to={"/deliverables/" + demoRun.id} replace />}
          />
          <Route
            path="*"
            element={
              <div className="page">
                <EmptyState
                  title="页面不存在"
                  detail="请从当前应用导航选择模块。"
                />
              </div>
            }
          />
        </Routes>
      </BusinessShell>
    </BrowserRouter>
  </QueryClientProvider>,
);
