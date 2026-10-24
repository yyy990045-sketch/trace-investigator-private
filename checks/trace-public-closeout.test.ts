import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatform } from "../services/runtime/src/app.ts";
import { expireAbandonedApprovals } from "../services/runtime/src/public-guard.ts";
import { standardAssembly, standardPermissions } from "@personal/capability-sdk";

describe("Public approval expiration", () => {
  const previous = process.env.PLATFORM_PUBLIC;
  afterEach(() => {
    if (previous === undefined) delete process.env.PLATFORM_PUBLIC;
    else process.env.PLATFORM_PUBLIC = previous;
  });

  it("expires only abandoned public approvals and preserves the run for audit", async () => {
    process.env.PLATFORM_PUBLIC = "1";
    const dir = await mkdtemp(join(tmpdir(), "trace-public-closeout-"));
    const platform = await createPlatform({ dbPath: join(dir, "data.sqlite"), artifactRoot: join(dir, "artifacts") });
    try {
      const project = platform.engine.createProject({
        name: "公网审批测试",
        layout: "agent",
        permissions: standardPermissions,
        steps: structuredClone(standardAssembly),
      });
      const created = platform.engine.createRun(project.id, {
        filename: "case.txt",
        text: "对比两条公开来源，人工批准后归档。",
      });
      let waiting = platform.store.run(created.id);
      for (let i = 0; i < 200 && waiting?.status !== "waiting_approval"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        waiting = platform.store.run(created.id);
      }
      expect(waiting?.status).toBe("waiting_approval");
      platform.store.exec("UPDATE runs SET owner=?,updated_at=? WHERE id=?", "ses_test", "2020-01-01T00:00:00.000Z", created.id);
      const first = expireAbandonedApprovals(platform.store, platform.engine, 300_000);
      expect(first).toBe(1);
      const canceled = platform.store.run(created.id)!;
      expect(canceled.status).toBe("canceled");
      expect(canceled.approvals.every((a) => a.status === "canceled")).toBe(true);
      expect(canceled.events.some((e) => e.type === "approval.expired")).toBe(true);
      expect(expireAbandonedApprovals(platform.store, platform.engine, 300_000)).toBe(0);
      expect(() => platform.engine.decide(created.id, waiting!.approvals[0].id, "approve", "迟到审核")).toThrow();
    } finally {
      await platform.app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
