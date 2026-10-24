/**
 * 侦探追查是否有必要继续：由未解决的证据缺口触发，避免在等待初次执行
 * 时发出请求，或因为没有预制检索式就漏掉决定性线索缺口。
 * 具体查询与检索预算仍由 Runtime 决定。
 */
export interface DetectiveGapState {
  status: string;
  decision?: {
    state: "found" | "ambiguous" | "insufficient";
    nextQueries?: { query: string; reason: string }[];
  } | null;
  pendingCount: number;
  candidates: {
    matches: { decisive?: boolean; found: boolean }[];
  }[];
  followupCount: number;
}

export function needsDetectiveFollowup(state: DetectiveGapState): boolean {
  if (state.status !== "completed" && state.status !== "failed") return false;
  if (!state.decision || state.decision.state === "found" || state.followupCount >= 4) return false;
  const unresolvedDecisive = state.candidates.slice(0, 2).some((candidate) =>
    candidate.matches.some((match) => match.decisive && !match.found),
  );
  return state.pendingCount > 0 ||
    Boolean(state.decision.nextQueries?.some((item) => item.query.trim())) ||
    !state.candidates.length ||
    unresolvedDecisive;
}
