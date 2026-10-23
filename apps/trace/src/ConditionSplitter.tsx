import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GitCompare, Play } from "lucide-react";
import {
  SHOWCASE,
  keyConditions,
  startVariantInvestigation,
  type CaseDigest,
} from "./api";

/**
 * 关键条件改写面板（仅本机版）：
 * 从当前说法里列出可改的日期/数量/范围/状态，用户改一处 → 用改后的完整说法真实重跑一次调查，
 * 然后回到页面与原始调查并列对照。这里不判断改后的说法真假。
 */
export function ConditionSplitter({ digest }: { digest: CaseDigest }) {
  const nav = useNavigate();
  const conditions = useMemo(() => keyConditions(digest.claim), [digest.claim]);
  const [picked, setPicked] = useState(conditions[0]?.value || "");
  const [replacement, setReplacement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variantClaim = picked && replacement.trim() ? digest.claim.replace(picked, replacement.trim()) : "";

  async function run() {
    if (!variantClaim || busy) return;
    setBusy(true);
    setError(null);
    try {
      const run = await startVariantInvestigation({
        question: digest.question || digest.claim,
        claim: variantClaim,
        factTexts: [variantClaim],
        queries: [variantClaim],
      });
      nav(`/cases/${run.id}?compare=${encodeURIComponent(digest.runId)}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!conditions.length)
    return (
      <section className="splitter">
        <div className="splitter-head">
          <GitCompare size={15} /> <strong>事实分水岭</strong>
          <span>这句话里没有识别出可替换的日期、数量、范围或状态条件。</span>
        </div>
      </section>
    );

  return (
    <section className="splitter" aria-label="改一个关键条件">
      <div className="splitter-head">
        <GitCompare size={15} /> <strong>事实分水岭：改一个关键条件，看结论会不会变</strong>
      </div>
      <p className="splitter-claim">{digest.claim}</p>
      <div className="splitter-rows">
        <label className="splitter-label" htmlFor="splitter-pick">
          选择要改的条件
        </label>
        <select
          id="splitter-pick"
          className="trace-input"
          value={picked}
          onChange={(event) => setPicked(event.target.value)}
        >
          {conditions.map((condition) => (
            <option key={`${condition.kind}-${condition.value}`} value={condition.value}>
              {condition.value}（{condition.hint}）
            </option>
          ))}
        </select>
        <label className="splitter-label" htmlFor="splitter-value">
          改成
        </label>
        <input
          id="splitter-value"
          className="trace-input"
          maxLength={60}
          placeholder={picked ? `例如把「${picked}」换成另一个日期/数字/范围` : ""}
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
        />
      </div>
      {variantClaim ? (
        <p className="splitter-preview">
          改后说法：<b>{variantClaim}</b>
        </p>
      ) : null}
      {error ? <div className="trace-alert">{error}</div> : null}
      <div className="splitter-actions">
        <button
          type="button"
          className="trace-btn trace-btn-primary"
          disabled={!variantClaim || busy}
          onClick={run}
        >
          <Play size={14} /> {busy ? "正在立案…" : "用这个说法重新调查（真实联网）"}
        </button>
        <span className="trace-hint">
          会走完整的立案 → 元宝搜索 → 原文抓取 → 规则判定流程，跑完回到这里与原始调查并列对照；
          新说法是真是假由调查结果决定，这里不做预判。
        </span>
      </div>
    </section>
  );
}

/** 只读版说明：公网没有实时检索服务，只展示已经跑过的对照。 */
export function SplitterLocked() {
  if (!SHOWCASE) return null;
  return (
    <section className="splitter splitter-locked" aria-label="事实分水岭说明">
      <div className="splitter-head">
        <GitCompare size={15} /> <strong>事实分水岭</strong>
        <span>只读展示</span>
      </div>
      <p className="trace-hint">
        这里展示的是**已经真实跑完**的两次调查记录；修改条件并重新联网调查需要在本机运行 Runtime，
        公网版不会假装正在实时检索。
      </p>
    </section>
  );
}
