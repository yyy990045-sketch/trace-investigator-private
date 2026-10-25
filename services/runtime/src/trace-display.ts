import type { RunRecord } from "@personal/capability-sdk";

/** Presentation projection only. Stored evidence, execution inputs and raw GET stay intact. */
export function traceDisplayRun(run: RunRecord): RunRecord {
  function compact(value: any): any {
    if (Array.isArray(value)) return value.map(compact);
    if (!value || typeof value !== "object") return value;
    const body = "ok" in value && "text" in value && ("pageId" in value || "httpStatus" in value);
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["bodyTexts", "documents", "raw"].includes(key) && !(key === "text" && (body || "case" in value)))
      .map(([key, item]) => [key, compact(item)]));
  }
  return {
    ...run,
    steps: run.steps.map((step) => ({ ...step, input: null, output: compact(step.output) })),
    evidence: run.evidence.map((item) => ({ ...item, data: compact(item.data) })),
  };
}
