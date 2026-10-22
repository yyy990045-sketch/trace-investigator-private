import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { join } from "node:path";
// All applications use the real API through the same-origin proxy. No local fixture bridge.
export const appConfig = (port: number) => {
  const proxy = {
    "/api": {
      target: process.env.PLATFORM_RUNTIME_URL || "http://127.0.0.1:4313",
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api/, ""),
    },
  };
  return defineConfig({
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
