import {
  bundleSchema,
  emptyConfig,
  type CapabilityDefinition,
} from "../src/contracts.ts";
// Extension proof: this file alone adds an executable capability; Engine has no knowledge of its ID.
export default {
  id: "text.metrics",
  version: "1.0.0",
  name: "资料字数统计（扩展模块）",
  description: "实际计算上传资料字符数，结果随流程传递并写入证据。",
  inputProtocol: "document.bundle.v1",
  outputProtocol: "document.bundle.v1",
  inputSchema: bundleSchema,
  outputSchema: bundleSchema,
  configSchema: emptyConfig,
  defaultConfig: {},
  permissions: ["document:read"],
  effects: ["none"],
  kind: "tool",
  idempotent: true,
  assets: [],
  async execute(input, config, ctx) {
    const metrics = {
      documents: input.documents.length,
      characters: input.documents.reduce(
        (n: number, d: any) => n + [...d.text].length,
        0,
      ),
    };
    ctx.evidence("extension.text-metrics", metrics);
    return { ...input, metrics };
  },
} satisfies CapabilityDefinition;
