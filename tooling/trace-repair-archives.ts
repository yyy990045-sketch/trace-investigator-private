/** Explicit local maintenance only. No network, no public administrative endpoint. */
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { createPlatform } from "../services/runtime/src/app.ts";
import { buildAssessment, redeliverArchive } from "../services/runtime/src/trace-followup.ts";
import { assessmentChanged } from "../services/runtime/adapters/trace/assessment-version.ts";
import { hash } from "../services/runtime/src/util.ts";

const RUN_IDS = [
  "run_7ff5367b-1fbc-42e3-8f7c-0b8add9b9ab6",
  "run_5ac241c1-1049-4c4d-aaf3-4cc0c45936f6",
  "run_8f812ae8-42f3-48d1-a353-84942f770e95",
];
const data = process.env.PLATFORM_DATA_DIR;
if (!data) throw new Error("PLATFORM_DATA_DIR must explicitly select the backed-up data directory.");
const platform = await createPlatform({ dbPath: join(resolve(data), "platform.sqlite"), artifactRoot: join(resolve(data), "artifacts"), recover: false });
try {
  // Validate all originals before any write. A missing/corrupt archive stops maintenance.
  const originals = platform.store.all(
    "SELECT id,path,sha256 FROM artifacts WHERE run_id IN (?,?,?)", ...RUN_IDS,
  );
  for (const file of originals) {
    if (hash((await readFile(file.path)).toString()) !== file.sha256) throw new Error(`Original artifact failed integrity check: ${file.id}`);
  }
  for (const runId of RUN_IDS) {
    const run = platform.store.run(runId);
    if (!run) throw new Error(`Locked case missing: ${runId}`);
    const versions = run.evidence.filter((e) => e.kind === "trace.revision").map((e) => e.data as any).sort((a, b) => a.revision - b.revision);
    const previous = versions.at(-1)?.assessment || (run.steps.find((s) => s.capabilityId === "trace.evidence.verify")?.output as any)?.assessment;
    const current = buildAssessment(run).assessment;
    if (!assessmentChanged(previous, current)) {
      console.log(JSON.stringify({ runId, changed: false }));
      continue;
    }
    if (!process.argv.includes("--apply")) {
      console.log(JSON.stringify({ runId, changed: true, dryRun: true, before: previous?.verdict?.outcome, after: current.verdict.outcome }));
      continue;
    }
    const result = await redeliverArchive(platform.store, platform.engine, runId, "规则修复重算（维护操作）");
    console.log(JSON.stringify({ runId, revision: result.revision, outcome: result.verdict.outcome, artifacts: result.artifacts }));
  }
  for (const file of originals) {
    if (hash((await readFile(file.path)).toString()) !== file.sha256) throw new Error(`Original artifact changed: ${file.id}`);
  }
} finally {
  await platform.app.close();
}
