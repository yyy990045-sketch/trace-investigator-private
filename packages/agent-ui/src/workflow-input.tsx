import { useId } from "react";
import Ajv from "ajv";
import { Button } from "@personal/ui-core";
import type { AssemblyStep, CapabilityInfo, ProjectRecord } from "@personal/capability-sdk";

export const workflowCapabilityId = "workflow.transition-check";
export const workflowStates = [
  ["PENDING", "待处理"], ["PROCESSING", "执行中"], ["SUCCEEDED", "已完成"],
  ["FAILED", "已失败"], ["SUSPENDED_ASR", "转写挂起"], ["SUSPENDED_HITL", "人工介入挂起"],
] as const;
const fieldNames: Record<string, string> = {
  documentId: "轨迹资料标识", requireTerminal: "要求轨迹已结束", query: "检索问题",
  limit: "最多引用条数", allowedScopes: "允许的资料范围", rejectConflicts: "存在冲突时停止",
};
export function schemaErrors(schema: Record<string, unknown>, value: unknown): string[] {
  try {
    const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
    if (validate(value)) return [];
    return (validate.errors || []).map((e) => {
      const property = String(e.params.missingProperty || e.params.additionalProperty || e.instancePath.split("/").at(-1) || "输入");
      const name = fieldNames[property] || property;
      if (e.keyword === "required") return `请填写${name}。`;
      if (e.keyword === "additionalProperties") return `存在多余字段“${name}”，请按输入要求移除。`;
      if (e.keyword === "minLength") return `${name}不能为空。`;
      if (e.keyword === "maxLength") return `${name}最多${e.params.limit}个字符。`;
      if (e.keyword === "type") return `${name}的格式不正确。`;
      return `${name}不符合要求（${e.keyword}）。`;
    });
  } catch { return ["暂时无法读取此能力的校验规则，请刷新后重试。"]; }
}

/** Render the current Runtime schema; the Runtime remains authoritative. */
export function CapabilityConfigFields({ cap, value, onChange }: {
  cap: CapabilityInfo; value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void;
}) {
  const id = useId();
  const properties = (cap.configSchema.properties || {}) as Record<string, Record<string, any>>;
  return <div className="capability-config-fields">{Object.entries(properties).map(([key, schema]) => {
    const label = fieldNames[key] || key;
    const change = (next: unknown) => onChange({ ...value, [key]: next });
    if (schema.type === "boolean") return <label className="review-checkbox" key={key}>
      <input type="checkbox" checked={value[key] === true} onChange={(e) => change(e.target.checked)} />{label}
      {key === "requireTerminal" && <small>已完成、已失败均属于结束状态；不代表外部任务成功。</small>}
    </label>;
    const fieldId = `${id}-${key}`;
    if (schema.enum) return <label key={key} className="field-label" htmlFor={fieldId}>{label}<select id={fieldId} value={String(value[key] ?? "")} onChange={(e) => change(e.target.value)}>{schema.enum.map((v: string) => <option key={v}>{v}</option>)}</select></label>;
    if (["string", "integer", "number"].includes(schema.type)) return <label key={key} className="field-label" htmlFor={fieldId}>{label}
      <input id={fieldId} type={schema.type === "string" ? "text" : "number"} value={String(value[key] ?? "")} min={schema.minimum} max={schema.maximum} minLength={schema.minLength} maxLength={schema.maxLength} step={schema.type === "integer" ? 1 : undefined} onChange={(e) => change(schema.type === "string" ? e.target.value : e.target.value === "" ? "" : Number(e.target.value))} />
    </label>;
    if (schema.type === "array" && schema.items?.type === "string") return <label key={key} className="field-label" htmlFor={fieldId}>{label}（多个值用逗号分隔）<input id={fieldId} value={Array.isArray(value[key]) ? (value[key] as string[]).join(", ") : ""} onChange={(e) => change(e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean))} /></label>;
    return <p className="field-help" key={key}>{label}请在高级配置中编辑。</p>;
  })}</div>;
}

