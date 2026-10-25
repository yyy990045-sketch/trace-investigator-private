/**
 * 搜索侦探的轻量意图分流。前后端共用同一套语义边界：
 * 影视作品身份可以用“候选-线索”追查；
 * 演出余票、传言及开放事实问题必须走“出处-主张”核验流程。
 * 这仅确定处理路径，不预先给出事实答案。
 */
export type InvestigationDomain = "screen" | "event" | "verification" | "general";
export type InvestigationFlow = "clue" | "verification";

export function detectInvestigationDomain(question: string): InvestigationDomain {
  const q = question.trim();
  if (/演唱会|音乐节|巡演|售票|余票|还有票|开票|门票|票务|场次/.test(q)) return "event";
  if (/网传|传言|谣言|真假|真实吗|是真的吗|官方宣布|是否属实|有没有依据|消息可靠|公告/.test(q))
    return "verification";
  if (/电影|电视剧|剧名|港片|动画|动漫|演员|法医|卧底|主角|剧情|哪部剧|哪部片|片名|看过一部|短剧|综艺|剧集/.test(q))
    return "screen";
  return "general";
}

export function investigationFlow(question: string, selected: InvestigationFlow): InvestigationFlow {
  if (selected === "verification") return "verification";
  // A known work with a question about a character or credit needs a sourced answer.
  if (/(?:父亲|母亲|妻子|丈夫|导演|编剧|配音)(?:的名字)?(?:是谁|叫什么|是哪位)/.test(question)) return "verification";
  // 其它主题并无影视候选实体模型；不能让演出票务落入找电影的判断器。
  return detectInvestigationDomain(question) === "screen" ? "clue" : "verification";
}
