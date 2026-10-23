import type { Citation, RunRecord } from "@personal/capability-sdk";

/** Read the persisted model step, never infer historical AI use from current settings. */
export function ModelReview({ run, at }: { run: RunRecord; at?: string }) {
  const step = run.steps.find((item) => item.capabilityId === "model.verify");
  if (!step) return null;
  const output = step.output as { verification?: { summary: string; verdict: string; citations: string[] }; citations?: Citation[] } | null;
  const verification = output?.verification;
  const completed = step.status === "completed" && !!verification;
  const stale = completed && !!step.finishedAt && run.evidence.some((item) =>
    ["trace.followup", "trace.correction", "trace.reassessment"].includes(item.kind) &&
    item.createdAt > step.finishedAt! && (!at || item.createdAt <= at));
  const call = (run.modelCalls || []).findLast((item) => item.status === "completed");
  const citations = (verification?.citations || []).flatMap((id) => {
    const citation = output?.citations?.find((item) => item.id === id);
    if (!citation) return [];
    try {
      const url = new URL(citation.source);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
        ? [{ ...citation, host: url.hostname }] : [];
    } catch { return []; }
  });
  return <section className="trace-block" aria-label="模型语义复核">
    <div className="trace-section-head"><h2>模型语义复核</h2>
      <span>{stale ? "证据已变化，旧意见待复核" : completed ? "已取得模型返回" : step.status === "failed" ? "模型复核未完成" : run.status === "canceled" ? (step.startedAt ? "复核步骤已取消" : "未调用模型（调查已取消）") : step.status === "running" ? "正在调用" : "尚未调用"}</span>
    </div>
    {completed ? <>
      <p className="trace-hint">{call ? `${call.model} · ${(call.durationMs / 1000).toFixed(1)} 秒。` : "本次模型步骤已完成。"}
        {stale ? "以下是变化前的模型意见，不适用于当前新增或修正的证据。" : "模型意见与规则判断单独保留，均需结合原文审阅。"}</p>
      <p style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{verification!.summary}</p>
      <p className="trace-hint">模型意见：{verification!.verdict === "supported" ? "提供的材料支持说法" : "需要继续审阅，不能据此确定"}</p>
      <ul className="trace-notes">{citations.map((citation) => <li key={citation.id}>
        <a href={citation.source} target="_blank" rel="noopener noreferrer">打开引用 · {citation.host}</a>
      </li>)}</ul>
    </> : <p className="trace-hint">{step.error?.message || "只有真实返回通过格式与引用校验后，才会显示模型意见；失败不会用规则结果替代。"}</p>}
  </section>;
}
