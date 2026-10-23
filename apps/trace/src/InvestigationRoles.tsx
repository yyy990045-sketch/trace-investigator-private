import type { RunRecord } from "@personal/capability-sdk";
import { SHOWCASE } from "./api";

export function InvestigationRoles({ run }: { run: RunRecord }) {
  const model = run.steps.some((step) => step.capabilityId === "model.verify" && step.status === "completed");
  const approved = run.approvals.findLast((item) => item.status === "approved");
  return <aside className="trace-searchline" aria-label="本次调查分工与记录性质">
    <span className="trace-searchline-label">{SHOWCASE ? "历史记录回放" : "执行分工"}</span>
    <div>
      <p>元宝搜索取得联网材料 → 规则引擎自动判断证据关系 → {model ? "DeepSeek 基于所提供证据辅助语义复核" : "本次未使用模型语义复核"} → 人工审阅确认交付。事实拆解由人工完成。</p>
      {approved ? <p className="trace-hint">确认记录：{approved.actor || "未填写"}。{approved.actor?.includes("Codex") ? "这是本地验收记录，不代表用户本人签署。" : "该名称为运行记录中的填写值，不构成身份认证。"}</p> : null}
      {SHOWCASE ? <p className="trace-hint">正在操作已完成调查的只读记录，没有发起新的搜索或模型调用。页面仅校正历史系统措辞；原始运行、判断和已交付档案文件均未改写。</p> : null}
    </div>
  </aside>;
}
