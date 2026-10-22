import { useState } from "react";
export type Project = {
  id: string;
  name: string;
  slug: string;
  layout: "agent" | "business";
  source: "example" | "configuration";
  modules: string[];
  assets: string[];
  lastOpened?: string;
};
export const moduleOptions = {
  agent: [
    { id: "missions", name: "任务工作区" },
    { id: "resources", name: "资料来源" },
    { id: "notes", name: "任务笔记" },
  ],
  business: [
    { id: "report", name: "成果" },
    { id: "materials", name: "资料对象" },
    { id: "delivery", name: "交付记录" },
  ],
};
const initial: Project[] = [
  {
    id: "agent",
    name: "任务实验室",
    slug: "agent-example",
    layout: "agent",
    source: "example",
    modules: ["missions", "resources", "notes"],
    assets: [],
  },
  {
    id: "business",
    name: "成果工作室",
    slug: "business-example",
    layout: "business",
    source: "example",
    modules: ["report", "materials", "delivery"],
    assets: [],
  },
];
const key = "personal-studio-projects-v2";
function load(): Project[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (
      Array.isArray(value) &&
      value.length &&
      value.every(
        (p) =>
          p &&
          typeof p.id === "string" &&
          typeof p.name === "string" &&
          ["agent", "business"].includes(p.layout) &&
          Array.isArray(p.assets) &&
          p.assets.every((x: unknown) => typeof x === "string") &&
          Array.isArray(p.modules) &&
          p.modules.every((x: unknown) => typeof x === "string"),
      )
    )
      return [
        ...value,
        ...initial.filter((seed) => !value.some((p) => p.id === seed.id)),
      ];
    const legacy = JSON.parse(
      localStorage.getItem("personal-preview-spaces") || "[]",
    );
    return [
      ...initial,
      ...(Array.isArray(legacy)
        ? legacy
            .filter(
              (p) =>
                p &&
                typeof p.name === "string" &&
                ["agent", "business"].includes(p.layout),
            )
            .map((p) => ({
              id: p.id || crypto.randomUUID(),
              name: p.name,
              slug: "new-app",
              layout: p.layout,
              source: "configuration" as const,
              modules: moduleOptions[p.layout as "agent" | "business"].map(
                (m) => m.id,
              ),
              assets: [],
            }))
        : []),
    ];
  } catch {
    return initial;
  }
}
export function useProjectStore() {
  const [projects, setProjects] = useState<Project[]>(load);
  const [selectedId, setSelectedId] = useState(() => {
    try {
      return localStorage.getItem("studio-selected-project") || "agent";
    } catch {
      return "agent";
    }
  });
  const [error, setError] = useState("");
  const save = (next: Project[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setProjects(next);
      setError("");
      return true;
    } catch {
      setError("浏览器无法保存配置，请检查存储权限后重试。");
      return false;
    }
  };
  const select = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem("studio-selected-project", id);
    } catch {
      setError("项目选择未能持久保存。");
    }
  };
  const update = (id: string, patch: Partial<Project>) =>
    save(projects.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  return {
    projects,
    selected: projects.find((p) => p.id === selectedId) || projects[0],
    select,
    save,
    update,
    error,
  };
}
export type ProjectStore = ReturnType<typeof useProjectStore>;
export function projectHref(project: Project, module?: string) {
  const sub =
    module && module !== "missions" && module !== "report" ? `/${module}` : "";
  return `/${project.layout}${sub}?${new URLSearchParams({ project: project.id, space: project.name, ...(project.source === "example" ? { run: "DEMO-20261021-01" } : {}) })}`;
}
export function appCommand(p: Project) {
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  return `npm run create:app -- ${p.layout} ${p.slug} --port 4315 --title ${quote(p.name)}`;
}
