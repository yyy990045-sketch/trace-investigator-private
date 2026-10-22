import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createPlatform } from "./app.ts";
const data = resolve(
  process.env.PLATFORM_DATA_DIR ||
    new URL("../../../data", import.meta.url).pathname,
);
await mkdir(data, { recursive: true });
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
