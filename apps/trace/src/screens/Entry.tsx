import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileSearch, Link2, Plus, Search, ShieldQuestion, X } from "lucide-react";
import {
  SHOWCASE,
  bundleOf,
  client,
  digestOf,
  ensureProject,
  modelAvailability,
  outcomeText,
  sampleCases,
  searchAvailability,
  showcaseCases,
  startInvestigation,
  stepOf,
  type CaseDigest,
  type FactDraft,
} from "../api";
import { Tag, archiveHref, caseHref, formatTime } from "../components";
import { Watershed } from "../Watershed";
import { ensureClueProject, startClueInvestigation } from "../api";
import { evidenceWording } from "../presentation";

const MAX_FACTS = 6;
const MAX_QUERIES = 6;

function blankFact(index: number): FactDraft {
  return { id: `fact-${index}`, text: "", queries: [""] };
}

/**
 * 首页需要的数据：三个案例 + 本机历史调查。
 * 公网版直接用导出的历史记录；本机版先列运行再逐个取详情——
 * 列表接口不带证据链，只有详情里才有重算后的结论与追问、修正记录。
 */
function useDigests() {
  const local = useQuery({
    queryKey: ["home-digests"],
    enabled: !SHOWCASE,
    queryFn: async () => {
      const runs = await client.runs();
      const completed = runs.filter(
        (run) => run.status === "completed" && run.assembly.some((step) => step.capabilityId === "trace.case.intake"),
      );
      const details = await Promise.all(completed.slice(0, 8).map((run) => client.run(run.id)));
      return details.map((run) => ({ digest: digestOf(run), run }));
    },
  });

  return useMemo(() => {
    const rows = SHOWCASE
      ? showcaseCases().map((item) => ({ digest: digestOf(item.run), run: item.run }))
      : local.data || [];
    const pick = (keys: string[]) => rows.find((row) => keys.some((key) => row.digest.claim.includes(key))) || null;
    return {
      rows,
      A: rows.find((row) => row.run.id === "run_7ff5367b-1fbc-42e3-8f7c-0b8add9b9ab6") || pick(["个人信息保护法"]),
      B: rows.find((row) => row.run.id === "run_5ac241c1-1049-4c4d-aaf3-4cc0c45936f6") || pick(["新能源汽车", "产量"]),
      C: rows.find((row) => row.run.id === "run_8f812ae8-42f3-48d1-a353-84942f770e95") || pick(["氢能", "加氢"]),
      D: rows.find((row) => row.digest.claim.includes("民法典") && row.digest.claim.includes("2021年1月1日") && row.run.steps.some((step) => step.capabilityId === "model.verify" && step.status === "completed")) || null,
      R: rows.find((row) => row.digest.outcome === "contradicted") || null,
      // 跨调查经验复用：新调查命中了历史经验（通过日/施行日混淆）
      E: pick(["2021年8月20日"]) || null,
      // 事实分水岭：只差一个关键条件的两次真实调查
      datePair: (() => {
        const right = rows.find((row) => row.digest.claim.includes("2021年1月1日") && row.digest.outcome === "supported");
        const left = rows.find((row) => row.digest.claim.includes("2020年5月28日") && row.digest.outcome === "contradicted");
        return left && right ? { left, right } : null;
      })(),
      volumePair: (() => {
        const supported = rows.find((row) => row.digest.claim.includes("1200万") && row.digest.outcome === "supported");
        const disputed = rows.find((row) => row.digest.claim.includes("1300万"));
        return supported && disputed ? { left: supported, right: disputed } : null;
      })(),
      loading: !SHOWCASE && local.isLoading,
      error: local.isError ? (local.error as Error).message : null,
    };
  }, [local.data, local.isLoading, local.isError, local.error]);
}

/** 首页只给短标签，避免把整句说法堆在入口处。 */
function caseShortName(claim: string) {
  if (claim.includes("法医") || claim.includes("大宝")) return "找线索：国产法医剧";
  if (claim.includes("八分钟") || claim.includes("火车")) return "找线索：火车循环电影";
  if (claim.includes("民法典")) return "查真假：民法典日期";
  if (claim.includes("个人信息保护法")) return "跨调查经验复用";
  if (claim.includes("氢能") || claim.includes("加氢")) return "查真假：氢能网络";
  if (claim.includes("新能源汽车") || claim.includes("产量")) return "查冲突：产量两种口径";
  return claim.length > 18 ? `${claim.slice(0, 18)}…` : claim;
}

