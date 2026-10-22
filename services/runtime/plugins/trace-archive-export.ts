/**
 * trace.archive.export —— 可下载的调查档案（首版，第 1 版）。
 *
 * 只有在人工确认节点通过后才会执行（requiresApproval + approvalScope: delivery），
 * 生成 Markdown 档案与结构化 JSON，两者都写入 SHA-256 与字节数，可下载复查。
 *
 * 档案正文统一由 adapters/trace/archive.ts 的 renderArchive 生成：
 * 首版与此后「重新确认」产生的第 N 版共用同一套文案与判定口径，
 * 差别只在版本号与「本版变化」一节。
 */
import { ExecutionError, type CapabilityDefinition } from "../src/contracts.ts";
import { publicBundleSchema } from "../adapters/trace/bundle.ts";
import { renderArchive } from "../adapters/trace/archive.ts";

const configSchema = { type: "object", additionalProperties: false };

export default {
  id: "trace.archive.export",
  // 版本号与界面的 ASSEMBLY 一致：能力序列不静默替换，改版本会挡住已有项目的执行前校验。
  version: "1.0.0",
  name: "调查档案导出",
  description:
    "人工确认后生成可下载的调查档案（Markdown 与结构化 JSON），包含结论、逐条证据、来源网址与检索记录。",
  inputProtocol: "document.bundle.v1",
  outputProtocol: "document.bundle.v1",
  inputSchema: publicBundleSchema,
  outputSchema: publicBundleSchema,
  configSchema,
  defaultConfig: {},
  permissions: ["file:write"],
  effects: ["local_file"],
  kind: "tool",
  requiresApproval: true,
  approvalScope: "delivery",
  idempotent: true,
  assets: [],
  async execute(input: any, _config, ctx) {
    const assessment = input.assessment;
    if (!assessment?.verdict) {
      throw new ExecutionError(
        "ASSESSMENT_MISSING",
        "缺少证据核验结果，不能生成调查档案。",
      );
    }
    const generatedAt = new Date().toISOString();
    const rendered = renderArchive({
      runId: ctx.runId,
      bundle: input,
      assessment,
      revision: 1,
      generatedAt,
      actor: "人工确认节点（首版交付）",
      changes: [],
    });

    const markdown = await ctx.artifact(
      rendered.markdownFilename,
      rendered.markdown,
      "text/markdown; charset=utf-8",
    );
    const json = await ctx.artifact(
      rendered.jsonFilename,
      rendered.json,
      "application/json; charset=utf-8",
    );
    // 版本记录：让「当前是第几版 / 首版何时交付」有据可查，而不是靠文件名字符串猜。
    ctx.evidence("trace.revision", {
      revision: 1,
      at: generatedAt,
      actor: "人工确认节点（首版交付）",
      artifacts: [markdown, json].map((artifact) => ({
        id: artifact.id,
        filename: artifact.filename,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
      })),
      assessment,
      followupCount: 0,
      correctionCount: 0,
      changes: [],
    });
    return input;
  },
} satisfies CapabilityDefinition;
