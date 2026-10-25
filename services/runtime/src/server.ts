import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createPlatform } from "./app.ts";
import { modelConfiguration } from "./providers.ts";
import { registerVisionEndpoints } from "./vision-ocr.ts";
// 配置边界：PLATFORM_DATA_DIR 若仍是模板占位值，告警并回退到默认数据目录，
// 既不静默使用错误路径，也不让一次复制粘贴就把 Runtime 拦在启动之外。
const configuredDataDir = process.env.PLATFORM_DATA_DIR?.trim();
const placeholderDataDir = configuredDataDir && /^\/(absolute|path\/to)(\/|$)/.test(configuredDataDir);
if (placeholderDataDir)
  console.error(
    `提示：PLATFORM_DATA_DIR 仍是模板里的占位示例（${configuredDataDir}），已忽略并使用默认数据目录。要自定义请改成真实绝对路径，或把这行注释掉。`,
  );
const data = resolve(
  configuredDataDir && !placeholderDataDir
    ? configuredDataDir
    : new URL("../../../data", import.meta.url).pathname,
);
try {
  await mkdir(data, { recursive: true });
} catch (error) {
  console.error(
    `无法创建数据目录 ${data}：${error instanceof Error ? error.message : String(error)}。请检查 PLATFORM_DATA_DIR 是否为可写的绝对路径。`,
  );
  process.exit(1);
}
const lock = join(data, "runtime.lock");
try {
  const handle = await open(lock, "wx");
  await handle.writeFile(String(process.pid));
  await handle.close();
} catch (error) {
  let alive = true;
  try {
    const pid = Number(await readFile(lock, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) alive = false;
    else process.kill(pid, 0);
  } catch {
    alive = false;
  }
  if (alive)
    throw new Error(
      "This platform data directory already has a running owner.",
    );
  await unlink(lock).catch(() => {});
  const handle = await open(lock, "wx");
  await handle.writeFile(String(process.pid));
  await handle.close();
}
const platform = await createPlatform({
  dbPath: join(data, "platform.sqlite"),
  artifactRoot: join(data, "artifacts"),
});
registerVisionEndpoints(platform.app, platform.store);
async function stop() {
  await platform.app.close();
  await unlink(lock).catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
// 公网模式监听所有网卡（前面有反向代理与 TLS）；本机模式只监听环回地址。
const publicRuntime = process.env.PLATFORM_PUBLIC === "1";
await platform.app.listen({
  host: publicRuntime ? "0.0.0.0" : "127.0.0.1",
  port: Number(process.env.PLATFORM_PORT || 4313),
});
console.log(
  JSON.stringify({
    service: "personal-capability-runtime",
    url: `http://${publicRuntime ? "0.0.0.0" : "127.0.0.1"}:${process.env.PLATFORM_PORT || 4313}`,
    publicMode: publicRuntime,
    pid: process.pid,
    dataDirectory: data,
    modelConfigured: modelConfiguration().available,
  }),
);
