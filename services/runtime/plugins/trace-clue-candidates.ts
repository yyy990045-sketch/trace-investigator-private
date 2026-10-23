/**
 * trace.clue.candidates —— 从真实检索结果中发现候选，并逐条比对线索。
 *
 * 这里不产生「结论」以外的推断：候选名称必须出现在真实网页里，
 * 每条命中的线索都要能指到一句原文；找不到就标「尚未核实」。
 * 是否继续检索、要不要问用户，也在这一步给出可执行的理由。
 */
import { type CapabilityDefinition } from "../src/contracts.ts";
import { TRACE_VERSION, traceBundleSchema } from "../adapters/trace/bundle.ts";
import {
  detectTargetKind,
  evaluateCandidates,
  extractCandidates,
  type BodyLike,
  type ClueItem,
  type PageLike,
} from "../adapters/trace/clues.ts";

const configSchema = { type: "object", additionalProperties: false };

export default {
  id: "trace.clue.candidates",
  version: "1.0.0",
  name: "候选发现与线索比对",
  description:
    "从检索结果中提取候选名称，逐条比对用户线索，标注命中证据与尚未核实的条件，并给出继续检索或补充线索的建议。",
  inputProtocol: TRACE_VERSION,
  outputProtocol: TRACE_VERSION,
  inputSchema: traceBundleSchema,
  outputSchema: traceBundleSchema,
  configSchema,
  defaultConfig: {},
  permissions: ["document:read", "evidence:write"],
  effects: ["none"],
  kind: "tool",
  idempotent: true,
  assets: [],
  async execute(input: any, _config, ctx) {
    const pages = (input.pages || []) as PageLike[];
    const bodyTexts = (input.bodyTexts || {}) as Record<string, { ok: boolean; text: string }>;
    const bodies = new Map<string, BodyLike>(Object.entries(bodyTexts));
    const clues = ((input.case?.clues || []) as ClueItem[]).filter((clue) => clue?.text);
    const extra = Array.isArray(input.case?.extraClues) ? (input.case.extraClues as ClueItem[]) : [];
    const allClues = [...clues, ...extra];

    const raw = extractCandidates(pages, bodies, [...new Set(allClues.flatMap((clue) => clue.terms || []))]);
    // 用户找的是剧、书还是人？决定哪些候选只是关系项（原著/角色/续作），不参与排名。
    const targetKind = detectTargetKind(String(input.case?.question || input.case?.goal || ""));
    const { candidates, relations, graph, pending, decision } = evaluateCandidates(raw, allClues, pages, bodies, targetKind, String(String(input.case?.question || "") || ""));

    ctx.evidence("trace.candidates", {
      goal: input.case?.goal || input.case?.question || "",
      clues: allClues.map((clue) => ({ id: clue.id, text: clue.text, terms: clue.terms, kind: clue.kind })),
      pageCount: pages.length,
      candidates: candidates.map((candidate) => ({
        name: candidate.name,
        mentions: candidate.mentions,
        sites: candidate.sites,
        matchedClues: candidate.matchedClues,
        missingClues: candidate.missingClues,
        matches: candidate.matches,
        pages: candidate.pages,
      })),
      targetKind,
      graph,
      pending,
      relations: relations.map((item) => ({
        name: item.name,
        kind: item.entity?.kind || "unknown",
        role: item.entity?.role || "unconfirmed",
        reason: item.entity?.reason || "",
        sentence: item.entity?.sentence || "",
        url: item.entity?.url || item.pages[0]?.url || "",
        site: item.entity?.site || item.pages[0]?.site || "",
      })),
      decision,
      note: "候选来自本次真实检索结果；命中要求候选与线索在同一句里共现，未命中记为尚未核实。原著、角色、续作只作关系展示，不参与竞争。",
    });

    const best = candidates[0];
    const checks = [
      ...(input.checks || []).filter((item: any) => !["候选发现", "线索比对", "结论完备性"].includes(item.name)),
      {
        name: "候选发现",
        passed: candidates.length > 0,
        status: candidates.length ? ("passed" as const) : ("not_evaluated" as const),
        detail: candidates.length
          ? `从 ${pages.length} 条网页中读出 ${candidates.length} 个候选：${candidates.map((item) => item.name).join("、")}。`
          : `检索到 ${pages.length} 条网页，但没有读出可核对的候选名称。`,
      },
      {
        name: "线索比对",
        passed: Boolean(best && best.matchedClues > 0),
        status: best && best.matchedClues > 0 ? ("passed" as const) : ("not_evaluated" as const),
        detail: best
          ? `最接近的是「${best.name}」：${best.matchedClues}/${allClues.length} 条线索在同一句里找到证据${
              best.missingClues.length ? `；还没核实：${best.missingClues.join("、")}` : ""
            }。`
          : "没有候选可以逐条比对。",
      },
      {
        name: "结论完备性",
        passed: decision.state === "found",
        status: decision.state === "found" ? ("passed" as const) : ("not_evaluated" as const),
        detail: `${decision.headline}。${
          decision.state === "ambiguous"
            ? "有多个候选都能对上部分线索，未给出确定排名。"
            : decision.state === "insufficient"
              ? "证据还不足以给出答案。"
              : ""
        }`,
      },
    ];

    return {
      ...input,
      assessment: {
        mode: "clue",
        targetKind,
        clues: allClues,
        candidates,
        relations,
        graph,
        pending,
        decision,
        pageCount: pages.length,
        bodyAvailable: (input.bodies || []).filter((body: any) => body.ok).length,
      },
      claims: [
        { key: "investigation-goal", value: String(input.case?.goal || input.case?.question || ""), source: "case-question" },
        ...candidates.slice(0, 3).flatMap((candidate) =>
          candidate.matches
            .filter((match) => match.found)
            .slice(0, 2)
            .map((match, index) => ({
              key: `candidate:${candidate.name}:${index + 1}`,
              value: match.sentence,
              source: pages.find((page) => page.url === match.url)?.id || "case-question",
            })),
        ),
      ],
      checks,
    };
  },
} satisfies CapabilityDefinition;
