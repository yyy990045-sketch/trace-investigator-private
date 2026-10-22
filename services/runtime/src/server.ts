import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createPlatform } from "./app.ts";
// 配置边界：PLATFORM_DATA_DIR 若仍是模板占位值，直接给出可执行的说明，而不是抛出 ENOENT '/absolute'。
const configuredDataDir = process.env.PLATFORM_DATA_DIR?.trim();
if (configuredDataDir && /^\/(absolute|path\/to)(\/|$)/.test(configuredDataDir)) {
  console.error(
    `PLATFORM_DATA_DIR 仍是模板里的占位示例（${configuredDataDir}）。请在 .env.platform 中把它注释掉，或改成真实存在的绝对路径后重启 Runtime。`,
  );
  process.exit(1);
}
const data = resolve(
  configuredDataDir || new URL("../../../data", import.meta.url).pathname,
);
try {
  await mkdir(data, { recursive: true });
} catch (error) {
  console.error(
    `无法创建数据目录 ${data}：${error instanceof Error ? error.message : String(error)}。如果 PLATFORM_DATA_DIR 只是示例占位值，请把它注释掉。`,
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
async function stop() {
  await platform.app.close();
  await unlink(lock).catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
await platform.app.listen({
  host: "127.0.0.1",
  port: Number(process.env.PLATFORM_PORT || 4313),
});
console.log(
  JSON.stringify({
    service: "personal-capability-runtime",
    url: `http://127.0.0.1:${process.env.PLATFORM_PORT || 4313}`,
    pid: process.pid,
    dataDirectory: data,
    modelConfigured: process.env.PLATFORM_MODEL_ENABLED === "true",
  }),
);
