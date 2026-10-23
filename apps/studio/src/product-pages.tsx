/**
 * Studio 里的产品化页面：运行概览、项目独立应用、能力组合、运行反馈与经验。
 * 所有数字与状态都来自 Runtime 真实记录；没有数据时明确说明没有，不填演示值。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, EmptyState } from "@personal/ui-core";
import { runLabels } from "@personal/agent-ui";
import type {
  AssemblyStep,
  CapabilityInfo,
  CompositionRecord,
  ExperienceKind,
  ExperienceRecord,
  FeedbackOutcome,
  ProjectRecord,
  RunRecord,
  TraceExperienceRecord,
} from "@personal/capability-sdk";
import { client, readActor, rememberActor } from "./platform-client";

const msg = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请稍后重试。";

export const experienceKindName: Record<ExperienceKind, string> = {
  verified_solution: "已验证的解决方案",
  unverified_suggestion: "人工记录 · 待验证建议",
  known_failure: "已知失败案例",
};
const kindTone: Record<ExperienceKind, "green" | "amber" | "red"> = {
  verified_solution: "green",
  unverified_suggestion: "amber",
  known_failure: "red",
};
const feedbackName: Record<FeedbackOutcome, string> = {
  worked: "顺利完成",
  partly: "部分完成，有人工修正",
  failed: "没有完成",
};
const formatTime = (value: string) => new Date(value).toLocaleString("zh-CN");

/* ------------------------------------------------------------------ 经验条目 */

export function ExperienceCard({
  experience,
  actions,
}: {
  experience: ExperienceRecord;
  actions?: React.ReactNode;
}) {
  return (
    <article className="experience-card">
      <div className="experience-head">
        <Badge tone={kindTone[experience.kind]}>
          {experienceKindName[experience.kind]}
        </Badge>
        <span className="field-help">
          {experience.projectName || "未关联项目"} ·{" "}
          {formatTime(experience.updatedAt)}
        </span>
      </div>
      <h3>{experience.title}</h3>
      <p className="experience-problem">{experience.problem}</p>
      {experience.resolution && (
        <div className="experience-resolution">
          <span className="section-kicker">做法</span>
          <p>{experience.resolution}</p>
        </div>
      )}
      <p className="field-help">
        {experience.capabilities
          .map((c) => `${c.name}@${c.version}`)
          .join(" · ") || "未关联能力"}
        {experience.tags.length > 0 && ` · 标签：${experience.tags.join("、")}`}
      </p>
      {experience.verifiedRunId && (
        <p className="field-help">
          已由运行 <Link to={"/runs/" + experience.verifiedRunId + "/review"}>
            {experience.verifiedProjectName}
          </Link>{" "}
          验证 · {formatTime(experience.verifiedAt || experience.updatedAt)}
        </p>
      )}
      <div className="experience-actions">
        {experience.runId && (
          <Link className="plain-link" to={"/runs/" + experience.runId + "/review"}>
            查看来源运行
          </Link>
        )}
        {experience.projectId && (
          <Link className="plain-link" to={"/projects/" + experience.projectId}>
            打开项目
          </Link>
        )}
        {actions}
      </div>
    </article>
  );
}

const useExperiences = (query: { q?: string; kind?: string } = {}) =>
  useQuery({
    queryKey: ["experiences", query.q || "", query.kind || ""],
    queryFn: () => client.experiences(query),
  });

/** 能力详情里提示：这个能力已经踩过什么坑。 */
export function CapabilityExperienceHints({ cap }: { cap: CapabilityInfo }) {
  const all = useExperiences();
  const related = (all.data || []).filter((e) =>
    e.capabilities.some(
      (c) => c.capabilityId === cap.id && c.version === cap.version,
    ),
  );
  if (all.isLoading)
    return <p className="field-help" aria-busy="true">正在读取相关经验…</p>;
  if (all.isError) return null;
  return (
    <details className="capability-experience" open={related.length > 0}>
      <summary>
        已记录的运行经验（{related.length}）
        <Link className="plain-link" to="/experiences">
          经验库
        </Link>
      </summary>
      {related.length ? (
        related.slice(0, 4).map((e) => (
          <div key={e.id} className="capability-experience-item">
            <Badge tone={kindTone[e.kind]}>{experienceKindName[e.kind]}</Badge>
            <strong>{e.title}</strong>
            <p>{e.resolution || e.problem}</p>
          </div>
        ))
      ) : (
        <p className="muted-note">
          还没有针对此能力的经验条目。运行后可在“运行反馈”里保存。
        </p>
      )}
    </details>
  );
}

/* ------------------------------------------------------------------ 运行概览 */

