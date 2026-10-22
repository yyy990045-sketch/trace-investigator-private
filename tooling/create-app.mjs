import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
const [kind, name, ...args] = process.argv.slice(2);
if (
  !["agent", "business"].includes(kind) ||
  !/^[a-z][a-z0-9-]{1,45}$/.test(name || "")
) {
  console.error(
    "Usage: npm run create:app -- agent|business app-name [--port 4314] [--title 名称]",
  );
  process.exit(1);
}
const readArg = (key, fallback) => {
  const i = args.indexOf(key);
  if (i < 0) return fallback;
  if (!args[i + 1]) throw new Error(`Missing ${key}`);
  return args[i + 1];
};
const port = Number(readArg("--port", "4314"));
const title = readArg("--title", name);
const projectId = readArg("--project-id", "");
if (projectId && !/^project_[a-f0-9-]{36}$/.test(projectId))
  throw new Error("Invalid project ID");
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid port");
const root = resolve(import.meta.dirname, "..");
const target = join(root, "apps", name);
if (existsSync(target))
  throw new Error("Application exists; refusing to overwrite");
async function copy(source, dest) {
  await mkdir(dest, { recursive: true });
  for (const item of await readdir(source, { withFileTypes: true })) {
    if (item.name === "node_modules" || item.name === "dist") continue;
    const from = join(source, item.name),
      to = join(dest, item.name);
    if (item.isDirectory()) await copy(from, to);
    else {
      let value = await readFile(from, "utf8");
      value = value
        .replaceAll("__APP_NAME__", name)
        .replaceAll("__APP_TITLE_JSON__", JSON.stringify(title))
        .replaceAll("__APP_PROJECT_JSON__", JSON.stringify(projectId))
        .replaceAll("__APP_PORT__", String(port));
      await writeFile(to, value);
    }
  }
}
await copy(join(root, "templates", `${kind}-app`), target);
const manifest = JSON.parse(
  await readFile(join(target, "package.json"), "utf8"),
);
manifest.name = `@personal/${name}`;
manifest.scripts = {
  dev: "vite",
  build: "vite build",
  preview: "vite preview",
};
await writeFile(
  join(target, "package.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  join(target, "vite.config.ts"),
  `import { appConfig } from '../../tooling/vite';\nexport default appConfig(${port});\n`,
);
const htmlTitle = title
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
await writeFile(
  join(target, "index.html"),
  `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${htmlTitle}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`,
);
console.log(
  JSON.stringify({
    application: target,
    layout: kind,
    port,
    sharedPackagesModified: false,
    next: `npm install && npm run dev --workspace @personal/${name}`,
  }),
);
