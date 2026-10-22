import type { RunView } from "@personal/capability-sdk";

// Explicit design fixture, never inserted into the runtime's real task/history tables.
export const demoRun: RunView = {
  id: "DEMO-20261021-01",
  title: "把零散资料，整理成一份可靠的交付",
  subtitle: "中性资料核验 · 结构化记录与交付摘要",
  isDemo: true,
  createdAt: "2026-10-21",
  agentHeading: "资料核验与交付",
  agentDescription: "把资料整理清楚，让每一个判断都有依据。",
  result: {
    objectTitle: "中性资料核验包",
    workspaceHeading: "让资料成为清晰的成果",
    workspaceDescription: "先看交付内容，再决定下一步。",
    title: "资料处理范围\n与交付安排",
    introduction:
      "资料已按范围界定、来源核对和确认交付三项工作整理。请核对处理范围与来源，再决定是否生成正式报告。",
    sections: [
      {
        title: "本次整理范围",
        body: "资料范围界定、记录与来源核对、确认及交付摘要。共 3 份示例资料，形成 3 条示例记录。",
      },
      {
        title: "需要关注的要点",
        items: [
          "每条记录保留来源，避免结论脱离原始资料。",
          "明确责任人与时间，便于后续确认。",
          "人工确认后再生成正式交付文件。",
        ],
      },
    ],
  },
  input:
    "资料 A：界定本轮处理范围，责任人为资料整理者，完成时间为 10 月 24 日。\n资料 B：核对来源与记录字段，责任人为核验者，完成时间为 10 月 25 日。\n资料 C：汇总核验结论，责任人为确认者，完成时间为 10 月 26 日。",
  steps: [
    {
      id: "structure",
      kind: "process",
      shortTitle: "整理",
      title: "整理资料",
      capability: "records.structure@1.0.0",
      state: "complete",
      caption: "3 份资料 → 3 条结构化记录",
      detail:
        "将原始资料整理为可阅读的记录，保留来源位置。此处为固定演示内容，尚未调用处理能力。",
      duration: "演示",
      evidence: ["EV-DEMO-01"],
    },
    {
      id: "validate",
      kind: "process",
      shortTitle: "核验",
      title: "核对规则",
      capability: "records.validate@1.0.0",
      state: "complete",
      caption: "必填信息、重复项与来源关联",
      detail:
        "核对资料标题、责任人、完成时间及来源关系。示例中的规则结果仅用于页面审阅，不代表后端核验通过。",
      duration: "演示",
      evidence: ["EV-DEMO-02"],
    },
    {
      id: "summarize",
      kind: "process",
      shortTitle: "摘要",
      title: "形成摘要",
      capability: "records.summarize@1.0.0",
      state: "complete",
      caption: "整理范围、待办与交付要点",
      detail:
        "为人工确认提供结构化摘要。当前为规则处理的演示预览，未调用模型。",
      duration: "演示",
      evidence: ["EV-DEMO-01", "EV-DEMO-02"],
    },
    {
      id: "approval",
      kind: "confirmation",
      shortTitle: "确认",
      title: "等待你的确认",
      capability: "human.confirmation",
      state: "current",
      caption: "检查资料与规则结果，再决定下一步",
      detail:
        "真实运行时，只有明确批准后才会生成正式报告。本轮按钮仅演示交互，不创建审批记录。",
      evidence: ["EV-DEMO-02"],
    },
    {
      id: "report",
      kind: "delivery",
      shortTitle: "报告",
      title: "生成交付报告",
      capability: "report.export@1.0.0",
      state: "pending",
      caption: "确认后生成报告与证据文件",
      detail:
        "运行服务接入后生成可真实下载的报告；当前仅提供带演示标注的内容预览。",
      evidence: [],
    },
  ],
  records: [
    {
      id: "R-01",
      title: "明确资料处理范围",
      source: "资料 A · 第 1 段",
      owner: "资料整理者",
      due: "10 月 24 日",
      outcome: "界定本轮资料处理范围，明确本次核验与交付的边界。",
    },
    {
      id: "R-02",
      title: "核对记录与来源",
      source: "资料 B · 第 1 段",
      owner: "核验者",
      due: "10 月 25 日",
      outcome: "核对记录字段与来源，确保每条记录都能回到原始资料。",
    },
    {
      id: "R-03",
      title: "形成确认与交付摘要",
      source: "资料 C · 第 1 段",
      owner: "确认者",
      due: "10 月 26 日",
      outcome: "汇总核验结论，完成人工确认后再生成交付报告。",
    },
  ],
  evidence: [
    {
      id: "EV-DEMO-01",
      title: "原始资料与结构化记录",
      description: "3 份中性示例资料，保留段落定位",
      source: "演示资料 A–C",
      content:
        "三份示例资料分别定义范围、核验与确认。每条记录都保留其来源段落。\n\n这是用于前端布局检查的固定演示资料，不是运行引擎输出。",
    },
    {
      id: "EV-DEMO-02",
      title: "规则核验说明",
      description: "必填字段、重复标识与来源关系",
      source: "演示规则说明",
      content:
        "预览规则：标题不为空；每条记录有责任人及完成时间；记录标识不重复；每条记录有来源。\n\n此处未执行后端核验，不构成通过证据。",
    },
  ],
};
