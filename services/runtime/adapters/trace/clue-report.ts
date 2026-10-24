/**
 * 线索调查的结果导出（当前状态快照）。
 *
 * 为什么单独放一个渲染器：事实核验的档案走「人工确认 → 版本冻结」的
 * trace.archive.export，而线索调查没有那条审批链，用户结束调查后需要一个
 * 能保存下来的记录。这里复用同一份 assessment 数据渲染 Markdown/JSON，
 * 内容与当前已保存的调查状态一致，不另建档案系统、不改历史档案。
 */
import type { ClueAssessment } from "../../src/trace-clue.ts";

export interface ClueReportInput {
  runId: string;
  question: string;
  generatedAt: string;
  clue: ClueAssessment;
  searches: { query: string; resultCount?: number; at?: string; kind?: string }[];
  followups: { query: string; reason?: string; at?: string }[];
}

const stateLabel: Record<string, string> = {
  found: "已确认",
  ambiguous: "最可能（尚未排除其他候选）",
  insufficient: "证据不足",
};

export function renderClueReport(input: ClueReportInput): {
  markdown: string;
  json: string;
  markdownFilename: string;
  jsonFilename: string;
} {
  const { runId, question, generatedAt, clue, searches, followups } = input;
  const decision = clue.decision;
  const best = clue.candidates[0];
  const lines: string[] = [
    `# 线索调查记录：${question}`,
    "",
    `- 运行 ID：${runId}`,
    `- 记录生成时间：${generatedAt}（当前已保存状态快照，不是版本冻结档案）`,
    `- 判断状态：**${stateLabel[decision.state] || decision.state}**`,
    `- 结论：${decision.headline || "（没有形成结论文本）"}`,
  ];
  if (decision.bestGuess) lines.push(`- 最可能答案：${decision.bestGuess}`);
  if (best) {
    lines.push(
      `- 线索命中：${best.matchedClues}/${clue.clues.length}`,
      `- 已核实线索：${(best.matches || []).filter((m) => m.found).map((m) => m.clue).join("、") || "无"}`,
      `- 待核实线索：${best.missingClues.join("、") || "无"}`,
    );
  }
  if (decision.evidenceLimit) lines.push(`- 证据限制：${decision.evidenceLimit}`);
  if (decision.conflicts?.length) {
    lines.push("", "## 与资料不一致的记忆");
    for (const item of decision.conflicts) {
      lines.push(
        `- 你说的是「${item.clue}」，资料关于《${item.candidate}》的原文：「${item.quote}」（${item.site || item.url}）`,
      );
    }
  }
  if (best) {
    // 与页面一致的噪声判定：播放页/合集页标题式摘要不是剧情原句，导出时也要标出来。
    const NOISE = /(播放|一口气|合集|全集|在线观看|\d+\s*集|资源|下载|完整版|\d{1,2}\s*:\s*\d{2})/;
    const plot: typeof best.matches = [];
    const secondary: typeof best.matches = [];
    const seen = new Set<string>();
    for (const match of best.matches || []) {
      if (!match.found || !match.sentence) continue;
      const key = match.sentence.slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      (NOISE.test(match.sentence) ? secondary : plot).push(match);
    }
    if (plot.length) {
      lines.push("", "## 关键依据（剧情原句）");
      for (const match of plot) {
        lines.push(
          `- 线索「${match.clue}」：「${match.sentence}」`,
          `  - 来源：${match.site || "未标注站点"}（${match.from === "body" ? "原文正文" : "搜索摘要"}）`,
          `  - 链接：${match.url || "（无）"}`,
        );
      }
    } else {
      lines.push("", "## 关键依据", "", "本次没有取得能直接说明剧情的原句，下面只有页面摘要。");
    }
    if (secondary.length) {
      lines.push("", "## 次级来源（页面摘要，非剧情原句）");
      for (const match of secondary) {
        lines.push(
          `- 线索「${match.clue}」：「${match.sentence}」`,
          `  - 来源：${match.site || "未标注站点"}（搜索摘要，非剧情原句）`,
          `  - 链接：${match.url || "（无）"}`,
        );
      }
    }
  }
  if (clue.candidates.length) {
    lines.push("", "## 候选");
    for (const candidate of clue.candidates.slice(0, 5)) {
      lines.push(
        `- ${candidate.name}（${candidate.type || "类型未标注"}）：命中 ${candidate.matchedClues} 条，缺 ${candidate.missingClues.length} 条${
          candidate.missingClues.length ? `（${candidate.missingClues.join("、")}）` : ""
        }`,
      );
    }
  }
  if (searches.length) {
    lines.push("", "## 检索记录");
    for (const round of searches) {
      lines.push(`- 「${round.query}」返回 ${round.resultCount ?? 0} 条`);
    }
  }
  if (followups.length) {
    lines.push("", "## 追加检索");
    for (const round of followups) {
      lines.push(`- 「${round.query}」${round.reason ? `：${round.reason}` : ""}`);
    }
  }
  lines.push("", "---", "以上内容来自本次调查已保存的检索结果与原句，没有补写任何未查到的信息。");

  const markdown = lines.join("\n") + "\n";
  const json = JSON.stringify(
    {
      runId,
      question,
      generatedAt,
      state: decision.state,
      headline: decision.headline,
      bestGuess: decision.bestGuess ?? null,
      clues: clue.clues,
      unverified: best?.missingClues ?? [],
      conflicts: decision.conflicts ?? [],
      candidates: clue.candidates.slice(0, 5).map((candidate) => ({
        name: candidate.name,
        type: candidate.type,
        matchedClues: candidate.matchedClues,
        missingClues: candidate.missingClues,
        matches: (candidate.matches || [])
          .filter((match) => match.found)
          .map((match) => ({
            clue: match.clue,
            sentence: match.sentence,
            site: match.site,
            url: match.url,
            from: match.from,
          })),
      })),
      searches,
      followups,
    },
    null,
    2,
  );
  const base = `trace-${runId}-clue-report`;
  return { markdown, json, markdownFilename: `${base}.md`, jsonFilename: `${base}.json` };
}
