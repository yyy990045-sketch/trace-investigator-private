import type { CapabilityDefinition, Schema } from "../src/contracts.ts";
import {
  bundleSchema,
  uploadSchema,
  emptyConfig,
  ExecutionError,
} from "../src/contracts.ts";
import { modelConfiguration } from "../src/providers.ts";
import { hash } from "../src/util.ts";
import type { AssetLink, DocumentBundle } from "@personal/capability-sdk";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Gate 2 anchors are facts about read-only historical sources; all implementations here are new.
const anchors: Record<
  string,
  { paths: string[]; commit: string; note: string }
> = {
  "CAP-01": {
    paths: [
      "company-ai-platform/src/core/evidence.ts",
      "company-ai-platform/src/core/decision-record.ts",
      "company-ai-platform/src/core/action-record.ts",
    ],
    commit: "3551123caecab702f113bd6b5823ea594050688c",
    note: "参考证据/决定/动作分离语义；新SQLite证据实现，未复制历史内核。",
  },
  "CAP-04": {
    paths: [
      "openelab-ai-agent/src/lib/knowledge-scope.ts",
      "openelab-ai-agent/src/lib/truth-ledger/conflicts.ts",
    ],
    commit: "33e4022de893e0c2d6f4146526370b99b52d3b9b",
    note: "参考范围拒绝与未决冲突语义；新规则实现。",
  },
  "CAP-08": {
    paths: ["my-app/src/lib/state-machine.ts"],
    commit: "9b1eb4cdffc612569d2ff25e2a4f62ccee7b7d9a",
    note: "参考状态转换表；新平台依据存储状态事务更新，不复制旧信任from_state逻辑。",
  },
  "CAP-02": {
    paths: [
      "qa-system/src/lib/openelab-client/config.ts",
      "a4-medical-bias-benchmark/src/lib/openelab-client/config.ts",
      "qa-system/src/lib/coze-retrieval/config.ts",
    ],
    commit: "",
    note: "新KnowledgeProvider及授权上传资料的本地词项检索；未复用历史客户端、远程知识库或凭证，非历史RAG服务接入。",
  },
};
async function mapping(assetId: string, adapter: string): Promise<AssetLink[]> {
  const a = anchors[assetId];
  const registryBytes = await readFile(
    join(
      homedir(),
      "Projects/personal-ai-portfolio/registry/assets-index.json",
    ),
  );
  const registryVersion = JSON.parse(registryBytes.toString()).meta.version;
  const files = await Promise.all(
    a.paths.map(async (p) => {
      const path = join(homedir(), "Projects", p);
      let digest: string | null = null;
      try {
        digest = hash((await readFile(path)).toString());
      } catch {}
      const commit =
        a.commit ||
        (p.startsWith("a4-")
          ? "08a05ad0f3e2998ed311b84cfd77452ca5b8687e"
          : "3949c6c430ce20ffa94b935314a1722a6498f6fb");
      return { path, commit, sha256: digest };
    }),
  );
  return [
    {
      assetId,
      registryVersion,
      registrySha256: hash(registryBytes.toString()),
      assetVersion: null,
      relation: "design_reference",
      adapter,
      sourceFiles: files,
      note: a.note,
    },
  ];
}
const base = {
  version: "1.0.0",
  inputProtocol: "document.bundle.v1",
  outputProtocol: "document.bundle.v1",
  inputSchema: bundleSchema,
  outputSchema: bundleSchema,
  configSchema: emptyConfig,
  defaultConfig: {},
  permissions: [] as string[],
  effects: ["none"] as CapabilityDefinition["effects"],
  kind: "tool" as const,
  idempotent: true,
  assets: [] as AssetLink[],
};
export async function builtins(): Promise<CapabilityDefinition[]> {
  return [
    {
      ...base,
      id: "documents.parse",
      name: "资料解析",
      description:
        "解析授权上传的UTF-8文本、Markdown或JSON，生成带来源定位的资料段落。",
      inputProtocol: "source.upload.v1",
      inputSchema: uploadSchema,
      permissions: ["document:read"],
      async execute(input) {
        if (!/\.(txt|md|json)$/i.test(input.filename))
          throw new ExecutionError(
            "UNSUPPORTED_FILE",
            "目前支持UTF-8 .txt、.md和.json；未支持PDF、图片或Office。",
          );
        if (Buffer.byteLength(input.text) > 262144)
          throw new ExecutionError("FILE_TOO_LARGE", "资料最多256KB。");
        let documents: any[],
          claims: any[] = [];
        if (/\.json$/i.test(input.filename)) {
          let data;
          try {
            data = JSON.parse(input.text);
          } catch {
            throw new ExecutionError("INVALID_JSON", "上传JSON存在语法错误。");
          }
          if (!data || typeof data !== "object" || Array.isArray(data))
            throw new ExecutionError("INVALID_DOCUMENTS", "JSON顶层必须是含documents的对象。");
          documents = data.documents;
          claims = data.claims === undefined ? [] : data.claims;
          if (!Array.isArray(documents) || documents.length === 0)
            throw new ExecutionError(
              "INVALID_DOCUMENTS",
              "JSON需包含非空documents数组。",
            );
          for (const d of documents) {
            if (!d || typeof d !== "object" || typeof d.text !== "string" || !d.text.trim())
              throw new ExecutionError("INVALID_DOCUMENTS", "每条资料必须包含非空text。");
            if (typeof d.source !== "string" || !d.source.trim())
              throw new ExecutionError("MISSING_SOURCE", "JSON资料必须提供显式非空source，不能用上传文件名补造来源。");
          }
          if (!Array.isArray(claims) || claims.some((c: any) => !c ||
            [c.key, c.value, c.source].some((v) => typeof v !== "string" || !v.trim())))
            throw new ExecutionError("INVALID_CLAIMS", "claims必须是含非空key、value、source的数组。");
          documents = documents.map((d: any, i: number) => ({
            id: d.id || `doc-${i + 1}`,
            text: d.text,
            source: d.source.trim(),
            scope: d.scope || "general",
          }));
        } else {
          documents = input.text
            .split(/\n\s*\n/)
            .map((text: string, i: number) => ({
              id: `doc-${i + 1}`,
              text: text.trim(),
              source: `${input.filename}#段落${i + 1}`,
              scope: "general",
            }))
            .filter((d: any) => d.text);
        }
        if (!documents.length)
          throw new ExecutionError("EMPTY_DOCUMENT", "资料内容为空。");
        return {
          filename: input.filename,
          documents,
          claims,
          modelConsent: input.modelConsent === true,
        };
      },
    },
    {
      ...base,
      id: "documents.scope-check",
      name: "范围与冲突核验",
      description: "拒绝范围外资料、重复标识、断开的来源及相互冲突的声明。",
      assets: await mapping("CAP-04", "ScopeConflictAdapter"),
      permissions: ["document:validate"],
      configSchema: {
        type: "object",
        required: ["allowedScopes", "rejectConflicts"],
        properties: {
          allowedScopes: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", minLength: 1 },
          },
          rejectConflicts: { type: "boolean", const: true },
        },
        additionalProperties: false,
      },
      defaultConfig: { allowedScopes: ["general"], rejectConflicts: true },
      async execute(input: DocumentBundle, config) {
        const ids = new Set<string>();
        for (const doc of input.documents) {
          if (ids.has(doc.id))
            throw new ExecutionError(
              "DUPLICATE_DOCUMENT",
              "重复资料标识：" + doc.id,
            );
          ids.add(doc.id);
          if (!config.allowedScopes.includes(doc.scope))
            throw new ExecutionError(
              "SCOPE_DENIED",
              `资料 ${doc.id} 的范围 ${doc.scope} 不在项目授权范围内。`,
            );
        }
        const values = new Map<string, Set<string>>();
        for (const claim of input.claims) {
          if (!input.documents.some((d) => d.id === claim.source))
            throw new ExecutionError(
              "SOURCE_NOT_FOUND",
              "声明来源不存在：" + claim.source,
            );
          const key = claim.key.normalize("NFKC").trim().toLowerCase();
          const set = values.get(key) || new Set<string>();
          set.add(claim.value.normalize("NFKC").trim().toLowerCase());
          values.set(key, set);
        }
        const conflicts = [...values]
          .filter(([, v]) => v.size > 1)
          .map(([key]) => key);
        if (conflicts.length)
          throw new ExecutionError(
            "UNRESOLVED_CONFLICT",
            "同一事实存在冲突：" + conflicts.join("、"),
          );
        for (const claim of input.claims) {
          const source = input.documents.find((d) => d.id === claim.source)!;
          if (!source.text.normalize("NFKC").toLowerCase().includes(claim.value.normalize("NFKC").trim().toLowerCase()))
            throw new ExecutionError("CLAIM_NOT_SUPPORTED", "声明值未出现在指定来源原文中：" + claim.key);
        }
        return {
          ...input,
          checks: [
            {
              name: "资料范围",
              passed: true,
              detail: `1个输入文件中的${input.documents.length}条资料段落记录均在项目允许范围内。`,
            },
            {
              name: "来源与冲突",
              passed: !conflicts.length,
              status: input.claims.length ? "passed" : "not_evaluated",
              detail: input.claims.length
                ? `${input.claims.length}条声明来源可定位，字面值见原文；同一键未发现冲突值。非语义事实验证。`
                : "未提供事实声明，未执行声明一致性核验；不能表述为已验证无冲突。",
            },
          ],
        };
      },
    },
    {
      ...base,
      id: "knowledge.search",
      name: "上传资料检索与引用",
      description:
        "在本次授权上传资料中实际检索并生成来源引用；不是历史远程RAG。",
      assets: await mapping("CAP-02", "LocalUploadKnowledgeProvider"),
      permissions: ["knowledge:search"],
      configSchema: {
        type: "object",
        required: ["query", "limit"],
        properties: {
          query: { type: "string", maxLength: 500 },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        additionalProperties: false,
      },
      defaultConfig: { query: "", limit: 5 },
      async execute(input: DocumentBundle, config, ctx) {
        const citations = await ctx.knowledge.search(
          config.query,
          input.documents,
          config.limit,
          ctx.signal,
        );
        ctx.evidence("retrieval.sources", {
          provider: ctx.knowledge.id,
          query: config.query,
          scoring: "Unicode词项/中文二元词的逆文档频率加权覆盖率；非语义置信度。空查询不执行检索。",
          citations,
        });
        return { ...input, query: config.query, citations };
      },
    },
    {
      ...base,
      id: "evidence.record",
      name: "证据与审计记录",
      description: "真实保存规范化数据摘要及来源，运行事件保留前序哈希。",
      assets: await mapping("CAP-01", "SQLiteEvidenceAdapter"),
      permissions: ["evidence:write"],
      async execute(input, config, ctx) {
        ctx.evidence("source.snapshot", input);
        return input;
      },
    },
    {
      ...base,
      id: "runtime.snapshot",
      name: "执行状态快照",
      description:
        "读取并记录SQLite中的实际任务状态，不接受前端提供的from_state。",
      assets: await mapping("CAP-08", "PersistentStateAdapter"),
      permissions: ["evidence:write"],
      async execute(input, config, ctx) {
        const snapshot = ctx.snapshot();
        ctx.evidence("runtime.snapshot", snapshot);
        return { ...input, execution: snapshot };
      },
    },
    {
      ...base,
      id: "model.verify",
      name: "模型核验",
      description:
        "仅使用本平台明确配置的模型，并要求任务资料授权；保存真实返回、耗时与错误。",
      permissions: ["model:invoke", "data:external"],
      effects: ["external_data"],
      dependencies: () => [
        {
          id: "platform-model",
          ready: modelConfiguration().available,
          reason: modelConfiguration().reason,
        },
      ],
      async execute(input, config, ctx) {
        return { ...input, verification: await ctx.model(input) };
      },
    },
    {
      ...base,
      id: "knowledge.remote.search",
      name: "历史远程知识客户端",
      description: "历史客户端契约分叉，尚未适配或配置授权，不调用旧服务。",
      assets: await mapping("CAP-02", "UnconnectedRemoteKnowledgeProvider"),
      dependencies: () => [
        {
          id: "authorized-remote-knowledge",
          ready: false,
          reason: "历史远程知识接口未完成适配且未配置平台授权。",
        },
      ],
      async execute() {
        throw new ExecutionError(
          "KNOWLEDGE_UNAVAILABLE",
          "历史远程知识服务未接入。",
        );
      },
    },
    {
      ...base,
      id: "human.confirm",
      name: "人工确认",
      description: "输入摘要绑定的持久审批节点，批准才继续，拒绝/取消均终止。",
      kind: "human",
      approvalScope: "delivery",
      async execute(input) {
        return input;
      },
    },
    {
      ...base,
      id: "report.export",
      name: "结果报告导出",
      description:
        "审批后真实生成Markdown与结构化JSON文件，记录字节数和SHA-256。",
      permissions: ["file:write"],
      effects: ["local_file"],
      requiresApproval: true,
      approvalScope: "delivery",
      async execute(input: DocumentBundle, config, ctx) {
        if (input.checks?.some((c) => !c.passed))
          throw new ExecutionError("CHECKS_NOT_PASSED", "存在未通过的规则检查，已阻止交付。");
        const generatedAt = new Date().toISOString();
        const { execution, ...content } = input;
        const lines = [
          `# 资料核验报告`,
          `运行：${ctx.runId}`,
          `输入文件：${input.filename}`,
          `输入：1个文件，${input.documents.length}条资料段落记录。生成时间：${generatedAt}。`,
          `本文件在导出步骤生成；最终完成状态以同一运行的最终凭证为准：/v1/runs/${ctx.runId}/receipt。`,
          `\n## 规则核验`,
          ...(input.checks || []).map(
            (c) => `- ${c.name}：${c.status === "not_evaluated" ? "未核验" : c.passed ? "通过" : "需处理"}。${c.detail}`,
          ),
          `\n## 资料与来源`,
          ...input.documents.map(
            (d) => `### ${d.id}\n${d.text}\n\n来源：${d.source}`,
          ),
          `\n## 检索引用`,
          ...(input.citations || []).map(
            (c) => `- [${c.id}] ${c.excerpt}\n  来源：${c.source}`,
          ),
          `\n## AI核验`,
          input.verification
            ? `${input.verification.summary}\n结论：${input.verification.verdict}\n引用：${input.verification.citations.join("、")}`
            : "本任务未执行模型核验。以上是确定性解析、规则检查与本地词项检索结果，不构成AI验收。",
          `\n## 人工确认`,
          `本次输入已通过运行服务的人工确认节点；审批与证据见同一运行记录。`,
        ];
        await ctx.artifact(
          "核验报告.md",
          lines.join("\n\n"),
          "text/markdown; charset=utf-8",
        );
        await ctx.artifact(
          "核验数据.json",
          JSON.stringify({ runId: ctx.runId, artifactKind: "processing-result", generatedAt,
            finalStatusSource: `/v1/runs/${ctx.runId}/receipt`,
            intermediateExecutionSnapshot: execution || null, ...content }, null, 2),
          "application/json; charset=utf-8",
        );
        return input;
      },
    },
  ];
}
