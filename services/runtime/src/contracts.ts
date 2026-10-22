import type {
  ArtifactRecord,
  AssetLink,
  DocumentBundle,
  DocumentItem,
  Citation,
} from "@personal/capability-sdk";
export type Schema = Record<string, any>;
export const uploadSchema: Schema = {
  type: "object",
  required: ["filename", "text"],
  properties: {
    filename: { type: "string", minLength: 1, maxLength: 180 },
    text: { type: "string", minLength: 1, maxLength: 262144 },
    modelConsent: { type: "boolean" },
  },
  additionalProperties: false,
};
export const bundleSchema: Schema = {
  type: "object",
  required: ["filename", "documents", "claims"],
  properties: {
    filename: { type: "string" },
    documents: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "text", "source", "scope"],
        properties: {
          id: { type: "string", minLength: 1 },
          text: { type: "string", minLength: 1 },
          source: { type: "string", minLength: 1 },
          scope: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "value", "source"],
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          source: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    modelConsent: { type: "boolean" },
  },
  additionalProperties: true,
};
export const emptyConfig: Schema = {
  type: "object",
  additionalProperties: false,
};
export interface ExecutionContext {
  runId: string;
  stepId: string;
  projectId: string;
  signal: AbortSignal;
  evidence(kind: string, data: unknown): void;
  artifact(
    filename: string,
    content: string,
    mime: string,
  ): Promise<ArtifactRecord>;
  snapshot(): unknown;
  model(input: DocumentBundle): Promise<DocumentBundle["verification"]>;
  knowledge: KnowledgeProvider;
}
export interface KnowledgeProvider {
  id: string;
  search(
    query: string,
    documents: DocumentItem[],
    limit: number,
    signal: AbortSignal,
  ): Promise<Citation[]>;
}
export interface CapabilityDefinition {
  id: string;
  version: string;
  name: string;
  description: string;
  inputProtocol: string;
  outputProtocol: string;
  inputSchema: Schema;
  outputSchema: Schema;
  configSchema: Schema;
  defaultConfig: Record<string, unknown>;
  permissions: string[];
  effects: ("none" | "local_file" | "external_write" | "external_data")[];
  kind: "tool" | "human";
  requiresApproval?: boolean;
  approvalScope?: string;
  idempotent: boolean;
  dependencies?: () => { id: string; ready: boolean; reason: string }[];
  assets: AssetLink[];
  execute: (input: any, config: any, ctx: ExecutionContext) => Promise<any>;
}
export class ExecutionError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