export function RuntimeOverview() {
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: client.overview,
    refetchInterval: 8000,
  });
  const [onlyActive, setOnlyActive] = useState(true);
  if (overview.isError)
    return (
      <EmptyState
        error
        title="无法读取平台概览"
        detail={msg(overview.error)}
        action={<Button onClick={() => overview.refetch()}>重试</Button>}
      />
    );
  if (!overview.data || overview.isLoading)
    return <p aria-busy="true">正在按 SQLite 记录汇总项目运行…</p>;
  const data = overview.data;
  const projects = onlyActive
    ? data.projects.filter(
        (p) => p.runs.total > 0 || p.experienceCount > 0 || p.feedbackCount > 0,
      )
    : data.projects;
  const feed = [
    ...data.feedback.recent.map((f) => ({
      key: "f-" + f.id,
      at: f.updatedAt,
      label: "人工修正",
      title: `${f.projectName} · ${feedbackName[f.outcome]}`,
      detail: f.correction || "未填写修正内容",
      to: "/runs/" + f.runId + "/review",
      tone: "blue" as const,
    })),
    ...data.experiences.recent.map((e) => ({
      key: "e-" + e.id,
      at: e.updatedAt,
      label: "经验",
      title: e.title,
      detail: e.resolution || e.problem,
      to: "/experiences",
      tone: kindTone[e.kind],
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);
  return (
    <section className="runtime-overview">
      <div className="section-heading">
        <div>
          <h2>平台运行概览</h2>
          <p>
            项目 {data.projects.length} · 运行 {data.runs.total} · 交付文件{" "}
            {data.artifacts.total} · 经验 {data.experiences.total}
            （{formatTime(data.generatedAt)} 汇总）
          </p>
        </div>
        <label className="overview-filter">
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(e) => setOnlyActive(e.target.checked)}
          />
          只看有运行或经验的项目
        </label>
      </div>
      <ol className="project-run-list">
        {projects.map((p) => (
          <li key={p.id}>
            <div className="project-run-main">
              <Link to={"/?project=" + p.id}>
                <strong>{p.name}</strong>
              </Link>
              <span className="field-help">
                {p.capabilities.length} 项能力 ·{" "}
                {p.ready ? "组合可执行" : `${p.issueCount} 处执行阻塞`} · 修订{" "}
                {p.revision}
              </span>
            </div>
            <div className="project-run-tally">
              <span>成功 {p.runs.completed}</span>
              <span>失败 {p.runs.failed}</span>
              <span>待处理 {p.runs.pending}</span>
              {p.lastRun ? (
                <Badge
                  tone={
                    p.lastRun.status === "completed"
                      ? "green"
                      : p.lastRun.status === "failed"
                        ? "red"
                        : "neutral"
                  }
                >
                  {runLabels[p.lastRun.status] || p.lastRun.status}
                </Badge>
              ) : (
                <span className="field-help">尚未运行</span>
              )}
            </div>
            <div className="project-run-extra">
              {p.feedbackCount > 0 && <span>修正 {p.feedbackCount} 条</span>}
              {p.experienceCount > 0 && <span>经验 {p.experienceCount} 条</span>}
              {p.artifacts > 0 && <span>交付 {p.artifacts} 个</span>}
              {p.application && (
                <a href={p.application.devUrl} target="_blank" rel="noreferrer">
                  独立应用 {p.application.relativePath}:{p.application.port}
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!projects.length && (
        <p className="muted-note">
          还没有带运行记录的项目。先执行一次真实任务，这里才会出现数据。
        </p>
      )}
      <div className="overview-columns">
        <div>
          <h3>可定位的失败</h3>
          {data.runs.failures.length ? (
            <ul className="failure-list">
              {data.runs.failures.slice(0, 5).map((f) => (
                <li key={f.code + f.capability + f.lastRunId}>
                  <Link to={"/runs/" + f.lastRunId + "/review"}>
                    <strong>{f.capability}</strong> · {f.code}
                  </Link>
                  <p>{f.message}</p>
                  <span className="field-help">
                    {f.count} 次 · 最近 {f.projectName} ·{" "}
                    {formatTime(f.at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-note">当前没有任何步骤级失败记录。</p>
          )}
        </div>
        <div>
          <h3>最新修正与经验</h3>
          {feed.length ? (
            <ul className="correction-feed">
              {feed.map((item) => (
                <li key={item.key}>
                  <Badge tone={item.tone}>{item.label}</Badge>
                  <Link to={item.to}>{item.title}</Link>
                  <p>{item.detail}</p>
                  <span className="field-help">{formatTime(item.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-note">
              还没有人工修正或经验记录。运行结束后在“运行反馈”里写入第一条。
            </p>
          )}
        </div>
      </div>
      <div className="overview-delivery">
        <h3>实际存在的交付文件</h3>
        {data.artifacts.recent.length ? (
          <ul className="delivery-list">
            {data.artifacts.recent.map((a) => (
              <li key={a.runId + a.filename}>
                <span>{a.filename}</span>
                <span className="field-help">
                  {a.projectName} · {(a.bytes / 1024).toFixed(1)} KB ·{" "}
                  {formatTime(a.createdAt)}
                </span>
                <Link className="plain-link" to={"/runs/" + a.runId + "/review"}>
                  来源运行
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-note">还没有通过的交付文件。</p>
        )}
      </div>
      <p className="service-line">
        <span>
          {data.models.calls > 0
            ? `模型调用 ${data.models.calls} 次 · 累计耗时 ${Math.round(
                data.models.durationMs / 1000,
              )} 秒 · 费用未统计`
            : data.models.note}
        </span>
      </p>
    </section>
  );
}

/* -------------------------------------------------------------- 独立应用面板 */

export function ApplicationPanel({ project }: { project: ProjectRecord }) {
  const qc = useQueryClient();
  const application = useQuery({
    queryKey: ["application", project.id],
    queryFn: () => client.application(project.id),
  });
  const [name, setName] = useState(
    () => "p-" + project.id.replace("project_", "").slice(0, 6),
  );
  const [port, setPort] = useState(4314);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const manifest = useQuery({
    queryKey: ["application-manifest", project.id],
    queryFn: () => client.applicationManifest(project.id),
    enabled: false,
    retry: false,
  });
  const app = application.data;
  async function generate() {
    setBusy(true);
    setError("");
    setMessage("");
    void manifest.refetch().catch(() => {});
    try {
      const created = await client.createApplication(project.id, {
        appName: name.trim(),
        port,
      });
      qc.setQueryData(["application", project.id], created);
      await qc.invalidateQueries({ queryKey: ["overview"] });
      setMessage(created.message || "应用已生成。");
      setOpen(false);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="application-panel">
      <div className="section-heading">
        <div>
          <h2>独立应用</h2>
          <p>
            用现有应用生成器把此项目生成为独立应用目录，独立端口、独立构建，共用同一套
            Runtime 与组件。
          </p>
        </div>
        <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
          {app ? "重新生成" : "生成独立应用"}
        </Button>
      </div>
      {application.isLoading && <p aria-busy="true">正在读取应用记录…</p>}
      {application.isError && (
        <p className="error-text" role="alert">
          无法读取应用记录：{msg(application.error)}
        </p>
      )}
      {app && (
        <div className="application-record">
          <p>
            <Badge tone={app.status === "generated" ? "green" : "red"}>
              {app.status === "generated" ? "已生成" : "生成失败"}
            </Badge>{" "}
            <strong>{app.relativePath}</strong> · {app.layout} · 端口 {app.port}
          </p>
          {app.message && <p className="field-help">{app.message}</p>}
          {app.status === "generated" && (
            <>
              <pre className="input-preview">
                {app.commands.dev}
                {"\n"}
                {app.commands.build}
              </pre>
              <div className="application-actions">
                <a
                  className="plain-link"
                  href={app.devUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开 {app.devUrl}
                </a>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => manifest.refetch()}
                >
                  检查目录清单
                </Button>
              </div>
              {manifest.isError && (
                <p className="error-text" role="alert">
                  {msg(manifest.error)}
                </p>
              )}
              {manifest.data && (
                <div>
                  <p className="field-help">
                    目录内共 {manifest.data.files.length} 个文件；入口文件
                    {manifest.data.entry.readable ? "可读" : "不可读"}，
                    {manifest.data.entry.bindsProject
                      ? "已绑定此项目 ID。"
                      : "未包含此项目 ID。"}
                  </p>
                  <pre className="input-preview">
                    {manifest.data.files.join("\n")}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {open && (
        <form
          className="application-form"
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
        >
          <label className="field-label" htmlFor="app-name">
            应用目录名（小写字母开头，可含数字和连字符）
          </label>
          <input
            id="app-name"
            required
            pattern="[a-z][a-z0-9-]{1,45}"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="field-label" htmlFor="app-port">
            独立端口
          </label>
          <input
            id="app-port"
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
          <p className="field-help">
            端口必须在 Runtime 已授权的本机来源里（默认 4314、4315、4414、4415、4416）。不在白名单或已被占用时，服务端会直接拒绝，不会静默降级。
          </p>
          <div className="dialog-actions">
            <Button type="submit" disabled={busy}>
              {busy ? "正在生成应用…" : "生成并绑定到此项目"}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="inline-note" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- 能力组合面板 */

export function CompositionPanel({
  project,
  steps,
  permissions,
  dirty,
}: {
  project: ProjectRecord;
  steps: AssemblyStep[];
  permissions: string[];
  dirty: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const compositions = useQuery({
    queryKey: ["compositions"],
    queryFn: client.compositions,
  });
  const [name, setName] = useState(() => project.name + " · 组合");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"append" | "replace">("append");
  async function saveComposition() {
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const created = await client.createComposition({
        name: name.trim(),
        description: description.trim(),
        layout: project.layout,
        permissions,
        steps,
        sourceProjectId: project.id,
        createdBy: readActor() || "本机开发者",
      });
      await qc.invalidateQueries({ queryKey: ["compositions"] });
      setMessage(
        `已保存组合「${created.name}」，包含 ${created.steps.length} 个步骤，可在其他项目里复用。`,
      );
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy("");
    }
  }
  async function applySelected() {
    if (!selected) return;
    setBusy("apply");
    setError("");
    setMessage("");
    try {
      const saved = await client.applyComposition(project.id, {
        compositionId: selected,
        revision: project.revision,
        mode,
      });
      qc.setQueryData(["project", project.id], saved);
      await qc.invalidateQueries({ queryKey: ["projects"] });
      await qc.invalidateQueries({ queryKey: ["compositions"] });
      await qc.invalidateQueries({ queryKey: ["overview"] });
      setMessage(
        `已复用组合，项目现在有 ${saved.steps.length} 个步骤（修订 ${saved.revision}）。`,
      );
      setSelected("");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="composition-panel">
      <div className="section-heading">
        <div>
          <h2>能力组合</h2>
          <p>
            把当前执行顺序存成命名组合，在别的项目里直接复用；组合按输入输出契约与服务端校验保存。
          </p>
        </div>
        <Link className="plain-link" to="/compositions">
          全部组合
        </Link>
      </div>
      <div className="composition-columns">
        <div>
          <h3>保存当前组合</h3>
          <label className="field-label" htmlFor="composition-name">
            组合名称
          </label>
          <input
            id="composition-name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="field-label" htmlFor="composition-desc">
            用途说明（选填）
          </label>
          <textarea
            id="composition-desc"
            rows={2}
            value={description}
            maxLength={400}
            onChange={(e) => setDescription(e.target.value)}
          />
          <p className="field-help">
            保存的是当前已写进编辑器、未保存的 {steps.length} 个步骤配置。
          </p>
          <Button
            disabled={!!busy || !steps.length || !name.trim()}
            onClick={() => void saveComposition()}
          >
            {busy === "save" ? "正在保存…" : "保存为可复用组合"}
          </Button>
        </div>
        <div>
          <h3>复用已保存的组合</h3>
          {compositions.isError ? (
            <p className="error-text" role="alert">
              {msg(compositions.error)}
            </p>
          ) : compositions.isLoading ? (
            <p aria-busy="true">正在读取组合…</p>
          ) : compositions.data?.length ? (
            <>
              <label className="field-label" htmlFor="composition-pick">
                选择组合
              </label>
              <select
                id="composition-pick"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">选择组合</option>
                {compositions.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（{c.steps.length} 步
                    {c.sourceProjectName ? ` · 来自 ${c.sourceProjectName}` : ""}
                    {c.reuseCount ? ` · 已复用 ${c.reuseCount} 次` : ""}）
                  </option>
                ))}
              </select>
              <fieldset className="composition-mode">
                <legend>复用方式</legend>
                <label>
                  <input
                    type="radio"
                    checked={mode === "append"}
                    onChange={() => setMode("append")}
                  />
                  追加到当前步骤之后
                </label>
                <label>
                  <input
                    type="radio"
                    checked={mode === "replace"}
                    onChange={() => setMode("replace")}
                  />
                  替换当前全部步骤
                </label>
              </fieldset>
              {dirty && (
                <p className="field-help">
                  有未保存的编辑。复用会基于已保存版本（修订 {project.revision}）合并，请先保存或放弃草稿。
                </p>
              )}
              <Button
                variant="secondary"
                disabled={!selected || !!busy || dirty}
                onClick={() => void applySelected()}
              >
                {busy === "apply" ? "正在复用…" : "复用到本项目"}
              </Button>
            </>
          ) : (
            <p className="muted-note">
              还没有保存过组合。先在左边保存一个，之后就能在别的项目里复用。
            </p>
          )}
        </div>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="inline-note" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ 项目相关经验 */

export function ProjectExperienceHints({ steps }: { steps: AssemblyStep[] }) {
  const experiences = useExperiences();
  const related = useMemo(() => {
    const keys = new Set(steps.map((s) => s.capabilityId + "@" + s.version));
    return (experiences.data || [])
      .filter((e) =>
        e.capabilities.some((c) => keys.has(c.capabilityId + "@" + c.version)),
      )
      .slice(0, 4);
  }, [experiences.data, steps]);
  return (
    <section className="project-experience">
      <div className="section-heading">
        <div>
          <h2>这个项目能力的历史经验</h2>
          <p>
            来自真实运行的已验证方案、待验证建议和已知失败；执行前先看这里，能少走重复的路。
          </p>
        </div>
        <Link className="plain-link" to="/experiences">
          经验库
        </Link>
      </div>
      {experiences.isLoading ? (
        <p aria-busy="true">正在读取经验…</p>
      ) : experiences.isError ? (
        <p className="error-text" role="alert">
          {msg(experiences.error)}
        </p>
      ) : related.length ? (
        <div className="experience-list">
          {related.map((e) => (
            <ExperienceCard key={e.id} experience={e} />
          ))}
        </div>
      ) : (
        <p className="muted-note">
          此项目当前能力还没有经验记录。运行后在“运行反馈”里保存第一条。
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ 运行反馈页面 */

export function RunReviewPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const bundle = useQuery({
    queryKey: ["feedback", id],
    queryFn: () => client.feedback(id),
    enabled: !!id,
  });
  const [outcome, setOutcome] = useState<FeedbackOutcome>("worked");
  const [correction, setCorrection] = useState("");
  const [reusable, setReusable] = useState(true);
  const [reference, setReference] = useState("");
  const [author, setAuthor] = useState(readActor);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ExperienceKind>("unverified_suggestion");
  const [problem, setProblem] = useState("");
  const [resolution, setResolution] = useState("");
  const [tags, setTags] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [created, setCreated] = useState<ExperienceRecord | null>(null);
  const [suggestion, setSuggestion] = useState("");

  const data = bundle.data;
  useEffect(() => {
    const feedback = data?.feedback;
    if (!feedback) return;
    setOutcome(feedback.outcome);
    setCorrection(feedback.correction);
    setReusable(feedback.reusable);
    setReference(feedback.referenceValue);
    setAuthor(feedback.author);
  }, [data?.feedback?.id]);
  useEffect(() => {
    const run = data?.run;
    if (!run) return;
    const failure = run.failures[0];
    setTitle((current) => current || `${run.projectName} · ${failure?.name || "运行"}经验`);
    setProblem(
      (current) =>
        current ||
        (failure
          ? `${failure.name}失败（${failure.code}）：${failure.message}`
          : `${run.projectName} 的运行结果与预期存在需要人工确认的差异`),
    );
    setKind((current) =>
      current === "unverified_suggestion" && run.status === "completed"
        ? "verified_solution"
        : current,
    );
  }, [data?.run.id]);

  async function saveFeedback() {
    setBusy("feedback");
    setError("");
    setMessage("");
    try {
      rememberActor(author.trim());
      const next = await client.saveFeedback(id, {
        outcome,
        correction,
        reusable,
        referenceValue: reference,
        author: author.trim(),
      });
      qc.setQueryData(["feedback", id], next);
      await qc.invalidateQueries({ queryKey: ["overview"] });
      setMessage("这次运行的反馈已保存。");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy("");
    }
  }
  async function saveExperience() {
    if (!data) return;
    setBusy("experience");
    setError("");
    setMessage("");
    try {
      rememberActor(author.trim());
      const experience = await client.createExperience({
        title: title.trim(),
        kind,
        problem: problem.trim(),
        resolution: resolution.trim(),
        tags: tags.split(/[,，\s]+/).filter(Boolean),
        runId: id,
        sourceFeedbackId: data.feedback?.id,
        capabilities: data.run.capabilities.map((c) => ({
          capabilityId: c.capabilityId,
          version: c.version,
        })),
        author: author.trim(),
        confirmed,
      });
      setCreated(experience);
      await qc.invalidateQueries({ queryKey: ["experiences"] });
      await qc.invalidateQueries({ queryKey: ["feedback", id] });
      await qc.invalidateQueries({ queryKey: ["overview"] });
      setMessage("经验条目已写入经验库，后续项目可以选择并查看。");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy("");
    }
  }
  async function verify(experience: ExperienceRecord) {
    setBusy("verify-" + experience.id);
    setError("");
    setMessage("");
    try {
      await client.verifyExperience(experience.id, id);
      await qc.invalidateQueries({ queryKey: ["experiences"] });
      await qc.invalidateQueries({ queryKey: ["feedback", id] });
      await qc.invalidateQueries({ queryKey: ["overview"] });
      setMessage(`「${experience.title}」已由本次运行验证为解决方案。`);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy("");
    }
  }
  async function buildSuggestion(experience: ExperienceRecord) {
    setBusy("suggestion");
    setError("");
    try {
      const value = await client.portfolioSuggestion(experience.id);
      setSuggestion(JSON.stringify(value, null, 2));
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy("");
    }
  }

  if (!id)
    return (
      <div className="page">
        <EmptyState title="缺少运行记录" detail="请从项目或运行列表进入。" />
      </div>
    );
  if (bundle.isError)
    return (
      <div className="page">
        <EmptyState
          error
          title="无法读取这次运行"
          detail={msg(bundle.error)}
          action={<Button onClick={() => bundle.refetch()}>重试</Button>}
        />
      </div>
    );
  if (!data)
    return (
      <div className="page" aria-busy="true">
        正在读取真实运行记录…
      </div>
    );
  const run = data.run;
  return (
    <div className="page run-review">
      <div className="workspace-heading">
        <div>
          <span className="section-kicker">运行反馈 · {run.id}</span>
          <h1>{run.projectName}</h1>
          <p className="field-help">
            {run.inputFilename} · {formatTime(run.createdAt)} ·{" "}
            <Badge
              tone={
                run.status === "completed"
                  ? "green"
                  : run.status === "failed"
                    ? "red"
                    : "neutral"
              }
            >
              {runLabels[run.status] || run.status}
            </Badge>
          </p>
        </div>
        <div className="run-review-links">
          <Link className="plain-link" to={"/agent?run=" + run.id}>
            完整执行过程
          </Link>
          <Link className="plain-link" to={"/projects/" + run.projectId}>
            项目装配
          </Link>
        </div>
      </div>

      <section className="run-review-facts">
        <h2>这次真实执行了什么</h2>
        <ol className="review-capabilities">
          {run.capabilities.map((c, index) => (
            <li key={c.capabilityId + index}>
              <span className="row-index">{index + 1}</span>
              {c.name} <span className="field-help">v{c.version}</span>
            </li>
          ))}
        </ol>
        {run.failures.length > 0 && (
          <div className="runtime-issues" role="alert">
            <strong>失败步骤与原因</strong>
            {run.failures.map((f) => (
              <p key={f.position}>
                步骤{f.position + 1} {f.name}（{f.capabilityId}）：{f.code} ·{" "}
                {f.message}
              </p>
            ))}
          </div>
        )}
        <p className="field-help">
          交付文件：
          {run.artifacts.length
            ? run.artifacts.map((a) => a.filename).join("、")
            : "本次没有生成交付文件"}
        </p>
      </section>

      <section className="feedback-form">
        <h2>人工反馈</h2>
        <p className="field-help">
          记录真实结果与人工修正，是后续项目少走弯路的唯一来源；这里写的内容会随运行一起保存。
        </p>
        <fieldset className="feedback-outcome">
          <legend>这次实际结果</legend>
          {(Object.keys(feedbackName) as FeedbackOutcome[]).map((key) => (
            <label key={key}>
              <input
                type="radio"
                checked={outcome === key}
                onChange={() => setOutcome(key)}
              />
              {feedbackName[key]}
            </label>
          ))}
        </fieldset>
        <label className="field-label" htmlFor="feedback-correction">
          人工修正内容（改了什么、为什么）
        </label>
        <textarea
          id="feedback-correction"
          rows={4}
          maxLength={4000}
          value={correction}
          onChange={(e) => setCorrection(e.target.value)}
          placeholder="例如：把资料范围改成 general 后重跑通过；或在输入文件里补齐来源字段。"
        />
        <label className="review-checkbox">
          <input
            type="checkbox"
            checked={reusable}
            onChange={(e) => setReusable(e.target.checked)}
          />
          这次修正形成了可复用的解决方法
        </label>
        <label className="field-label" htmlFor="feedback-reference">
          对后续项目的参考价值（选填）
        </label>
        <textarea
          id="feedback-reference"
          rows={2}
          maxLength={2000}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <label className="field-label" htmlFor="feedback-author">
          记录人
        </label>
        <input
          id="feedback-author"
          value={author}
          maxLength={80}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="写清是谁做的判断"
        />
        <div className="dialog-actions">
          <Button
            disabled={
              !!busy || !author.trim() || (outcome !== "worked" && !correction.trim())
            }
            onClick={() => void saveFeedback()}
          >
            {busy === "feedback" ? "正在保存…" : "保存运行反馈"}
          </Button>
        </div>
        {data.feedback && (
          <p className="field-help">
            已保存过一条反馈（{formatTime(data.feedback.updatedAt)}），再次保存会更新它。
          </p>
        )}
      </section>

      <section className="experience-create">
        <h2>把这次修正沉淀为经验条目</h2>
        <p className="field-help">
          只有你勾选确认后才会写入长期经验库；AI 不会自己写进去。写入后其他项目在选择这些能力时能看到。
        </p>
        <label className="field-label" htmlFor="experience-title">
          标题
        </label>
        <input
          id="experience-title"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label className="field-label" htmlFor="experience-kind">
          条目类型
        </label>
        <select
          id="experience-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as ExperienceKind)}
        >
          {(Object.keys(experienceKindName) as ExperienceKind[]).map((key) => (
            <option key={key} value={key}>
              {experienceKindName[key]}
            </option>
          ))}
        </select>
        <label className="field-label" htmlFor="experience-problem">
          遇到的问题
        </label>
        <textarea
          id="experience-problem"
          rows={3}
          value={problem}
          maxLength={4000}
          onChange={(e) => setProblem(e.target.value)}
        />
        <label className="field-label" htmlFor="experience-resolution">
          有效的解决办法
        </label>
        <textarea
          id="experience-resolution"
          rows={3}
          value={resolution}
          maxLength={4000}
          onChange={(e) => setResolution(e.target.value)}
          placeholder="写清具体操作和生效条件，别写“注意一下”。"
        />
        <label className="field-label" htmlFor="experience-tags">
          标签（逗号分隔，选填）
        </label>
        <input
          id="experience-tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="例如：资料范围, 输入结构"
        />
        <label className="review-checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          这条内容由我判断并存为长期经验（人工确认）
        </label>
        <div className="dialog-actions">
          <Button
            disabled={
              !!busy ||
              !confirmed ||
              !title.trim() ||
              !problem.trim() ||
              !author.trim()
            }
            onClick={() => void saveExperience()}
          >
            {busy === "experience" ? "正在写入…" : "保存为经验条目"}
          </Button>
        </div>
        {created && (
          <div className="experience-created">
            <p role="status" className="inline-note">
              已写入：{experienceKindName[created.kind]}「{created.title}」
            </p>
            <div className="experience-actions">
              <Link className="plain-link" to="/experiences">
                在经验库查看
              </Link>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void buildSuggestion(created)}
                disabled={busy === "suggestion"}
              >
                生成 Portfolio 更新建议
              </Button>
            </div>
            {suggestion && (
              <>
                <p className="field-help">
                  Portfolio 正式登记源只读：这里只是可人工审阅的建议内容，没有写回 assets-index.json。
                </p>
                <pre className="input-preview">{suggestion}</pre>
              </>
            )}
          </div>
        )}
      </section>

      <section className="related-experience">
        <h2>与这次运行相关的已有经验</h2>
        {data.experiences.length ? (
          <div className="experience-list">
            {data.experiences.map((experience) => (
              <ExperienceCard
                key={experience.id}
                experience={experience}
                actions={
                  experience.kind !== "verified_solution" && run.status === "completed" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === "verify-" + experience.id}
                      onClick={() => void verify(experience)}
                    >
                      {busy === "verify-" + experience.id
                        ? "正在验证…"
                        : "用本次成功运行验证"}
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </div>
        ) : (
          <p className="muted-note">
            这些能力还没有历史经验。本次保存的经验会出现在后续项目中。
          </p>
        )}
      </section>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="inline-note" role="status">
          {message}
        </p>
      )}
      <Button variant="ghost" onClick={() => navigate("/")}>
        返回项目工作区
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------ 经验库页面 */

/* ------------------------------------------------ 调查纠错经验（TRACE） */

const traceStatusName: Record<TraceExperienceRecord["status"], string> = {
  pending: "待确认",
  confirmed: "已确认 · 可复用",
  disabled: "已停用",
};
const traceKindName: Record<string, string> = {
  date_role: "日期角色混淆（通过/公布日 vs 施行/生效日）",
  quantity_strict: "近似数字被当成严格门槛",
  scope_partial: "局部投运被当成全国建成",
};
const traceActionName: Record<string, string> = {
  created: "从真实调查生成",
  confirmed: "确认可复用",
  disabled: "停用",
  restored: "恢复",
};

/**
 * 调查纠错经验的确认与停用：状态变化全部留痕，条目永不删除。
 * 这里不做新的后台看板，只是在既有经验库页面把这一类经验管起来。
 */
export function TraceExperienceSection() {
  const qc = useQueryClient();
  const [actor, setActor] = useState(readActor);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const experiences = useQuery({
    queryKey: ["trace-experiences"],
    queryFn: () => client.traceExperiences(),
  });
  async function change(
    record: TraceExperienceRecord,
    action: "confirm" | "disable" | "restore",
  ) {
    setBusy(record.id + action);
    setError("");
    setMessage("");
    try {
      if (!actor.trim()) throw new Error("请先填写操作人。");
      await client.traceExperienceStatus(record.id, {
        action,
        actor: actor.trim(),
        ...(action === "disable" ? { note: note.trim() || "停用原因未填" } : {}),
      });
      rememberActor(actor.trim());
      await qc.invalidateQueries({ queryKey: ["trace-experiences"] });
      setMessage(
        `「${record.title}」已${
          action === "confirm" ? "确认进入可复用集合" : action === "disable" ? "停用" : "恢复"
        }，历史记录已保留。`,
      );
      setNote("");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy("");
    }
  }
  const rows = experiences.data?.experiences || [];
  return (
    <section className="trace-experience-admin">
      <div className="section-heading">
        <div>
          <h2>调查纠错经验</h2>
          <p>
            来自真实调查的纠错：待确认的经验不会进入可复用集合，只有确认过才会被下一次调查匹配；
            停用和恢复都保留历史。
          </p>
        </div>
        <Badge>
          {experiences.data
            ? `待确认 ${experiences.data.byStatus.pending} · 已确认 ${experiences.data.byStatus.confirmed} · 已停用 ${experiences.data.byStatus.disabled}`
            : "读取中"}
        </Badge>
      </div>
      {experiences.isError ? (
        <p className="error-text" role="alert">{msg(experiences.error)}</p>
      ) : experiences.isLoading ? (
        <p aria-busy="true">正在读取调查经验…</p>
      ) : rows.length === 0 ? (
        <p className="muted-note">还没有调查纠错经验。完成一次调查并在证据里做人工修正后即可沉淀。</p>
      ) : (
        <>
          <div className="trace-experience-actor">
            <label>
              操作人
              <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="填写确认人" />
            </label>
            <label>
              停用原因（停用时必填）
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：只在特定统计口径下成立" />
            </label>
          </div>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          {message ? <p className="inline-note" role="status">{message}</p> : null}
          <div className="experience-list">
            {rows.map((record) => {
              const payload = record.payload;
              return (
                <article key={record.id} className="experience-card trace-experience-admin-card">
                  <div className="experience-head">
                    <Badge
                      tone={
                        record.status === "confirmed" ? "green" : record.status === "pending" ? "amber" : "red"
                      }
                    >
                      {traceStatusName[record.status]}
                    </Badge>
                    <span className="muted-note">
                      {payload ? traceKindName[payload.kind] || payload.kind : record.kind} · v{record.version} ·{" "}
                      {record.projectName || "未关联项目"} · {formatTime(record.updatedAt)}
                    </span>
                  </div>
                  <h3>{record.title}</h3>
                  {payload ? (
                    <dl className="trace-experience-admin-fields">
                      <div>
                        <dt>历史说法</dt>
                        <dd>{payload.sourceClaim}</dd>
                      </div>
                      <div>
                        <dt>历史错误判断</dt>
                        <dd>{payload.wrongJudgment}</dd>
                      </div>
                      <div>
                        <dt>修正后判断</dt>
                        <dd>{payload.correctedJudgment}</dd>
                      </div>
                      <div>
                        <dt>正确处理</dt>
                        <dd>{payload.handling}</dd>
                      </div>
                      <div>
                        <dt>适用边界</dt>
                        <dd>{payload.limits}</dd>
                      </div>
                      <div>
                        <dt>检查要点</dt>
                        <dd>{payload.checkPoints.join("；")}</dd>
                      </div>
                      <div>
                        <dt>来源调查</dt>
                        <dd>
                          {payload.sourceRunIds.map((runId) => (
                            <Link key={runId} className="plain-link" to={"/runs/" + runId + "/review"}>
                              {runId}
                            </Link>
                          ))}
                        </dd>
                      </div>
                      <div>
                        <dt>原始证据</dt>
                        <dd>
                          {payload.evidence.map((item) => (
                            <span key={item.url} className="trace-experience-admin-evidence">
                              [{item.relation}] {item.quote}
                              <a href={item.url} target="_blank" rel="noreferrer noopener">
                                {" "}
                                {item.url}
                              </a>
                            </span>
                          ))}
                        </dd>
                      </div>
                      <div>
                        <dt>状态历史</dt>
                        <dd>
                          {payload.history.map((item, index) => (
                            <span key={index} className="trace-experience-admin-history">
                              {formatTime(item.at)} {traceActionName[item.action] || item.action} · {item.actor}
                              {item.note ? ` · ${item.note}` : ""}
                            </span>
                          ))}
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                  <div className="experience-actions">
                    {record.status !== "confirmed" ? (
                      <Button
                        size="sm"
                        disabled={busy === record.id + "confirm"}
                        onClick={() => void change(record, "confirm")}
                      >
                        {busy === record.id + "confirm" ? "正在确认…" : "确认可复用"}
                      </Button>
                    ) : null}
                    {record.status !== "disabled" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === record.id + "disable"}
                        onClick={() => void change(record, "disable")}
                      >
                        {busy === record.id + "disable" ? "正在停用…" : "停用"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === record.id + "restore"}
                        onClick={() => void change(record, "restore")}
                      >
                        {busy === record.id + "restore" ? "正在恢复…" : "恢复"}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export function ExperienceLibraryPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const experiences = useExperiences({ q: query, kind });
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: () => client.runs(),
  });
  const completed = (runs.data || []).filter((r) => r.status === "completed");
  const [verifyFor, setVerifyFor] = useState("");
  const [runId, setRunId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [suggestion, setSuggestion] = useState("");
  async function verify(experience: ExperienceRecord) {
    setBusy("verify");
    setError("");
    setMessage("");
    try {
      await client.verifyExperience(experience.id, runId);
      await qc.invalidateQueries({ queryKey: ["experiences"] });
      await qc.invalidateQueries({ queryKey: ["overview"] });
      setMessage(`「${experience.title}」已升级为已验证的解决方案。`);
      setVerifyFor("");
      setRunId("");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy("");
    }
  }
  async function buildSuggestion(experience: ExperienceRecord) {
    setBusy("suggestion");
    setError("");
    try {
      const value = await client.portfolioSuggestion(experience.id);
      setSuggestion(JSON.stringify(value, null, 2));
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="page experience-library">
      <div className="page-title-row">
        <div>
          <span className="section-kicker">跨项目经验</span>
          <h1>经验与反馈</h1>
        </div>
        <Badge>人工确认后写入</Badge>
      </div>
      <TraceExperienceSection />
      <div className="library-controls">
        <label className="search-field">
          <input
            aria-label="检索经验"
            placeholder="检索标题、问题、解决办法、标签或能力"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="kind-tabs" role="tablist" aria-label="经验类型">
          {[
            { key: "", label: "全部" },
            ...(Object.keys(experienceKindName) as ExperienceKind[]).map((k) => ({
              key: k,
              label: experienceKindName[k],
            })),
          ].map((tab) => (
            <button
              key={tab.key || "all"}
              role="tab"
              aria-selected={kind === tab.key}
              className={kind === tab.key ? "active" : ""}
              onClick={() => setKind(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {experiences.isError ? (
        <EmptyState
          error
          title="无法读取经验库"
          detail={msg(experiences.error)}
          action={<Button onClick={() => experiences.refetch()}>重试</Button>}
        />
      ) : experiences.isLoading ? (
        <p aria-busy="true">正在读取经验条目…</p>
      ) : experiences.data?.length ? (
        <div className="experience-list">
          {experiences.data.map((experience) => (
            <ExperienceCard
              key={experience.id}
              experience={experience}
              actions={
                experience.kind !== "verified_solution" ? (
                  verifyFor === experience.id ? (
                    <div className="verify-inline">
                      <select
                        aria-label="选择验证运行"
                        value={runId}
                        onChange={(e) => setRunId(e.target.value)}
                      >
                        <option value="">选择一次成功运行</option>
                        {completed.map((r: RunRecord) => (
                          <option key={r.id} value={r.id}>
                            {r.projectName} · {r.input.filename} ·{" "}
                            {formatTime(r.createdAt)}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        disabled={!runId || busy === "verify"}
                        onClick={() => void verify(experience)}
                      >
                        {busy === "verify" ? "正在验证…" : "确认验证"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setVerifyFor("");
                          setRunId("");
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setVerifyFor(experience.id);
                        setSuggestion("");
                      }}
                    >
                      用成功运行验证
                    </Button>
                  )
                ) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="还没有经验条目"
          detail={
            query || kind
              ? "当前筛选没有结果，换个关键词或类型试试。"
              : "进入任意一次运行，在“运行反馈”里保存第一条经验。"
          }
          action={
            <Button asChild>
              <Link to="/agent">查看运行记录</Link>
            </Button>
          }
        />
      )}
      {suggestion && (
        <section className="portfolio-suggestion">
          <h2>Portfolio 更新建议</h2>
          <p className="field-help">
            正式登记源只读；这是供人工审阅的建议，未写回 assets-index.json。
          </p>
          <pre className="input-preview">{suggestion}</pre>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              navigator.clipboard?.writeText(suggestion).catch(() => {});
            }}
          >
            复制建议内容
          </Button>
        </section>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="inline-note" role="status">
          {message}
        </p>
      )}
      {experiences.data?.length ? (
        <p className="service-line">
          <span>
            共 {experiences.data.length} 条
            {kind ? `（筛选：${experienceKindName[kind as ExperienceKind]}）` : ""}
            。证据来自真实运行记录；未验证的想法会明确标注。
          </span>
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ 组合列表页面 */

export function CompositionsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const compositions = useQuery({
    queryKey: ["compositions"],
    queryFn: client.compositions,
  });
  const projects = useQuery({ queryKey: ["projects"], queryFn: client.projects });
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function reuse(composition: CompositionRecord) {
    if (!target) return;
    setBusy(composition.id);
    setError("");
    setMessage("");
    try {
      const project = projects.data?.find((p) => p.id === target);
      if (!project) throw new Error("目标项目不存在");
      const saved = await client.applyComposition(project.id, {
        compositionId: composition.id,
        revision: project.revision,
        mode: "append",
      });
      await qc.invalidateQueries({ queryKey: ["projects"] });
      await qc.invalidateQueries({ queryKey: ["compositions"] });
      await qc.invalidateQueries({ queryKey: ["overview"] });
      setMessage(
        `已把「${composition.name}」复用到「${saved.name}」，现在共 ${saved.steps.length} 个步骤。`,
      );
      navigate("/projects/" + saved.id);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy("");
    }
  }
  async function remove(composition: CompositionRecord) {
    setBusy("delete-" + composition.id);
    setError("");
    try {
      await client.deleteComposition(composition.id);
      await qc.invalidateQueries({ queryKey: ["compositions"] });
      setMessage(`已删除组合「${composition.name}」。`);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="page compositions-page">
      <div className="page-title-row">
        <div>
          <span className="section-kicker">跨项目复用</span>
          <h1>能力组合</h1>
        </div>
        <label className="project-picker">
          复用到
          <select
            aria-label="复用目标项目"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">选择项目</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（修订 {p.revision}）
              </option>
            ))}
          </select>
        </label>
      </div>
      {compositions.isError ? (
        <EmptyState
          error
          title="无法读取组合"
          detail={msg(compositions.error)}
          action={<Button onClick={() => compositions.refetch()}>重试</Button>}
        />
      ) : compositions.isLoading ? (
        <p aria-busy="true">正在读取组合…</p>
      ) : compositions.data?.length ? (
        <div className="composition-list">
          {compositions.data.map((composition) => (
            <article key={composition.id} className="composition-card">
              <div>
                <span className="section-kicker">
                  {composition.sourceProjectName || "手工创建"} ·{" "}
                  {composition.steps.length} 步 · 权限{" "}
                  {composition.permissions.length}
                </span>
                <h2>{composition.name}</h2>
                {composition.description && <p>{composition.description}</p>}
                <ol className="composition-steps">
                  {composition.capabilities.map((c, index) => (
                    <li key={c.capabilityId + index}>
                      <span className="row-index">{index + 1}</span>
                      {c.name}
                      <span className="field-help">v{c.version}</span>
                    </li>
                  ))}
                </ol>
                <p className="field-help">
                  {composition.validation.ready
                    ? "服务端校验通过，可直接执行。"
                    : composition.validation.issues
                        .map((i) => i.message)
                        .join("；")}
                  {composition.reuseCount > 0 &&
                    ` · 已复用 ${composition.reuseCount} 次${
                      composition.lastReusedProjectName
                        ? `（最近：${composition.lastReusedProjectName}）`
                        : ""
                    }`}
                </p>
              </div>
              <div className="composition-actions">
                <Button
                  size="sm"
                  disabled={!target || !!busy}
                  onClick={() => void reuse(composition)}
                  title={!target ? "先选择目标项目" : undefined}
                >
                  {busy === composition.id ? "正在复用…" : "追加到目标项目"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => void remove(composition)}
                >
                  删除
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="还没有保存的组合"
          detail="在项目页面把当前执行顺序保存为组合，之后就能在这里复用。"
          action={
            <Button asChild>
              <Link to="/">打开项目工作区</Link>
            </Button>
          }
        />
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="inline-note" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
