/**
 * 补算人工修正的「对结论的影响」。
 *
 * 背景：先写入的修正记录当时还没有记录影响；本轮新增了影响字段，
 * 老记录如果留空，档案里就只剩「改了什么、为什么改」，缺「改完之后结论动没动」。
 *
 * 做法：按修正记录的时间顺序逐条重放——先算「还没有这条修正」的评估，
 * 再算「采纳这条修正之后」的评估，两者相减就是这条修正的真实影响。
 * 用的是 Runtime 里同一套 buildAssessment/aggregateCase，不写死任何数字。
 *
 * 用法：npx tsx tooling/trace-correction-backfill.ts
 */
import { Store } from "../services/runtime/src/store.ts";
import { buildAssessment } from "../services/runtime/src/trace-followup.ts";
import type { CorrectionRecord } from "../services/runtime/adapters/trace/analyze.ts";

const dbPath = process.env.PLATFORM_DB || "data/platform.sqlite";
const store = new Store(dbPath);
const runIds: string[] = (store.all("SELECT DISTINCT run_id FROM evidence WHERE kind='trace.correction'") as {
  run_id: string;
}[]).map((row) => row.run_id);

const RELATION_TEXT: Record<string, string> = {
  supports: "支持",
  contradicts: "反对",
  unclear: "无法确认",
  irrelevant: "无关",
  mixed: "存在争议",
  none: "无可用来源",
};

for (const runId of runIds) {
  const run = store.run(runId);
  if (!run) continue;
  const rows = store.all(
    "SELECT id,data FROM evidence WHERE run_id=? AND kind='trace.correction' ORDER BY created_at,id",
    runId,
  ) as { id: string; data: string }[];
  if (!rows.length) continue;

  const all: CorrectionRecord[] = rows.map((row) => JSON.parse(row.data));
  const pending = all.filter((item) => !item.impact);
  if (!pending.length) {
    console.log(`${runId}：修正 ${all.length} 条，已有影响记录，跳过。`);
    continue;
  }

  for (let index = 0; index < all.length; index++) {
    const current = all[index];
    if (current.impact) continue;
    // 重放：第 index 条之前的修正 vs 包含第 index 条的修正
    const before = buildAssessment(run, { useCorrections: all.slice(0, index) }).assessment;
    const after = buildAssessment(run, { useCorrections: all.slice(0, index + 1) }).assessment;
    const factOf = (assessment: any) =>
      (assessment.facts as any[]).find((item) => item.factId === current.factId) || null;
    const sourceOf = (assessment: any) =>
      (factOf(assessment)?.sources as any[] | undefined)?.find((item) => item.pageId === current.pageId) || null;
    const impact = {
      sourceBefore: sourceOf(before)?.relation || "none",
      sourceAfter: sourceOf(after)?.relation || "none",
      factBefore: factOf(before)?.relation || "none",
      factAfter: factOf(after)?.relation || "none",
      supportsBefore: factOf(before)?.supports ?? 0,
      supportsAfter: factOf(after)?.supports ?? 0,
      clustersBefore: factOf(before)?.independentClusters ?? 0,
      clustersAfter: factOf(after)?.independentClusters ?? 0,
      verdictBefore: before.verdict?.outcome || "insufficient",
      verdictAfter: after.verdict?.outcome || "insufficient",
    };
    const updated = { ...current, impact };
    all[index] = updated;
    store.exec("UPDATE evidence SET data=? WHERE id=?", JSON.stringify(updated), rows[index].id);
    console.log(
      `${runId.slice(0, 12)} 修正#${index + 1}：${current.pageId} 关系 ` +
        `${RELATION_TEXT[impact.sourceBefore] || impact.sourceBefore} → ${RELATION_TEXT[impact.sourceAfter] || impact.sourceAfter}` +
        `，事实 ${impact.factBefore} → ${impact.factAfter}，支持 ${impact.supportsBefore} → ${impact.supportsAfter}` +
        `，结论 ${impact.verdictBefore} → ${impact.verdictAfter}`,
    );
  }
}
store.close();
console.log("完成。");
