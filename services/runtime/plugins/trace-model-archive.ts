import archive from "./trace-archive-export.ts";
import type { CapabilityDefinition } from "../src/contracts.ts";

// Preserve trace.archive.export@1.0.0 for historical plans and pending approvals.
export default {
  ...archive,
  id: "trace.model.archive",
  name: "含模型复核的调查档案导出",
  async execute(input, config, ctx) {
    const completed = (ctx.snapshot() as { steps?: { capability: string; status: string }[] })
      .steps?.some((step) => step.capability === "model.verify" && step.status === "completed") === true;
    return archive.execute({ ...input, modelReviewVerified: completed }, config, ctx);
  },
} satisfies CapabilityDefinition;
