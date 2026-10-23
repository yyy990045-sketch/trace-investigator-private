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

const showcase = import.meta.env.VITE_TRACE_MODE === "showcase";
const Router = showcase ? HashRouter : BrowserRouter;

const config: ShellConfig = {
  name: "溯证 TRACE",
  subtitle: "可复查的证据调查",
  mark: "溯",
  home: "/",
  contextLabel: "溯证 TRACE",
  environment: showcase ? "历史调查记录（只读）" : "本机工作区",
  theme: { accent: "#17577f", accentSoft: "#e7f0f6", sidebar: "#f4f2ec" },
  navigation: [{ to: "/", label: "调查", icon: Search, end: true }],
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

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
