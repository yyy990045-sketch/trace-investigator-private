import { spawn } from "node:child_process";
const root = new URL("..", import.meta.url).pathname;
const commands = ["runtime", "dev", "dev:agent", "dev:business"];
const children = commands.map((command) =>
  spawn("npm", ["run", command], { cwd: root, stdio: "inherit" }),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children)
  child.on("exit", (code) => {
    if (!stopping && code) stop();
  });
