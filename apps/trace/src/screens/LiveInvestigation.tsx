/**
 * Public live-investigation experience.
 * Every source and claim in this page comes from a live server-side SearchPro
 * response. The signed snapshot permits follow-up without exposing a database.
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Download, ExternalLink, Search, ShieldAlert } from "lucide-react";

type LiveSource = {
  id:string; url:string; site:string; title:string; relation:"supports"|"contradicts"|"unclear"|"irrelevant";
  sentence:string; scope:string; date:string; body:boolean; status:string;
  origin:string; independence:string; reasons:string[];
};
type LiveResult = {
  claim:string; kind?:"claim"|"comparison"|"explanation";
  figures?:{publisher:string;value:number;unit:string;sentence:string;scope:string;url:string;from:"body"|"excerpt";year:string}[];
  label:string; outcome:string; statement:string; reasons:string[]; gaps:string[];
  counts:{pages:number;bodies:number;keyEvidence:number;related:number;independentSources:number};
  sources:LiveSource[];
  rounds:{query:string;at:string;httpStatus:number|null;count:number;requestId:string|null;durationMs:number;error:string|null}[];
  snapshot:string; mayContinue:boolean; rawStatus:string|null;
};
const labels:Record<string,string> = {
  supports:"支持该说法",contradicts:"与说法相反",unclear:"未能判断",irrelevant:"不相关",
};
const DECISIVE = new Set(["supports","contradicts"]);
const storageKey = "trace-live-session-v1";
function loadSaved():LiveResult|null {
  try {
    const raw=sessionStorage.getItem(storageKey);
    if(!raw) return null;
    const data=JSON.parse(raw) as LiveResult;
    return Array.isArray(data.rounds) && typeof data.snapshot==="string" ? data : null;
  } catch {return null;}
}
function asMessage(value:unknown):string {
  return typeof value==="string"?value:"联网调查出现错误，请查看历史案例。";
}
async function gateway(claim:string, query:string, snapshot?:string):Promise<LiveResult>{
  const response=await fetch("/api/investigate",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({claim,query,...(snapshot?{snapshot}:{})}),
    cache:"no-store",
  });
  let payload:any=null;
  try {payload=await response.json()} catch {}
  if(!response.ok) throw new Error(asMessage(payload?.message || "联网调查暂时不可用。"));
  if(!payload||!Array.isArray(payload.sources)||!Array.isArray(payload.rounds))
    throw new Error("服务器没有返回有效调查记录。");
  return payload as LiveResult;
}
export function LiveInvestigation(){
  const [params]=useSearchParams();
  const initial=(params.get("claim")||"").slice(0,400);
  const [claim,setClaim]=useState(initial);
  const [query,setQuery]=useState("");
  const [result,setResult]=useState<LiveResult|null>(()=>loadSaved());
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [ready,setReady]=useState<boolean|null>(null);
  const submitted=useRef(false);
  useEffect(()=>{
    let active=true;
    fetch("/api/investigate",{cache:"no-store"})
      .then((r)=>r.json()).then((x)=>{if(active)setReady(x?.live===true);})
      .catch(()=>{if(active)setReady(false);});
    return ()=>{active=false};
  },[]);
  useEffect(()=>{
    if(initial&&initial!==result?.claim) setClaim(initial);
  },[initial, result?.claim]);
  useEffect(()=>{
    if(!initial||ready!==true||submitted.current) return;
    submitted.current=true;
    void perform(initial,"",undefined);
  },[initial,ready]);
  async function perform(value:string,search:string,snapshot?:string){
    if(busy)return;
    setBusy(true);setError("");
    try{
      const found=await gateway(value.trim(),search.trim(),snapshot);
      setResult(found);
      sessionStorage.setItem(storageKey,JSON.stringify(found));
      setQuery("");
    }catch(e){
      setError(asMessage((e as Error)?.message));
    }finally{setBusy(false);}
  }
  function newCase(){
    setResult(null);setClaim("");setQuery("");setError("");
    submitted.current=true;
    sessionStorage.removeItem(storageKey);
  }
  function download(){
    if(!result)return;
    const {snapshot,...publicRecord}=result;
    const file=new Blob([JSON.stringify({
      kind:"trace-live-evidence",exportedAt:new Date().toISOString(),
      note:"这份文件只包含浏览器收到的真实检索记录，不等同人工事实审核。",
      ...publicRecord,
    },null,2)],{type:"application/json;charset=utf-8"});
    const url=URL.createObjectURL(file);
    const a=document.createElement("a");
    a.href=url;a.download="TRACE-调查证据.json";a.click();
    URL.revokeObjectURL(url);
  }
  const active=result;
  const actionable=active?.gaps?.slice(0,3)||[];
  const remaining=(active?.rounds.length||0)<3;
  return (
    <main className="trace-page trace-page-wide trace-live" aria-label="实时联网调查">
      <div className="trace-live-top">
        <Link to="/"><ArrowLeft size={16}/> 返回首页</Link>
        <span className="trace-live-live-tag">实时调查 · 腾讯元宝 SearchPro</span>
      </div>
      <header className="trace-live-header">
        <span className="trace-eyebrow">每一句结论都需要证据</span>
        <h1>追查一条说法</h1>
        <p>输入想核实的信息。系统会在服务端搜索真实网页、比对时间与范围，并标出哪些事实还没有得到证明。</p>
      </header>
      {ready===false?(
        <div className="trace-live-unavailable" role="status">
          <ShieldAlert size={18}/>
          <div><strong>联网调查尚未开放</strong>
            <p>当前服务未配置完整的搜索密钥与防滥用额度，无法安全地发起新查询。历史调查仍可在首页查看。</p></div>
        </div>
      ):null}
      <section className="trace-live-form" aria-label="新调查">
        <label htmlFor="trace-live-claim">待调查问题或说法</label>
        <textarea id="trace-live-claim" rows={3} maxLength={400}
          value={claim} onChange={(e)=>setClaim(e.target.value)}
          placeholder="例如：《个人信息保护法》自2021年8月20日起施行。"/>
        <p className="trace-live-help">事实核查按原句立案。疑问句和多来源数据对照，建议写出具体要核实的说法；这里不会擅自生成用户没有确认的断言。</p>
        {!active?(
          <button className="trace-btn trace-btn-primary trace-btn-lg" disabled={ready!==true||busy||claim.trim().length<6} onClick={()=>void perform(claim,query)}>
            <Search size={16}/>{busy?"正在搜索与核验…":"开始真实调查"}
          </button>
        ):(
          <div className="trace-live-actions">
            <button className="trace-btn" onClick={newCase}>开始另一条调查</button>
            <button className="trace-btn" onClick={download}><Download size={14}/> 下载本次证据</button>
          </div>
        )}
        <small>搜索文本会发送到腾讯云元宝搜索。调查暂存在本浏览器标签页，可自行清空或导出；服务端不保存个人调查历史。</small>
      </section>
      {error?<div className="trace-alert" role="alert">{error}</div>:null}
      {busy?<div className="trace-live-progress" role="status" aria-live="polite"><span className="trace-live-spinner"/>正在检索网页并核对证据。原文可能因反爬或网页限制无法读取，系统会单独标记。</div>:null}
      {active?(
        <>
          <section className="trace-live-verdict" data-outcome={active.outcome}>
            <div className="trace-live-verdict-head">
              <div><span className="trace-eyebrow">本次检索结论</span><h2>{active.label}</h2></div>
              <span className="trace-live-count">第 {active.rounds.length}/3 轮</span>
            </div>
            <p>{active.statement}</p>
            {active.kind === "comparison" && (active.figures?.length || 0) > 0 ? (
              <div className="trace-live-figures" aria-label="不同来源数字的核对">
                {active.figures!.map((figure,index)=>(
                  <div key={figure.publisher+figure.value+index}>
                    <span>{figure.publisher}</span>
                    <b>{figure.value}{figure.unit}</b>
                    <p>「{figure.sentence}」</p>
                    <small>{figure.from === "body" ? "原文正文" : "搜索摘要"}</small>
                    <a href={figure.url} target="_blank" rel="noreferrer noopener">核对来源 <ExternalLink size={12}/></a>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="trace-live-metrics">
              <span><b>{active.counts.pages}</b> 条网页</span>
              <span><b>{active.counts.bodies}</b> 份已取得正文</span>
              <span><b>{active.counts.keyEvidence}</b> 处与说法直接相关的正文证据</span>
            </div>
            {active.rawStatus?<p className="trace-live-warning">本轮搜索服务状态：{active.rawStatus}。历史成功来源仍保留。</p>:null}
            {active.reasons?.length?(
              <details className="trace-live-reasons">
                <summary>查看判断依据</summary>
                <ul>{active.reasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul>
              </details>
            ):null}
          </section>
          <section className="trace-live-evidence">
            <div className="trace-live-section-head"><div><span className="trace-eyebrow">Evidence</span><h2>查到了什么证据</h2></div>
              <span>{active.sources.length} 条相关来源</span></div>
            {active.sources.length===0?
              <div className="trace-live-empty">本次搜索尚未找到可以引用的相关网页。请用下面的“继续追查”换一个更具体的检索词。</div>:
              <div className="trace-live-source-list">
                {active.sources.map((s)=>(
                  <article key={s.id} className="trace-live-source" data-relation={s.relation}>
                    <div className="trace-live-source-top">
                      <span className={DECISIVE.has(s.relation)?"trace-live-source-label strong":"trace-live-source-label"}>{labels[s.relation]||"待核查"}</span>
                      <span>{s.body?"已核对网页正文":"仅搜索摘要或正文未命中"}</span>
                    </div>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="trace-live-source-title">
                      {s.title || s.site}<ExternalLink size={14}/>
                    </a>
                    <p>「{s.sentence}」</p>
                    <div className="trace-live-source-meta">
                      <span>{s.site}</span>{s.date?<span>{s.date}</span>:null}
                      {s.independence==="unconfirmed"?<span>来源独立性未确认</span>:null}
                      {s.origin?<span>引用出处：{s.origin}</span>:null}
                    </div>
                  </article>
                ))}
              </div>
            }
          </section>
          <section className="trace-live-gaps">
            <div className="trace-live-section-head"><div><span className="trace-eyebrow">What's missing</span><h2>还有哪些证据没查清</h2></div></div>
            {actionable.length?(
              <ul>{actionable.map((g,i)=><li key={i}>{g}</li>)}</ul>
            ):<p>本次规则没有提出新的缺证据问题。仍可查看上方原文，并自行核对来源。</p>}
            {active.mayContinue && remaining?(
              <div className="trace-live-followup">
                <label htmlFor="trace-live-next">下一步追查什么？</label>
                <input id="trace-live-next" value={query} maxLength={120}
                  placeholder="例如：该法律 官方全文 施行日期" onChange={(e)=>setQuery(e.target.value)}/>
                <button className="trace-btn trace-btn-primary" disabled={busy||ready!==true||query.trim().length<3}
                  onClick={()=>void perform(active.claim,query,active.snapshot)}>
                  <Search size={14}/>{busy?"正在继续追查…":"继续真实搜索"}<ArrowRight size={14}/>
                </button>
                <small>会发起新的元宝请求。新证据将与之前已取得的证据一起重新核验；查不到时保留不确定状态。</small>
              </div>
            ):<p className="trace-live-help">此调查已到公开试用的追查次数上限。可下载记录，或重新调查另一条说法。</p>}
          </section>
          <section className="trace-live-rounds">
            <details>
              <summary>真实搜索过程（{active.rounds.length}轮）</summary>
              <ol>{active.rounds.map((r,i)=><li key={i}>
                <strong>{r.query}</strong> · 返回 {r.count} 条 · {(r.durationMs/1000).toFixed(1)} 秒
                {r.error?<span> · 失败：{r.error}</span>:null}
                {r.requestId?<small> · SearchPro 请求标识 {r.requestId}</small>:null}
              </li>)}</ol>
            </details>
          </section>
        </>
      ):null}
    </main>
  );
}