export function Entry() {
  const nav = useNavigate();
  const availability = useQuery({ queryKey: ["search-availability"], queryFn: searchAvailability });
  const model = useQuery({ queryKey: ["model-availability"], queryFn: modelAvailability, enabled: !SHOWCASE });
  const digests = useDigests();
  const [question, setQuestion] = useState("");
  const [claim, setClaim] = useState("");
  const [facts, setFacts] = useState<FactDraft[]>([blankFact(1)]);
  const [planOpen, setPlanOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useModel, setUseModel] = useState(false);
  const [modelConsent, setModelConsent] = useState(false);
  const [clueQuestion, setClueQuestion] = useState("");
  const [heroMode, setHeroMode] = useState<"verification" | "clue">("verification");
  const [clueBusy, setClueBusy] = useState(false);
  const [clueModelConsent, setClueModelConsent] = useState(false);
  const [clueError, setClueError] = useState<string | null>(null);
  const modelBlocked = useModel && model.data?.available !== true;

  const blocked = !SHOWCASE && availability.data?.available !== true;
  const blockerReason = availability.isError
    ? (availability.error as Error).message
    : (availability.data?.reason ?? "正在读取检索能力状态…");

  const hero = digests.C || digests.B || digests.A;

  function applySample(index: number) {
    const sample = sampleCases[index];
    setQuestion(sample.question);
    setClaim(sample.claim);
    setFacts(sample.facts.map((fact) => ({ ...fact, queries: [...fact.queries] })));
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateFact(index: number, patch: Partial<FactDraft>) {
    setFacts((list) => list.map((fact, i) => (i === index ? { ...fact, ...patch } : fact)));
  }

  function updateQuery(factIndex: number, queryIndex: number, value: string) {
    setFacts((list) =>
      list.map((fact, i) =>
        i === factIndex
          ? { ...fact, queries: fact.queries.map((q, j) => (j === queryIndex ? value : q)) }
          : fact,
      ),
    );
  }

  async function submit() {
    setError(null);
    if (SHOWCASE) {
      setError("这是只读的历史调查展示，不带联网检索。需要自己提问并真实联网调查，请在本机运行 Runtime 后打开工作区版本。");
      return;
    }
    const trimmedQuestion = question.trim();
    const effectiveClaim = claim.trim() || trimmedQuestion;
    if (trimmedQuestion.length < 2) {
      setError("先写下一句需要调查的问题。");
      return;
    }
    if (useModel && (modelBlocked || !modelConsent)) {
      setError(modelBlocked ? "模型尚不可用，请先完成本机配置。" : "请先确认本次问题和证据摘录的模型外发授权。");
      return;
    }
    const prepared = facts
      .map((fact, index) => {
        const text = fact.text.trim() || effectiveClaim;
        const queries = fact.queries.map((q) => q.trim()).filter(Boolean);
        return {
          id: fact.id || `fact-${index + 1}`,
          text,
          queries: queries.length ? queries : [text],
          ...(fact.timeScope ? { timeScope: fact.timeScope } : {}),
          ...(fact.subjectScope ? { subjectScope: fact.subjectScope } : {}),
        };
      })
      .filter((fact) => fact.text.length >= 2);
    if (!prepared.length) {
      setError("至少需要一条可核查的说法。");
      return;
    }
    setBusy(true);
    try {
      const project = await ensureProject(useModel);
      const run = await startInvestigation(project, {
        question: trimmedQuestion,
        claim: effectiveClaim,
        facts: prepared,
      }, useModel && modelConsent);
      nav(`/cases/${run.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitClue() {
    await submitClueWith(clueQuestion, heroMode);
  }

  async function submitClueWith(value: string, mode: "verification" | "clue" = heroMode) {
    const trimmed = value.trim();
    if (trimmed.length < 4) {
      setClueError("再多说一点：记得的情节、人物、时间都可以。");
      return;
    }
    setClueBusy(true);
    setClueError(null);
    try {
      if (mode === "verification") {
        const project = await ensureProject(false);
        const run = await startInvestigation(project, {
          question: trimmed,
          claim: trimmed,
          facts: [{ id: "fact-1", text: trimmed, queries: [trimmed] }],
        });
        nav(`/cases/${run.id}`);
      } else {
        const project = await ensureClueProject();
        const run = await startClueInvestigation(project, trimmed, clueModelConsent);
        nav(`/cases/${run.id}`);
      }
    } catch (e) {
      setClueError((e as Error).message);
    } finally {
      setClueBusy(false);
    }
  }

  const clueExamples = [
    {
      key: "线索",
      label: "找线索",
      detail: "只记得几个情节，帮我找到一部电视剧。",
      text: "我记得以前看过一部国产破案剧，男主好像是法医，有个人叫大宝，想不起电视剧名字了。",
      mode: "clue" as const,
      showcaseRunId: "run_ce63a399-a03d-41ad-9ec2-e2fc337c4dbb",
    },
    {
      key: "冲突",
      label: "查冲突",
      detail: "为什么两个官方渠道公布的新能源汽车产量不同？",
      text: "为什么2024年中国新能源汽车产量有1288.8万辆和1316.8万辆两种说法？",
      mode: "fact" as const,
      showcaseRunId: "run_5ac241c1-1049-4c4d-aaf3-4cc0c45936f6",
      claim: "2024年中国新能源汽车产量为1316.8万辆",
      facts: [
        {
          id: "fact-1",
          text: "2024年中国新能源汽车产量为1316.8万辆（国家统计局口径）",
          queries: ["2024年 新能源汽车产量 1316.8万辆 统计局", "2024年 新能源汽车 产量 1288.8万辆 中汽协"],
          timeScope: "2024年",
          subjectScope: "中国",
        },
      ],
    },
    {
      key: "真假",
      label: "查真假",
      detail: "某个工程项目是否真的已经全面建成？",
      text: "2025年全国氢能重卡加氢网络是不是已经全面建成？我看到新闻说氢走廊已经投运。",
      mode: "fact" as const,
      showcaseRunId: "run_8f812ae8-42f3-48d1-a353-84942f770e95",
      claim: "2025年全国氢能重卡加氢网络已全面建成",
      facts: [
        {
          id: "fact-1",
          text: "2025年全国已建成覆盖全国的氢能长途重卡加氢网络",
          queries: ["2025年 氢能重卡 加氢网络 全面建成 全国", "氢走廊 投运 氢能重卡 干线"],
          timeScope: "2025年",
          subjectScope: "中国",
        },
      ],
    },
  ];

  /** 示例入口：找线索走线索流程，冲突/真假走事实核查流程，都是真实的 Runtime 调查。 */
  async function startExample(example: (typeof clueExamples)[number]) {
    // 只读展示：直接进入这次真实调查的回放，按钮不会发新请求。
    if (SHOWCASE) {
      if (example.showcaseRunId) nav(caseHref(example.showcaseRunId));
      return;
    }
    if (example.mode === "clue") {
      setClueQuestion(example.text);
      await submitClueWith(example.text, "clue");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const project = await ensureProject(false);
      const run = await startInvestigation(
        project,
        { question: example.text, claim: example.claim, facts: example.facts },
        false,
      );
      nav(`/cases/${run.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="trace-page trace-home">
      <section className="clue-hero" aria-label="用一句话开始调查">
        <span className="clue-hero-brand">TRACE｜线索侦探</span>
        <h1>记不清？查不明？给我线索，我来追查。</h1>
        <p className="clue-hero-lede">输入待核实的说法或模糊线索，TRACE 会真实搜索、核对证据。查不到的，不乱猜。</p>
        {SHOWCASE ? (
          <div className="clue-hero-input" aria-label="历史调查演示入口">
            <p className="clue-hero-note">这里是公开的真实调查回放。当前环境不接受新查询，可直接查看完整的证据与结论。</p>
            <a className="trace-btn trace-btn-primary trace-btn-lg" href={caseHref("run_7ff5367b-1fbc-42e3-8f7c-0b8add9b9ab6")}>
              <Search size={16} /> 查看真实调查
            </a>
          </div>
        ) : (
          <div className="clue-hero-input">
            <div role="group" aria-label="调查方式" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="trace-btn" aria-pressed={heroMode === "verification"} onClick={() => setHeroMode("verification")}>查证说法</button>
              <button type="button" className="trace-btn" aria-pressed={heroMode === "clue"} onClick={() => setHeroMode("clue")}>寻找线索</button>
            </div>
            <textarea
              aria-label="你想查什么"
              rows={2}
              maxLength={500}
              placeholder={heroMode === "verification"
                ? "例如：《个人信息保护法》自2021年8月20日起施行。"
                : "例如：我记得一部国产悬疑剧，主角是法医，好像有个叫大宝的搭档。"}
              value={clueQuestion}
              onChange={(event) => setClueQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submitClue();
              }}
            />
            <button
              className="trace-btn trace-btn-primary trace-btn-lg"
              disabled={SHOWCASE || clueBusy || blocked || clueQuestion.trim().length < 4}
              onClick={() => void submitClue()}
            >
              <Search size={16} /> {clueBusy ? "正在调查…" : heroMode === "verification" ? "开始核查" : "开始找线索"}
            </button>
            {heroMode === "verification" ? (
              <p className="clue-hero-note">请输入一句可核查的具体说法；当前按原句立案，不会把开放式问题自动改写成未经确认的事实。</p>
            ) : null}
          </div>
        )}
        {!SHOWCASE && heroMode === "clue" ? (
          <label className="clue-hero-note" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={clueModelConsent} onChange={(event) => setClueModelConsent(event.target.checked)} />
            同意将这次线索发送给已配置的模型辅助生成搜索词（不勾选仍可使用规则检索）
          </label>
        ) : null}
        <div className="clue-hero-examples">
          {clueExamples.map((example) => (
            <button
              key={example.key}
              className="clue-example"
              disabled={clueBusy || busy || (!SHOWCASE && blocked)}
              onClick={() => void startExample(example)}
            >
              <b>{example.label}</b>
              <span>{example.detail}</span>
              <em>{example.mode === "clue" ? "线索追查" : "事实核查"}</em>
            </button>
          ))}
        </div>
        {SHOWCASE ? (
          <p className="clue-hero-note">
            公网版本是只读回放，点上面任一示例可以看到当时的真实调查记录；要真正发起搜索，请在本机运行 Runtime。
          </p>
        ) : blocked ? (
          <p className="clue-hero-note" role="status">联网检索当前不可用：{blockerReason}</p>
        ) : (
          <p className="clue-hero-note">会用元宝搜索真实检索，答案只来自查到的网页；查不到就说查不到。</p>
        )}
        {clueError ? <div className="trace-alert" role="alert">{clueError}</div> : null}
      </section>

      <div className="clue-hero-cases" aria-label="真实调查案例">
        <span>真实调查案例：</span>
        {[digests.E, digests.R, digests.C, digests.B, digests.A]
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .slice(0, 5)
          .map((item) => (
            <a key={item.digest.runId} href={caseHref(item.digest.runId)}>
              {caseShortName(item.digest.claim)}
            </a>
          ))}
      </div>

      <details className="trace-home-extra" open={!SHOWCASE}>
        <summary>展开了解更多调查案例与历史研究</summary>
      {digests.datePair ? (
        <Watershed
          left={{ label: "原句（真实反证）", claim: digests.datePair.left.digest.claim, digest: digests.datePair.left.digest }}
          right={{ label: "只改日期", claim: digests.datePair.right.digest.claim, digest: digests.datePair.right.digest }}
          historical={SHOWCASE}
          cardHref={SHOWCASE ? "./facts/民法典日期对照卡.md" : undefined}
        />
      ) : null}
      {digests.volumePair ? (
        <Watershed
          compact
          left={{ label: "原句（有依据支持）", claim: digests.volumePair.left.digest.claim, digest: digests.volumePair.left.digest }}
          right={{ label: "把门槛提高到 1300 万", claim: digests.volumePair.right.digest.claim, digest: digests.volumePair.right.digest }}
          historical={SHOWCASE}
          cardHref={SHOWCASE ? "./facts/新能源产量对照卡.md" : undefined}
        />
      ) : null}

      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="home-brand">要核查一句具体说法？</span>
          <h1>把这句话交给证据去检验</h1>
          <p className="home-lede">写下可以被判断真假的一句话，系统会真实检索、比对原文，并在证据不足时明确说不确定。</p>

          {SHOWCASE ? (
            <div className="home-actions">
              <a className="trace-btn trace-btn-primary trace-btn-lg" href={hero ? caseHref(hero.digest.runId) : "#/"}>
                查看完整调查过程 <ArrowRight size={16} />
              </a>
              <span className="home-mode">
                <ShieldQuestion size={14} /> 历史真实调查记录（只读，不联网）
              </span>
            </div>
          ) : (
            <div className="home-form">
              <label className="trace-label" htmlFor="trace-question">
                要调查什么
                <small>{question.trim().length}/500</small>
              </label>
              <textarea
                id="trace-question"
                className="trace-textarea"
                maxLength={500}
                placeholder="例：网传某市2024年新能源汽车产量达到120万辆，是真的吗？"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <label className="trace-label" htmlFor="trace-claim">
                要核查的说法
                <small>留空则与问题相同</small>
              </label>
              <input
                id="trace-claim"
                className="trace-input"
                maxLength={500}
                placeholder="一句可以被证据判断真假的话"
                value={claim}
                onChange={(e) => setClaim(e.target.value)}
              />
              <label className="trace-label" htmlFor="trace-review-mode">核查方式</label>
              <select id="trace-review-mode" className="trace-input" value={useModel ? "model" : "manual"}
                onChange={(event) => { setUseModel(event.target.value === "model"); setModelConsent(false); }}>
                <option value="model">联网取证 + 模型语义复核</option>
                <option value="manual">联网取证 + 规则与人工核查</option>
              </select>
              {useModel ? (
                <div>
                  {modelBlocked ? (
                    <p className="trace-hint" role="status">
                      {model.isError ? "无法读取模型状态，请确认运行服务已启动。" : "模型尚未就绪，请由操作者完成本机配置并重启运行服务。"}
                      <button type="button" className="trace-btn trace-btn-quiet" onClick={() => void model.refetch()}>刷新模型状态</button>
                    </p>
                  ) : null}
                  <label className="trace-hint" style={{ display: "flex", alignItems: "start", gap: 10, padding: "12px 0", minHeight: 44 }}>
                    <input type="checkbox" checked={modelConsent} disabled={modelBlocked}
                      style={{ width: 20, height: 20, flexShrink: 0 }}
                      onChange={(event) => setModelConsent(event.target.checked)} />
                    同意将本次问题、待核查事实和证据摘录发送至已配置的模型进行复核；模型意见仍需人工审阅。
                  </label>
                </div>
              ) : null}
              <div className="home-form-actions">
                <button
                  type="button"
                  className="trace-btn trace-btn-primary trace-btn-lg"
                  disabled={busy || blocked || question.trim().length < 2 || (useModel && (modelBlocked || !modelConsent))}
                  onClick={submit}
                >
                  <Search size={16} /> {busy ? "正在立案…" : useModel ? "开始模型调查" : "开始人工核查"}
                </button>
                <span className="home-form-hint">检索式会发到元宝搜索，来源与结论保存在本机运行记录里。</span>
              </div>
              {blocked ? (
                <div className="trace-blocker" role="status">
                  <strong>联网检索当前不可用，暂时无法开始调查</strong>
                  <p>{blockerReason}</p>
                  <p>
                    在项目根目录的 <code>.env.platform</code> 里填写 <code>PLATFORM_WSA_API_KEY</code>
                    ，重启 Runtime 后即可开始。密钥只保存在服务端。
                  </p>
                </div>
              ) : null}
            </div>
          )}

          <ul className="home-roles">
            <li>
              <b>元宝搜索</b>
              <span>负责查找公开来源，抓取网页正文</span>
            </li>
            <li>
              <b>规则引擎</b>
              <span>逐条判断支持、反对、无法确认，并写出理由</span>
            </li>
            <li data-model={digests.D ? "true" : "false"}>
              <b>DeepSeek 辅助复核</b>
              <span>
                {digests.D
                  ? "只在该案例真实调用过，只给辅助语义意见，不替代原文"
                  : "当前展示的案例没有调用模型，因此不显示模型意见"}
              </span>
            </li>
            <li>
              <b>你</b>
              <span>确认结论、纠正判断，改过的地方留痕</span>
            </li>
          </ul>

          <ul className="home-claims">
            <li>
              <Link2 size={15} />
              <span>
                <b>结论必须能点回来源</b>
                每条证据带原始网址与原文摘录，原文取不到就明确标注为「仅搜索摘要」。
              </span>
            </li>
            <li>
              <ShieldQuestion size={15} />
              <span>
                <b>证据不够就不下结论</b>
                未检测到重复不等于来源独立；区分原始依据候选、二次报道和搜索摘要，保留缺口。
              </span>
            </li>
            <li>
              <FileSearch size={15} />
              <span>
                <b>改过的地方留痕，出过的档案不改写</b>
                追问与人工修正都会说明结论为什么变，旧版本永远对应旧结论。
              </span>
            </li>
          </ul>
        </div>

        <aside className="home-hero-case" aria-label="主推真实案例">
          {hero ? (
            <HeroCase digest={hero.digest} />
          ) : (
            <div className="home-hero-empty">
              {digests.loading ? "正在读取本机调查记录…" : digests.error || "本机还没有已完成的调查记录。"}
            </div>
          )}
        </aside>
      </section>

      <section className="home-cases">
        {digests.R ? (
          <section className="trace-block trace-block-warn" aria-label="案例R 真实反证">
            <div className="trace-section-head">
              <h2>真实反证｜「《民法典》自2020年5月28日起施行」</h2>
              <span>R · 规则与模型都判为与说法相反</span>
            </div>
            <p className="trace-lede">
              2020 年 5 月 28 日是<strong>通过并公布</strong>的日子，正式施行日是 2021 年 1 月 1 日。
              TRACE 用主席令原文与多家官方转述交叉核对，把这句话判为<strong>存在反证</strong>。
            </p>
            <div className="home-actions">
              <a className="trace-btn trace-btn-primary" href={caseHref(digests.R.digest.runId)}>查看调查过程 <ArrowRight size={14} /></a>
              <a className="trace-btn" href={archiveHref(digests.R.digest.runId)}>查看调查档案</a>
            </div>
          </section>
        ) : null}
        {digests.D ? <section className="trace-block" aria-label="案例D 模型辅助复核">
          <div className="trace-section-head"><h2>《民法典》施行日期｜模型辅助复核</h2><span>D · 真实模型调用记录</span></div>
          <p className="trace-lede">{bundleOf(digests.D.run)?.case.question}</p>
          <p>在真实搜索取得证据后，DeepSeek 对所提供摘录给出辅助意见，引用保留原始链接。规则判断、模型意见和人工确认分别展示。</p>
          <p className="trace-hint">{(() => {
            const call = digests.D.run.modelCalls?.findLast((item) => item.status === "completed");
            const output = digests.D.run.steps.find((step) => step.capabilityId === "model.verify")?.output as { verification?: { citations?: string[] } } | undefined;
            return `${call ? `${call.model} · ${(call.durationMs / 1000).toFixed(1)} 秒 · ` : ""}${output?.verification?.citations?.length || 0} 条真实引用。历史记录回放，不是此刻重新调用。`;
          })()}</p>
          <div className="home-actions">
            <a className="trace-btn trace-btn-primary" href={caseHref(digests.D.digest.runId)}>查看模型复核记录 <ArrowRight size={14} /></a>
            <a className="trace-btn" href={archiveHref(digests.D.digest.runId)}>查看对应调查档案</a>
          </div>
        </section> : null}
        {digests.E ? (
          <section className="trace-block" aria-label="案例E 跨调查经验复用">
            <div className="trace-section-head">
              <h2>跨调查经验复用｜「《个人信息保护法》自2021年8月20日起施行」</h2>
              <span>E · 立案时匹配到历史经验</span>
            </div>
            <p className="trace-lede">
              这句话把<strong>通过日</strong>当成了<strong>施行日</strong>——和《民法典》那条历史错误一模一样。
              系统在立案时匹配到已确认经验，把「先分清通过/公布与施行」写成检查清单；
              模型复核引用的仍是本次真实证据，经验没有替代任何来源。
            </p>
            <div className="home-actions">
              <a className="trace-btn trace-btn-primary" href={caseHref(digests.E.digest.runId)}>
                查看这次调查 <ArrowRight size={14} />
              </a>
              {digests.R ? (
                <a className="trace-btn" href={caseHref(digests.R.digest.runId)}>
                  查看被复用的历史案例
                </a>
              ) : null}
            </div>
          </section>
        ) : null}
        <div className="home-section-head">
          <h2>A / B / C · 三次真实查询</h2>
          <span>{SHOWCASE ? "点开就是当时的真实调查记录" : "点开看真实调查，或带入表单重新跑一次"}</span>
        </div>
        <div className="home-case-grid">
          <CaseCard
            kind="C"
            digests={digests.C?.digest}
            onApply={SHOWCASE ? undefined : () => applySample(2)}
            title="补充调查后仍证据不足"
            detail="多步调查：查不到就直接说不下结论，并写清还缺什么"
          />
          <CaseCard
            kind="B"
            digests={digests.B?.digest}
            onApply={SHOWCASE ? undefined : () => applySample(1)}
            title="需要跨来源核查"
            detail="同一口径的多个来源如何互相印证，别的指标如何被排除"
          />
          <CaseCard
            kind="A"
            digests={digests.A?.digest}
            onApply={SHOWCASE ? undefined : () => applySample(0)}
            title="有明确原始证据"
            detail="权威原文 + 转载合并，规则判错时人工纠正并留痕"
          />
        </div>
      </section>

      {!SHOWCASE ? (
        <section className="trace-plan home-plan">
          <button type="button" className="trace-plan-toggle" onClick={() => setPlanOpen((open) => !open)} aria-expanded={planOpen}>
            <span>检索计划（{facts.filter((fact) => (fact.text || claim).trim()).length} 条说法 · 通常不用改）</span>
            <span className="trace-mono">{planOpen ? "收起" : "展开调整"}</span>
          </button>
          {planOpen ? (
            <div className="trace-plan-body">
              <p className="trace-hint">
                系统会把每条说法交给元宝搜索。默认用说法本身检索；加上年份、机构名或文件编号通常更准。
              </p>
              {facts.map((fact, index) => (
                <div className="trace-fact-editor" key={fact.id}>
                  <div className="trace-fact-editor-head">
                    <span>说法 {index + 1}</span>
                    {facts.length > 1 ? (
                      <button
                        type="button"
                        className="trace-btn trace-btn-quiet"
                        onClick={() => setFacts((list) => list.filter((_, i) => i !== index))}
                      >
                        <X size={13} /> 移除
                      </button>
                    ) : null}
                  </div>
                  <input
                    className="trace-input"
                    maxLength={400}
                    placeholder={claim.trim() || "写成一句可判断真假的说法"}
                    value={fact.text}
                    onChange={(e) => updateFact(index, { text: e.target.value })}
                  />
                  <div className="trace-queries">
                    {fact.queries.map((query, queryIndex) => (
                      <div className="trace-query-row" key={queryIndex}>
                        <input
                          className="trace-input"
                          maxLength={120}
                          placeholder={queryIndex === 0 ? "检索式" : "补充检索式"}
                          value={query}
                          onChange={(e) => updateQuery(index, queryIndex, e.target.value)}
                        />
                        {fact.queries.length > 1 ? (
                          <button
                            type="button"
                            className="trace-btn trace-btn-quiet"
                            aria-label="删除这条检索式"
                            onClick={() => updateFact(index, { queries: fact.queries.filter((_, j) => j !== queryIndex) })}
                          >
                            <X size={13} />
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {fact.queries.length < MAX_QUERIES ? (
                      <button
                        type="button"
                        className="trace-btn trace-btn-quiet"
                        style={{ alignSelf: "flex-start" }}
                        onClick={() => updateFact(index, { queries: [...fact.queries, ""] })}
                      >
                        <Plus size={13} /> 加一条检索式
                      </button>
                    ) : null}
                  </div>
                  <div className="trace-plan-scope">
                    <input
                      className="trace-input"
                      maxLength={60}
                      placeholder="适用时间（可选），如 2024年"
                      value={fact.timeScope || ""}
                      onChange={(e) => updateFact(index, { timeScope: e.target.value })}
                    />
                    <input
                      className="trace-input"
                      maxLength={60}
                      placeholder="主体或地区（可选），如 中国大陆"
                      value={fact.subjectScope || ""}
                      onChange={(e) => updateFact(index, { subjectScope: e.target.value })}
                    />
                  </div>
                </div>
              ))}
              {facts.length < MAX_FACTS ? (
                <button
                  type="button"
                  className="trace-btn trace-btn-ghost"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => setFacts((list) => [...list, blankFact(list.length + 1)])}
                >
                  <Plus size={14} /> 再加一条说法
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div className="trace-alert" role="alert">
          {error}
        </div>
      ) : null}

      {!SHOWCASE ? (
        <section className="trace-recent-block">
          <div className="trace-section-head">
            <h2>本机历史调查</h2>
            <span>{digests.rows.length ? `${digests.rows.length} 条已完成记录` : "读取中"}</span>
          </div>
          <p className="trace-hint">
            这些是这台机器上真实跑过的调查，打开看到的是当时检索到的来源与结论，不是现在正在联网查询。
          </p>
          {digests.rows.length ? (
            <div className="trace-recent">
              {digests.rows.slice(0, 6).map(({ digest }) => (
                <div className="trace-recent-item" key={digest.runId}>
                  <a href={caseHref(digest.runId)}>{digest.claim}</a>
                  <span className="trace-recent-meta">
                    <Tag tone={digest.outcome === "supported" ? "support" : digest.outcome === "contradicted" ? "oppose" : "unclear"}>
                      {digest.outcome ? outcomeText[digest.outcome] : "记录"}
                    </Tag>
                    {digest.versions > 1 ? <span className="trace-mono">v{digest.versions}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="trace-empty">
              {digests.loading ? "正在读取本机调查记录…" : "还没有已完成的调查。写上第一句要核查的说法，或点上面任意一个真实案例。"}
            </div>
          )}
        </section>
      ) : null}
      </details>
    </div>
  );
}

/** 首页主推案例：真实结论 + 多轮调查轨迹 + 还缺什么，全部来自运行记录。 */
function HeroCase({ digest }: { digest: CaseDigest }) {
  const steps = useMemo(() => {
    const list: { label: string; detail: string }[] = [];
    list.push({
      label: "检索结果",
      detail: `${digest.independentSources} 个未检测到重复的来源 · ${digest.bodyBacked} 份原文正文`,
    });
    for (const query of digest.followupQueries)
      list.push({ label: "追加检索", detail: query });
    for (const correction of digest.corrections)
      list.push({
        label: "人工修正",
        detail: `${correction.impact ? `${relText(correction.impact.sourceBefore)} → ` : ""}${relText(correction.relation)}：${correction.note.slice(0, 28)}`,
      });
    if (digest.versions > 1) list.push({ label: "生成新版", detail: `已交付第 ${digest.versions} 版档案，旧版不改写` });
    return list;
  }, [digest]);

  return (
    <article className="hero-case" data-outcome={digest.outcome || "insufficient"}>
      <header className="hero-case-head">
        <span className="hero-case-tag">主推案例 · C</span>
        <a className="hero-case-link" href={caseHref(digest.runId)}>
          完整调查 <ArrowRight size={14} />
        </a>
      </header>
      <h2 className="hero-case-claim">{digest.claim}</h2>
      <p className="hero-case-verdict">
        <b>{digest.outcome ? outcomeText[digest.outcome] : "记录"}</b>
        <span>{evidenceWording(digest.statement).replace(/^就「.*?」而言，/, "")}</span>
      </p>
      <div className="hero-case-counts">
        <span title="未检测到与其它来源重复的来源簇">
          未检测到重复 <b>{digest.independentSources}</b>
        </span>
        <span>
          原文正文 <b>{digest.bodyBacked}</b>
        </span>
        <span>
          支持 / 无法确认 <b>{digest.factCounts.supports}</b> / <b>{digest.factCounts.unclear}</b>
        </span>
        <span>
          档案 <b>{digest.versions || 1}</b> 版
        </span>
      </div>
      <ol className="hero-case-steps">
        {steps.map((step, index) => (
          <li key={index}>
            <span className="hero-case-step-label">{step.label}</span>
            <span className="hero-case-step-detail">{step.detail}</span>
          </li>
        ))}
      </ol>
      {digest.gaps.length ? (
        <div className="hero-case-gaps">
          <strong>还缺什么</strong>
          <ul>
            {digest.gaps.slice(0, 2).map((gap, index) => (
              <li key={index}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

/** 三个案例用三种不同的信息组织，避免三张一样的卡片。 */
function CaseCard({
  kind,
  digests,
  title,
  detail,
  onApply,
}: {
  kind: "A" | "B" | "C";
  digests?: CaseDigest;
  title: string;
  detail: string;
  onApply?: () => void;
}) {
  const bodyBacked = (digests?.sources || []).filter((source) => source.bodyAvailable).slice(0, 2);
  const supports = (digests?.sources || []).filter((source) => source.relation === "supports").slice(0, 3);
  const correction = digests?.corrections?.[0];

  return (
    <article className="home-case" data-kind={kind}>
      <header>
        <span className="home-case-kind">{kind}</span>
        <h3>{title}</h3>
        <p className="home-case-detail">{detail}</p>
      </header>

      {digests ? (
        <>
          <p className="home-case-claim">{digests.claim}</p>
          <div className="home-case-verdict" data-outcome={digests.outcome || "insufficient"}>
            <b>{digests.outcome ? outcomeText[digests.outcome] : "记录"}</b>
            <span>
              未检测到重复 {digests.independentSources} · 原文 {digests.bodyBacked}
              {digests.versions > 1 ? ` · ${digests.versions} 版档案` : ""}
            </span>
          </div>

          {kind === "C" ? (
            <ol className="home-case-trace">
              <li>
                <span>来源</span>
                {`${digests.independentSources} 个未检测到重复的来源 · ${digests.bodyBacked} 份原文`}
              </li>
              {digests.followupQueries.slice(0, 1).map((query, index) => (
                <li key={index}>
                  <span>追问</span>
                  {query}
                </li>
              ))}
              <li>
                <span>修正</span>
                {digests.corrections.length ? `${digests.corrections.length} 条人工修正` : "无人工修正"}
              </li>
              <li>
                <span>结果</span>
                {digests.gaps.length ? `仍是证据不足，缺口 ${digests.gaps.length} 项` : "已形成可交付结论"}
              </li>
            </ol>
          ) : null}

          {kind === "B" ? (
            <ul className="home-case-sources">
              {supports.map((source) => (
                <li key={source.pageId}>
                  <a href={source.url} target="_blank" rel="noreferrer noopener">
                    {source.site}
                  </a>
                  <span>{source.bodyAvailable ? "原文正文已取" : "仅搜索摘要"}</span>
                  <em>{source.title.length > 26 ? `${source.title.slice(0, 26)}…` : source.title}</em>
                </li>
              ))}
            </ul>
          ) : null}

          {kind === "A" ? (
            <div className="home-case-original">
              {bodyBacked.slice(0, 1).map((source) => (
                <blockquote key={source.pageId}>
                  <a href={source.url} target="_blank" rel="noreferrer noopener">
                    {source.title}
                  </a>
                  <p>{(source.bodyExcerpt || source.excerpt || "").slice(0, 88)}…</p>
                </blockquote>
              ))}
              {correction ? (
                <p className="home-case-fix">
                  规则判「{relText(correction.impact?.sourceBefore || "")}」→ 人工改为「{relText(correction.relation)}」
                  {correction.impact ? `，支持来源 ${correction.impact.supportsBefore} → ${correction.impact.supportsAfter} 条` : ""}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="home-case-empty">本机还没有这条案例的记录。</p>
      )}

      <footer className="home-case-actions">
        {digests ? (
          <a className="trace-btn trace-btn-ghost" href={caseHref(digests.runId)}>
            查看调查过程 <ArrowRight size={14} />
          </a>
        ) : null}
        {onApply ? (
          <button type="button" className="trace-link trace-link-button" onClick={onApply}>
            带入表单重新跑
          </button>
        ) : null}
      </footer>
    </article>
  );
}

const REL_TEXT: Record<string, string> = {
  supports: "支持",
  contradicts: "反对",
  unclear: "无法确认",
  irrelevant: "无关",
  mixed: "存在争议",
  none: "无可用来源",
};

function relText(value: string) {
  return REL_TEXT[value] || value || "未记录";
}
