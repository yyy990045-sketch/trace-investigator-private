import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check, History, X } from "lucide-react";
import {
  SHOWCASE,
  fetchRunExperiences,
  postExperienceUsage,
  type ExperienceHint,
  type ExperienceUsage,
} from "./api";

/**
 * 「这次调查参考了哪些历史经验？」
 *
 * 只展示已确认的、被规则匹配到的历史调查经验：说明历史错在哪、本次该检查什么。
 * 经验不是证据，不参与支持/反证计数；这里也没有任何「准确率提升」的说法。
 */
export function ExperienceReuse({ runId, hints }: { runId: string; hints?: ExperienceHint[] }) {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["run-experiences", runId],
    queryFn: () => fetchRunExperiences(runId),
    // 即使页面已带上匹配结果，也要读使用记录：采纳/忽略的结果需要显示出来。
    enabled: true,
  });
  const matched = (hints ?? query.data?.hints ?? []) as ExperienceHint[];
  const usage = new Map<string, ExperienceUsage>(
    (query.data?.usage ?? []).map((item: ExperienceUsage) => [item.experienceId, item]),
  );
  // 没有相关经验时不显示空模块。
  if (!matched.length) return null;

  async function decide(experienceId: string, decision: "accepted" | "ignored") {
    await postExperienceUsage(runId, { experienceId, decision });
    await cache.invalidateQueries({ queryKey: ["run-experiences", runId] });
  }

  return (
    <section className="trace-experience" aria-label="参考的历史经验">
      <header className="trace-experience-head">
        <History size={15} />
        <h2>这次调查参考了哪些历史经验</h2>
        <span className="trace-experience-count">{matched.length} 条已确认经验</span>
      </header>
      {matched.map((hint) => {
        const decided = usage.get(hint.experienceId);
        return (
          <article key={hint.experienceId} className="trace-experience-card">
            <div className="trace-experience-title">
              <b>{hint.title}</b>
              <span className="trace-experience-kind">{hint.kindLabel}</span>
            </div>
            <dl className="trace-experience-fields">
              <div>
                <dt>为什么认为可能适用</dt>
                <dd>
                  {hint.matchReasons.map((reason) => (
                    <span key={reason}>{reason}</span>
                  ))}
                  <em>历史说法：{hint.sourceClaim}</em>
                </dd>
              </div>
              <div>
                <dt>历史犯过什么错误</dt>
                <dd>{hint.wrongJudgment}</dd>
              </div>
              <div>
                <dt>推荐检查的条件</dt>
                <dd>
                  <ol>
                    {hint.checkPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ol>
                </dd>
              </div>
              <div>
                <dt>适用边界</dt>
                <dd>{hint.limits}</dd>
              </div>
            </dl>
            <div className="trace-experience-foot">
              <div className="trace-experience-links">
                {hint.sourceRunIds.slice(0, 2).map((sourceRunId, index) => (
                  <Link key={sourceRunId} className="plain-link" to={"/cases/" + sourceRunId}>
                    查看原始案例{index > 0 ? ` ${index + 1}` : ""}
                  </Link>
                ))}
              </div>
              {decided ? (
                <span className="trace-experience-decided" data-decision={decided.decision || ""}>
                  {decided.decision === "accepted" ? "已采纳为检查清单" : "已忽略"}
                  {decided.actualJudgment ? ` · 本次实际判断 ${decided.actualJudgment}` : ""}
                  {` · 是否真的起了作用：${decided.helped === "unknown" ? "未知" : decided.helped}`}
                </span>
              ) : SHOWCASE ? (
                <span className="trace-experience-decided">只读展示：不记录采纳或忽略</span>
              ) : (
                <div className="trace-experience-actions">
                  <button className="trace-btn trace-btn-quiet" onClick={() => void decide(hint.experienceId, "accepted")}>
                    <Check size={13} /> 采纳
                  </button>
                  <button className="trace-btn trace-btn-quiet" onClick={() => void decide(hint.experienceId, "ignored")}>
                    <X size={13} /> 忽略
                  </button>
                </div>
              )}
            </div>
            <p className="trace-experience-note">
              经验只作为检查提示：它不改变支持/反证计数，也不能代替本次真实来源。
            </p>
          </article>
        );
      })}
    </section>
  );
}
