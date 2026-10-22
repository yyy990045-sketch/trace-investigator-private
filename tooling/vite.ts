import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { join } from "node:path";
// All applications use the real API through the same-origin proxy. No local fixture bridge.
export const appConfig = (port: number) => {
  // 只读静态展示构建：资源用相对路径，index.html 放到任意静态目录都能打开。
  const showcase = process.env.TRACE_SHOWCASE === "1";
  const proxy = {
    "/api": {
      target: process.env.PLATFORM_RUNTIME_URL || "http://127.0.0.1:4313",
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api/, ""),
    },
  };
  return defineConfig({
    base: showcase ? "./" : undefined,
    plugins: [react(), tailwindcss()],
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      fs: { allow: [join(import.meta.dirname, "..")] },
      proxy,
    },
    preview: { host: "127.0.0.1", port: port + 100, strictPort: true, proxy },
  });
};
