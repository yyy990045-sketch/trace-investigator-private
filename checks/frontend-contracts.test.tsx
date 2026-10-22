import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AgentWorkspace } from "@personal/agent-ui";
import { BusinessWorkspace } from "@personal/business-ui";
import { demoRun } from "@personal/demo-fixture";
import type { RunView } from "@personal/capability-sdk";

const render = (element: React.ReactNode) =>
  renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>);
describe("Shared frontend accepts a different application record", () => {
  it("handles an empty step list without substituting demo success", () => {
    const html = render(
      <AgentWorkspace run={{ ...demoRun, id: "OTHER", steps: [] }} />,
    );
    expect(html).toContain("暂无处理步骤");
    expect(html).not.toContain("等待你的确认");
  });
  it("does not require a step named approval", () => {
    const run: RunView = {
      ...demoRun,
      id: "OTHER",
      agentHeading: "另一项独立任务",
      steps: [
        {
          id: "custom-normalize",
          kind: "process",
          title: "自定义处理",
          capability: "custom.normalize@2.0.0",
          state: "current",
          caption: "自定义路径",
          detail: "此处为另一份记录",
          evidence: ["MISSING"],
        },
      ],
      records: [],
    };
    const html = render(<AgentWorkspace run={run} />);
    expect(html).toContain("自定义处理");
    expect(html).toContain("另一项独立任务");
    expect(html).not.toContain("3 条示例记录");
    expect(html).not.toContain("等待你的确认");
  });
  it("renders a failed step as failed, without a completed badge", () => {
    const run: RunView = {
      ...demoRun,
      steps: [{ ...demoRun.steps[0], state: "failed" }],
    };
    expect(render(<AgentWorkspace run={run} />)).toContain("演示失败");
  });
  it("renders the actual object and concise result of a different record", () => {
    const run: RunView = {
      ...demoRun,
      id: "OTHER",
      records: [],
      evidence: [],
      result: {
        objectTitle: "第二份对象",
        workspaceHeading: "第二套成果结构",
        workspaceDescription: "独立描述",
        title: "另一份报告",
        introduction: "独立成果说明",
        sections: [{ title: "新增章节", body: "这不是旧报告" }],
      },
    };
    const html = render(<BusinessWorkspace run={run} />);
    for (const text of ["第二份对象", "另一份报告", "独立成果说明"])
      expect(html).toContain(text);
    expect(html).not.toContain("中性资料核验包");
    expect(html).not.toContain("需要关注的要点");
  });
  it("does not offer confirmation on failed or unplanned business records", () => {
    for (const steps of [
      [],
      [{ ...demoRun.steps[0], state: "failed" as const }],
    ]) {
      const html = render(<BusinessWorkspace run={{ ...demoRun, steps }} />);
      expect(html).not.toContain("演示 · 等待确认");
      expect(html).toContain("审阅入口暂不可用");
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?审阅成果/);
      expect(html).toContain(
        steps.length ? "演示 · 处理失败" : "内容预览 · 示例",
      );
    }
  });
});
