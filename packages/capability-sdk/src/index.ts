export type StepState = "complete" | "current" | "pending" | "failed";
export interface RunStep {
  id: string;
  kind: "process" | "confirmation" | "delivery";
  title: string;
  shortTitle?: string;
  capability: string;
  state: StepState;
  caption: string;
  detail: string;
  duration?: string;
  evidence: string[];
}
export interface SourceRecord {
  id: string;
  title: string;
  source: string;
  owner: string;
  due: string;
  outcome: string;
}
export interface EvidenceItem {
  id: string;
  title: string;
  description: string;
  source: string;
  content: string;
}
export interface RunView {
  id: string;
  title: string;
  subtitle: string;
  isDemo: true;
  input: string;
  createdAt: string;
  steps: RunStep[];
  records: SourceRecord[];
  evidence: EvidenceItem[];
  agentHeading: string;
  agentDescription: string;
  result: {
    objectTitle: string;
    workspaceHeading: string;
    workspaceDescription: string;
    title: string;
    introduction: string;
    sections: { title: string; body?: string; items?: string[] }[];
  };
}
export interface RuntimeClient {
  getRun(id: string, signal?: AbortSignal): Promise<RunView>;
  // Implemented only when services/runtime is connected; preview apps do not fabricate it.
}
export interface AssetSummary {
  id: string;
  name: string;
  category: string;
  sources: string[];
  reuseScope: string;
  sourceVerified: boolean;
  integration: "not_integrated";
}
export interface PortfolioSummary {
  version: string;
  sha256: string;
  counts: { projects: number; capabilities: number; ui: number };
  assets: AssetSummary[];
}

export * from './runtime';
