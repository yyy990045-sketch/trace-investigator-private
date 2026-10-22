export type PipelineState =
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "SUSPENDED_ASR"
  | "SUSPENDED_HITL";

export const VALID_TRANSITIONS: Record<PipelineState, PipelineState[]> = {
  PENDING: ["PROCESSING"],
  PROCESSING: ["SUCCEEDED", "FAILED", "SUSPENDED_ASR", "SUSPENDED_HITL"],
  SUCCEEDED: [],
  FAILED: ["PENDING"],
  SUSPENDED_ASR: ["PROCESSING", "FAILED"],
  SUSPENDED_HITL: ["PROCESSING", "FAILED"],
};

export function validateTransition(from: PipelineState, to: PipelineState): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid state transition: ${from} → ${to}`);
  }
}

export function isTerminal(state: PipelineState): boolean {
  return state === "SUCCEEDED" || state === "FAILED";
}

export function isSuspended(state: PipelineState): boolean {
  return state === "SUSPENDED_ASR" || state === "SUSPENDED_HITL";
}

export function getStateLabel(state: PipelineState): string {
  const labels: Record<PipelineState, string> = {
    PENDING: "待处理",
    PROCESSING: "执行中",
    SUCCEEDED: "已完成",
    FAILED: "已失败",
    SUSPENDED_ASR: "ASR转写挂起",
    SUSPENDED_HITL: "人工介入挂起",
  };
  return labels[state] || state;
}
