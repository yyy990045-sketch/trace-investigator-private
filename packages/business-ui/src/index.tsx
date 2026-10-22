import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Download,
  FileText,
  ChevronRight,
  ShieldCheck,
  ArrowUpRight,
  CircleAlert,
} from "lucide-react";
import type { RunView, SourceRecord } from "@personal/capability-sdk";
import {
  Badge,
  Button,
  DemoNotice,
  Modal,
  EmptyState,
  downloadPreview,
  ContentReviewList,
} from "@personal/ui-core";

/** A business module, independent from the product's navigation shell. */
export function BusinessWorkspace({
  run,
  counterpartHref,
  spaceName,
}: {
  run: RunView;
  counterpartHref?: string;
  spaceName?: string;
}) {
  const [panel, setPanel] = useState<
    "report" | "sources" | "review" | "details" | null
  >(null);
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const failed = run.steps.some((s) => s.state === "failed");
  const canReview =
    !failed &&
    run.steps.some((s) => s.kind === "confirmation" && s.state === "current");
  useEffect(() => {
    setPanel(null);
    setNote("");
    setChecked(false);
  }, [run.id]);
  const exportPreview = () =>
    downloadPreview(
      `演示-${run.result.objectTitle}.txt`,
      [
        "演示数据 · 前端审核用，不是执行报告",
        run.id,
        run.result.objectTitle,
        run.result.title,
        run.result.introduction,
        ...run.result.sections.map((s) =>
          [s.title, s.body, ...(s.items || [])].filter(Boolean).join("\n"),
        ),
        "资料记录",
        ...run.records.map(
          (r) =>
            `${r.title} | ${r.outcome} | ${r.owner} | ${r.due} | ${r.source}`,
        ),
        "未执行后端核验、人工审批或模型调用。",
      ].join("\n\n"),
    );
  const close = () => {
    setPanel(null);
    setChecked(false);
    setNote("");
  };
  return (
    <div className="page business-page">
      <div className="object-heading">
        <div>
          <div className="context-line">
            {spaceName || "成果工作室"}
            <span>/</span>资料成果
          </div>
          <h1>{run.result.objectTitle}</h1>
        </div>
        <Badge tone={failed ? "red" : canReview ? "amber" : "neutral"}>
          {failed
            ? "演示 · 处理失败"
            : canReview
              ? "待审阅 · 示例"
              : "内容预览 · 示例"}
        </Badge>
      </div>
      <div className="preview-strip">
        <DemoNotice />
        <button className="plain-link" onClick={() => setPanel("details")}>
          记录详情 <ChevronRight size={14} />
        </button>
      </div>
      <section className="outcome-workspace" aria-label="当前成果">
        <div className="outcome-toolbar">
          <span className="section-kicker">当前成果 · 草稿</span>
          <Button variant="ghost" size="sm" onClick={exportPreview}>
            <Download size={15} />
            导出预览
          </Button>
        </div>
        <h2 className="outcome-title">
          {run.result.title.replaceAll("\n", " ")}
        </h2>
        <p className="outcome-intro">{run.result.introduction}</p>
        <div className="next-decision">
          <div>
            <span className="next-label">下一步</span>
            <p>
              {failed
                ? "处理步骤失败，先检查输入与错误。"
                : canReview
                  ? "核对资料后，确认是否进入报告生成。"
                  : "这条记录没有待确认事项。"}
            </p>
          </div>
          <Button
            disabled={!canReview}
            title={
              canReview
                ? undefined
                : failed
                  ? "步骤失败，无法审阅"
                  : "没有待确认节点"
            }
            onClick={() => setPanel("review")}
          >
            <ShieldCheck size={16} />
            审阅成果
          </Button>
        </div>
        {!canReview && (
          <p className="field-help">审阅入口暂不可用；未生成正式报告。</p>
        )}
      </section>
      <div className="outcome-support">
        <Button variant="secondary" onClick={() => setPanel("report")}>
          <FileText size={16} />
          查看完整报告
        </Button>
        <Button variant="ghost" onClick={() => setPanel("sources")}>
          依据与来源 ({run.evidence.length})<ArrowUpRight size={15} />
        </Button>
        {counterpartHref && (
          <Link className="plain-link" to={counterpartHref}>
            查看处理过程 <ArrowRight size={14} />
          </Link>
        )}
      </div>
      {panel && (
        <Modal
          title={
            panel === "report"
              ? "报告内容预览"
              : panel === "review"
                ? "成果审阅 · 交互预览"
                : panel === "sources"
                  ? "依据与来源"
                  : "记录详情"
          }
          wide={panel === "report" || panel === "review"}
          onClose={close}
        >
          {panel === "report" && (
            <article className="full-report">
              <Badge>固定演示稿 · 非正式交付</Badge>
              <h2>{run.result.title.replaceAll("\n", " ")}</h2>
              <p>{run.result.introduction}</p>
              {run.result.sections.map((section, i) => (
                <section key={i}>
                  <h3>{section.title}</h3>
                  {section.body && <p>{section.body}</p>}
                  {section.items && (
                    <ul>
                      {section.items.map((item, j) => (
                        <li key={j}>{item}</li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
              <p className="field-help">未执行核验、模型调用或正式报告生成。</p>
            </article>
          )}
          {panel === "sources" && (
            <>
              <p className="muted-note">来源仅用于界面审阅，不构成运行证据。</p>
              {run.evidence.length ? (
                run.evidence.map((item) => (
                  <details className="source-disclosure" key={item.id}>
                    <summary>
                      <FileText size={17} />
                      <span>
                        {item.title}
                        <small>{item.source}</small>
                      </span>
                      <ChevronRight size={15} />
                    </summary>
                    <pre className="evidence-content">{item.content}</pre>
                  </details>
                ))
              ) : (
                <EmptyState
                  title="暂无关联依据"
                  detail="当前记录没有来源信息。"
                />
              )}
            </>
          )}
          {panel === "details" && (
            <>
              <h3>{run.result.objectTitle}</h3>
              <p className="muted-note">
                {run.id} · {run.createdAt}
              </p>
              <ol className="record-timeline">
                <li>固定资料载入前端示例。</li>
                <li>未执行规则核验与模型调用。</li>
                <li>尚无真实审批及交付记录。</li>
              </ol>
              {counterpartHref && (
                <Link
                  className="plain-link"
                  to={counterpartHref}
                  onClick={close}
                >
                  查看步骤预览 <ArrowRight size={14} />
                </Link>
              )}
            </>
          )}
          {panel === "review" && (
            <>
              <p className="review-scope">
                确认范围：{run.result.objectTitle}，共 {run.records.length}{" "}
                条记录。
              </p>
              <RecordCollection records={run.records} compact />
              <label className="review-checkbox">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                我已核对示例资料与交付范围
              </label>
              <p className="field-help">
                本轮只预览交互，不提交审批，也不生成正式报告。
              </p>
              <div className="dialog-actions">
                <Button
                  variant="secondary"
                  onClick={() => setNote("已选择退回预览；没有提交真实审批。")}
                >
                  预览退回
                </Button>
                <Button
                  disabled={!checked || !canReview}
                  onClick={() =>
                    setNote("已选择确认预览；没有执行后端能力或生成正式报告。")
                  }
                >
                  预览确认
                </Button>
              </div>
              {note && (
                <p role="status" className="inline-note">
                  {note}
                </p>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
export const BusinessReportModule = BusinessWorkspace;

/** Meaningful records, expandable source context; not an object-property grid. */
export function RecordCollection({
  records,
  compact = false,
}: {
  records: SourceRecord[];
  compact?: boolean;
}) {
  if (!records.length)
    return (
      <EmptyState
        title="暂无资料记录"
        detail="添加资料后可在这里核对范围与来源。"
      />
    );
  return (
    <ContentReviewList
      items={records.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.outcome,
        context: (
          <p>
            {r.source}。资料由{r.owner}负责，计划于{r.due}
            完成；当前为未核验的示例内容。
          </p>
        ),
      }))}
    />
  );
}
export function BusinessMaterials({ run }: { run: RunView }) {
  return (
    <div className="page business-page">
      <div className="page-title-row">
        <h1>资料对象</h1>
        <Badge>示例资料</Badge>
      </div>
      <p className="module-intro">展开记录查看来源，核对本次交付范围。</p>
      <RecordCollection records={run.records} />
    </div>
  );
}
export function BusinessDelivery() {
  return (
    <div className="page business-page">
      <div className="page-title-row">
        <h1>交付记录</h1>
      </div>
      <EmptyState
        title="尚无正式交付记录"
        detail="运行服务未连接，没有报告已被真实生成。"
      />
    </div>
  );
}

export * from './runtime';
