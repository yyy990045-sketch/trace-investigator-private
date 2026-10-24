import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { Search } from "lucide-react";
import { BusinessShell, type ShellConfig } from "@personal/app-shell";
import { EmptyState } from "@personal/ui-core";
import "@personal/ui-core/styles.css";
import "./trace.css";
import { Entry } from "./screens/Entry";
import { Case } from "./screens/Case";
import { Archive } from "./screens/Archive";
import { ensureSession } from "./api";

const showcase = import.meta.env.VITE_TRACE_MODE === "showcase";
const Router = showcase ? HashRouter : BrowserRouter;
// 环境标识必须与事实一致：只读展示 / 公网在线调查 / 本机工作区。
const localHost = ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname);
const environmentLabel = showcase
  ? "历史调查记录（只读）"
  : localHost
    ? "本机工作区"
    : "公网在线调查（真实联网）";

const config: ShellConfig = {
  name: "溯证 TRACE",
  subtitle: "可复查的证据调查",
  mark: "溯",
  home: "/",
  contextLabel: "溯证 TRACE",
  environment: environmentLabel,
  theme: { accent: "#17577f", accentSoft: "#e7f0f6", sidebar: "#f4f2ec" },
  navigation: [{ to: "/", label: "调查", icon: Search, end: true }],
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function renderApp() {
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <div className="trace-app">
          <BusinessShell config={config}>
            <Routes>
              <Route path="/" element={<Entry />} />
              <Route path="/cases/:runId" element={<Case />} />
              <Route path="/archive/:runId" element={<Archive />} />
              <Route
                path="*"
                element={
                  <div className="trace-page">
                    <EmptyState
                      title="页面不存在"
                      detail="请从调查入口打开一次真实调查。"
                      action={
                        <a className="trace-btn" href={showcase ? "#/" : "/"}>
                          回到调查入口
                        </a>
                      }
                    />
                  </div>
                }
              />
            </Routes>
          </BusinessShell>
        </div>
      </Router>
    </QueryClientProvider>,
  );
}

function renderBoot(error: Error) {
  createRoot(document.getElementById("root")!).render(
    <div className="trace-app">
      <div className="trace-page">
        <EmptyState
          title="调查服务暂时连不上"
          detail={`${error.message} 页面没有伪造结果：连不上服务时不会展示任何调查结论。`}
          action={
            <button className="trace-btn" onClick={() => window.location.reload()}>
              重新加载
            </button>
          }
        />
      </div>
    </div>,
  );
}

// 只读展示不需要会话；联网版本先领会话再渲染，避免每个页面各自处理 401。
if (showcase) renderApp();
else
  void ensureSession().then(renderApp, (error: unknown) =>
    renderBoot(error instanceof Error ? error : new Error(String(error))),
  );