export function WorkflowStateEditor({ value, onChange }: { value: string[]; onChange: (states: string[]) => void }) {
  const id = useId();
  return <fieldset className="workflow-editor"><legend>按发生顺序填写状态</legend>
    <ol className="workflow-state-list">{value.map((state, i) => <li key={i}>
      <label htmlFor={`${id}-${i}`}>第{i + 1}步</label>
      <select id={`${id}-${i}`} aria-label={`第${i + 1}步状态`} value={state} onChange={(e) => onChange(value.map((s, n) => n === i ? e.target.value : s))}>
        <option value="" disabled>请选择状态</option>
        {workflowStates.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </select>
      <Button type="button" variant="ghost" size="sm" disabled={value.length <= 2} aria-label={`移除第${i + 1}步`} onClick={() => onChange(value.filter((_, n) => n !== i))}>移除</Button>
    </li>)}</ol>
    <Button type="button" variant="secondary" size="sm" disabled={value.length >= 200} onClick={() => onChange([...value, ""])}>添加一个状态</Button>
    <p className="field-help">请主动选择2—200个状态，不预填成功轨迹。这里只检查输入结构，转换规则仍由Runtime实际核验。</p>
  </fieldset>;
}

export function workflowInput(project: ProjectRecord, states: string[], source: string, scope: string, note: string) {
  const steps = project.steps.filter((s) => s.capabilityId === workflowCapabilityId);
  const ids = [...new Set(steps.map((s) => String(s.config.documentId || "workflow")))];
  const documents = ids.map((id) => ({ id, text: JSON.stringify({ states }), source: source.trim(), scope }));
  if (note.trim()) documents.push({ id: ids.includes("workflow-note") ? "workflow-note-extra" : "workflow-note", text: note.trim(), source: source.trim(), scope });
  return JSON.stringify({ documents, claims: [] }, null, 2);
}

export function checkExecutionInput(filename: string, text: string, project: ProjectRecord, caps: CapabilityInfo[]): string[] {
  const errors: string[] = [];
  if (!filename.trim() || filename.length > 180) errors.push("请填写1—180个字符的文件名。");
  if (!/\.(txt|md|json)$/i.test(filename)) errors.push("文件格式仅支持 .txt、.md、.json；PDF和图片不能作为文本执行。");
  if (!text.trim()) errors.push("请填写资料内容。");
  if (new TextEncoder().encode(text).length > 262144) errors.push("资料最大256KB，请缩减内容。");
  const workflow = project.steps.filter((s) => s.capabilityId === workflowCapabilityId);
  if (workflow.length && !/\.json$/i.test(filename)) errors.push("轨迹核验需要 .json 文件名。改名后还须提供 documents 数组，单独的 states 对象不是完整资料文件。");
  if (!/\.json$/i.test(filename) || !text.trim()) return errors;
  let data: any;
  try { data = JSON.parse(text); } catch { return [...errors, "内容不是有效JSON，请检查引号、逗号和括号；仅修改文件名不会修复内容。"]; }
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.documents) || !data.documents.length)
    return [...errors, "内容结构需要非空 documents 数组；可切换到“填写状态”自动生成资料结构。"];
  const docs = data.documents.map((d: any, i: number) => ({ id: d?.id || `doc-${i + 1}`, text: d?.text, source: d?.source, scope: d?.scope || "general" }));
  if (docs.some((d: any) => typeof d.text !== "string" || !d.text.trim())) errors.push("每条资料必须填写非空的 text（资料正文）。");
  if (data.claims !== undefined && (!Array.isArray(data.claims) || data.claims.some((c: any) => !c || [c.key, c.value, c.source].some((v: unknown) => typeof v !== "string" || !v.trim()))))
    errors.push("claims中每条声明的 key、value、source 均须填写非空文本；没有事实声明时使用空数组。");
  if (docs.some((d: any) => typeof d.source !== "string" || !d.source.trim())) errors.push("每条资料必须填写非空 source（资料来源），不能用文件名代替。");
  for (const step of workflow) {
    const cap = caps.find((c) => c.id === step.capabilityId && c.version === step.version);
    if (!cap) { errors.push("尚未读取轨迹能力的输入要求，请等待或刷新。"); continue; }
    errors.push(...schemaErrors(cap.configSchema, step.config));
    errors.push(...schemaErrors(cap.inputSchema, { filename, documents: docs, claims: data.claims ?? [] }));
    const matches = docs.filter((d: any) => d.id === step.config.documentId);
    if (matches.length !== 1) { errors.push(`请提供且只提供一条标识为“${String(step.config.documentId)}”的轨迹资料；可切换“填写状态”自动匹配。`); continue; }
    try {
      const trace = JSON.parse(matches[0].text);
      if (!trace || !Array.isArray(trace.states) || trace.states.length < 2 || trace.states.length > 200 || trace.states.some((s: unknown) => !workflowStates.some(([code]) => s === code)))
        errors.push("轨迹内容须为含2—200个已登记状态的 states 数组，请使用状态选择器或核对状态名称。");
    } catch { errors.push("轨迹资料的 text 须为包含 states 数组的JSON文本，请使用“填写状态”自动生成。"); }
  }
  return [...new Set(errors)];
}

export function withCapability(steps: AssemblyStep[], cap: CapabilityInfo, config: Record<string, unknown>): AssemblyStep[] {
  const step = { capabilityId: cap.id, version: cap.version, config: structuredClone(config) };
  if (steps.some((s) => s.capabilityId === cap.id && s.version === cap.version))
    return steps.map((s) => s.capabilityId === cap.id && s.version === cap.version ? { ...s, config: step.config } : s);
  const position = cap.id === workflowCapabilityId
    ? steps.findIndex((s) => ["knowledge.search", "human.confirm", "report.export"].includes(s.capabilityId))
    : steps.findIndex((s) => ["human.confirm", "report.export"].includes(s.capabilityId));
  const result = [...steps]; result.splice(position < 0 ? result.length : position, 0, step);
  return result;
}
