import { useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  bundleOf,
  followupsOf,
  outcomeText,
  relationText,
  stepOf,
  type FactAssessment,
  type FollowupRecord,
} from "./api";
import { archiveHref, formatTime } from "./components";

type Step = {
  key: string;
  title: string;
  answer: string;
  facts: string[];
  link?: { href: string; label: string };
};

/**
 * 把调查过程讲成一个能听懂的故事：只讲真实记录里的内容。
 * 五步：提出什么说法 → 查到了什么 → 为什么继续查 → 追到了什么 → 最后怎么判断。
 */
export function InvestigationStory({
  run,
  assessment,
  revisions,
}: {
  run: Parameters<typeof bundleOf>[0];
  assessment: { facts?: FactAssessment[]; verdict?: any; independentSources?: number; bodyAvailable?: number; openQuestions?: string[] } | null | undefined;
  revisions?: { revisions: { revision: number; changes: string[]; correctionCount: number; followupCount: number }[] } | null;
}) {
  const [open, setOpen] = useState<string | null>("what");
  const bundle = bundleOf(run);
  const intake = stepOf(run, "trace.case.intake")?.output as
    | { case?: { question?: string; claim?: string } }
    | undefined;
  const facts = (assessment?.facts || []) as FactAssessment[];
  const verdict = assessment?.verdict;
  const followups: FollowupRecord[] = followupsOf(run);
  const corrections = run.evidence
    .filter((item) => item.kind === "trace.correction")
    .map((item) => item.data as { note: string; relation: string; actor: string; at: string; impact?: { sourceBefore?: string; supportsBefore: number; supportsAfter: number; verdictBefore: string; verdictAfter: string } });
  const sources = facts.flatMap((fact) => fact.sources || []);
  const keyEvidence = [...sources]
    .filter((source) => source.relation === "supports")
    .sort((a, b) => Number(b.bodyAvailable) - Number(a.bodyAvailable))
    .slice(0, 2);
  const cannotProve = sources
    .filter((source) => source.relation === "unclear" || source.independence === "unconfirmed")
    .slice(0, 2);
  const claim = intake?.case?.claim || intake?.case?.question || run.input?.text || "这次调查的说法";
  const question = intake?.case?.question || claim;
  const counts = verdict?.counts;
  const latestChanges = revisions?.revisions?.[revisions.revisions.length - 1]?.changes || [];

  const steps: Step[] = [
    {
      key: "what",
      title: "1 · 这次要查什么",
      answer: claim,
      facts: [`原始提问：${question}`, "事实与检索式由人工确认，系统不替用户决定要查什么。"],
    },
    {
      key: "found",
      title: "2 · 系统查到了什么",
      answer: `${counts?.pages ?? sources.length} 条网页，其中 ${assessment?.independentSources ?? 0} 个未检测到重复、${assessment?.bodyAvailable ?? 0} 份拿到原文正文`,
      facts: [
        `判为支持 ${facts.reduce((sum, fact) => sum + (fact.supports || 0), 0)} 条、反对 ${facts.reduce((sum, fact) => sum + (fact.contradicts || 0), 0)} 条、无法确认 ${facts.reduce((sum, fact) => sum + (fact.unclear || 0), 0)} 条`,
        ...keyEvidence.map(
          (source) =>
            `关键证据：${source.site}「${source.title}」${source.bodyAvailable ? "（已取原文正文）" : "（仅搜索摘要）"}`,
        ),
      ],
      link: keyEvidence[0] ? { href: keyEvidence[0].url, label: "打开这条证据的原始网页" } : undefined,
    },
    {
      key: "why",
      title: "3 · 为什么还要继续查",
      answer: followups.length
        ? `因为现有证据还回答不了说法里的关键限定，用户换了检索式再查一次`
        : "本轮没有追加检索：一次检索就足以形成判断",
      facts: [
        ...(cannotProve.length
          ? cannotProve.map(
              (source) =>
                `不能证明的部分：${source.site}「${source.title}」只写到${source.relation === "unclear" ? "相关情况" : "局部事实"}，没有直接支持整句说法`,
            )
          : ["没有明显无法确认的来源。"]),
        ...(followups[0] ? [`追加的检索式：${followups[0].query}（真实联网检索）`] : []),
      ],
    },
    {
      key: "then",
      title: "4 · 追到了什么、判断怎么变",
      answer: followups.length
        ? `追加检索带回 ${followups.reduce((sum, item) => sum + (item.pages?.length || 0), 0)} 条新网页，结论按同一套规则重算`
        : "没有新的追加检索，判断只受人工修正影响",
      facts: [
        ...latestChanges.slice(0, 4),
        ...corrections
          .slice(0, 2)
          .map(
            (correction) =>
              `人工修正：${relationText[correction.impact?.sourceBefore as keyof typeof relationText] || "原判断"} → ${relationText[correction.relation as keyof typeof relationText] || correction.relation}（${correction.note}）`,
          ),
      ],
    },
    {
      key: "result",
      title: "5 · 最后怎么判断",
      answer: verdict ? `${outcomeText[verdict.outcome as keyof typeof outcomeText]}：${String(verdict.statement || "").replace(/^就「.*?」而言，/, "")}` : "还没有形成结论",
      facts: [
        ...(assessment?.openQuestions?.length
          ? assessment.openQuestions.slice(0, 3).map((item) => `还缺：${item}`)
          : ["规则未列出额外缺口，原始出处仍需核对。"]),
        `最近一次交付：${revisions?.revisions?.length ? `第 ${revisions.revisions[revisions.revisions.length - 1].revision} 版` : "尚未成档"}`,
      ],
      link: { href: archiveHref(run.id), label: "查看完整调查档案" },
    },
  ];

  return (
    <section className="story" aria-label="调查经过">
      <div className="story-head">
        <h2>这次调查是怎么走过来的</h2>
        <span>五步，全部来自真实记录 · 点标题展开</span>
      </div>
      <ol className="story-steps">
        {steps.map((step) => {
          const isOpen = open === step.key;
          return (
            <li key={step.key} data-open={isOpen ? "true" : "false"}>
              <button type="button" className="story-step-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : step.key)}>
                <span className="story-step-title">{step.title}</span>
                <span className="story-step-answer">{step.answer}</span>
              </button>
              {isOpen ? (
                <div className="story-step-body">
                  <ul>
                    {step.facts.filter(Boolean).map((fact, index) => (
                      <li key={index}>{fact}</li>
                    ))}
                  </ul>
                  {step.link ? (
                    <a className="trace-link" href={step.link.href} target={step.link.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer noopener">
                      {step.link.label} <ArrowRight size={13} />
                    </a>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="story-foot">
        立案 {formatTime(run.createdAt)} · 只读回放不会发起新的检索；需要自己提问请在本机运行 Runtime。
      </p>
    </section>
  );
}
