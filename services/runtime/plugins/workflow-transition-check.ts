import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  VALID_TRANSITIONS,
  validateTransition,
  isTerminal,
  isSuspended,
  getStateLabel,
  type PipelineState,
} from "../adapters/cap08/state-machine.ts";
import {
  bundleSchema,
  ExecutionError,
  type CapabilityDefinition,
} from "../src/contracts.ts";
import type { DocumentBundle } from "@personal/capability-sdk";
import { hash } from "../src/util.ts";

const migratedSha256 = hash(
  (await readFile(new URL("../adapters/cap08/state-machine.ts", import.meta.url))).toString(),
);

export default {
  id: "workflow.transition-check",
  version: "1.0.0",
  name: "工作流轨迹核验（历史代码迁移）",
  description:
    "调用CAP-08原状态转换算法，逐步核对资料中的states轨迹；不执行飞书派发、转写或旧系统审批。配置documentId指定轨迹资料，requireTerminal决定是否要求终态。",
  inputProtocol: "document.bundle.v1",
  outputProtocol: "document.bundle.v1",
  inputSchema: bundleSchema,
  outputSchema: bundleSchema,
  configSchema: {
    type: "object",
    required: ["documentId", "requireTerminal"],
    properties: {
      documentId: { type: "string", minLength: 1, maxLength: 180 },
      requireTerminal: { type: "boolean" },
    },
    additionalProperties: false,
  },
  defaultConfig: { documentId: "workflow", requireTerminal: true },
  permissions: ["document:read", "document:validate", "evidence:write"],
  effects: ["none"],
  kind: "tool",
  idempotent: true,
  assets: [
    {
      assetId: "CAP-08",
      registryVersion: "0.4.0",
      registrySha256: "73dc44cfa20519071a31b6af67e7aca0b439cb55facffa655b18105227280e7f",
      assetVersion: null,
      relation: "code_migration",
      adapter: "WorkflowTransitionAdapter",
      sourceFiles: [
        {
          path: join(homedir(), "Projects/my-app/src/lib/state-machine.ts"),
          commit: "9b1eb4cdffc612569d2ff25e2a4f62ccee7b7d9a",
          sha256: "ad7ec11cf751b81faab6c0a65d632b8cadea124fe333ba32cba59d4dcaf20ace",
        },
      ],
      note:
        `实际迁移VALID_TRANSITIONS、validateTransition、isTerminal、isSuspended、getStateLabel；迁移文件SHA-256=${migratedSha256}。仅本轮授权私人本机复用，未发现开源许可，不授权公开分发。不迁移Supabase、网络、定时任务或旧应用运行能力。`,
    },
  ],
  async execute(input: DocumentBundle, config, ctx) {
    ctx.signal.throwIfAborted();
    const documents = input.documents.filter((document) => document.id === config.documentId);
    if (documents.length !== 1)
      throw new ExecutionError("WORKFLOW_SOURCE_INVALID", "需有且仅有一条与documentId匹配的轨迹资料。");
    let trace: unknown;
    try {
      trace = JSON.parse(documents[0].text);
    } catch {
      throw new ExecutionError("WORKFLOW_TRACE_INVALID", "轨迹资料须为含states数组的JSON文本。");
    }
    const states = trace && typeof trace === "object" && !Array.isArray(trace)
      ? (trace as { states?: unknown }).states : null;
    if (!Array.isArray(states) || states.length < 2 || states.length > 200 ||
      states.some((state) => typeof state !== "string" || !Object.hasOwn(VALID_TRANSITIONS, state)))
      throw new ExecutionError("WORKFLOW_TRACE_INVALID", "states须包含2至200个已登记状态，不接受未知状态。");
    const path = states as PipelineState[];
    for (let position = 1; position < path.length; position++) {
      ctx.signal.throwIfAborted();
      try {
        validateTransition(path[position - 1], path[position]);
      } catch {
        ctx.evidence("workflow.transition-rejected", {
          assetId: "CAP-08", migratedSha256, documentId: documents[0].id,
          position, from: path[position - 1], to: path[position],
        });
        throw new ExecutionError("WORKFLOW_TRANSITION_INVALID",
          `第${position}次转换不允许：${getStateLabel(path[position - 1])} → ${getStateLabel(path[position])}。`);
      }
    }
    const finalState = path[path.length - 1];
    if (config.requireTerminal && !isTerminal(finalState))
      throw new ExecutionError("WORKFLOW_NOT_TERMINAL", "轨迹仍在执行或挂起，不能作为已结束轨迹交付。");
    const workflowValidation = {
      assetId: "CAP-08", relation: "code_migration", migratedSha256,
      documentId: documents[0].id, source: documents[0].source,
      transitions: path.length - 1, states: path, finalState,
      finalLabel: getStateLabel(finalState), terminal: isTerminal(finalState),
      suspended: isSuspended(finalState),
    };
    ctx.evidence("workflow.transition-checked", workflowValidation);
    return {
      ...input,
      workflowValidation,
      checks: [...(input.checks || []), {
        name: "工作流状态转换", passed: true, status: "passed",
        detail: `按CAP-08原算法核对${path.length - 1}次转换，末态为${getStateLabel(finalState)}；仅核验上传轨迹，不证明外部任务实际完成。`,
      }],
    };
  },
} satisfies CapabilityDefinition;
