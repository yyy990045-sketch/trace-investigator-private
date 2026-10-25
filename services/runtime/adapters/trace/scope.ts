import { ExecutionError } from "../../src/contracts.ts";

/** Product boundary, evaluated locally before any model or search request. */
export function traceScopeReason(text: string, context = ""): string | null {
  const value = String(text || "").normalize("NFKC");
  const fiction = (/虚构|角色|剧情|动画|小说|电影里|剧中|书中/.test(value + context) ||
    /《[^》]+》/.test(value + context) && !/传记|回忆录|自传|人物访谈/.test(value + context)) &&
    !/(?:演员|明星|艺人|导演|真人).{0,16}(?:家庭|住址|妻子|丈夫|老婆|老公|女友|男友|绯闻|出轨|恋情|离婚|近况|动态)/.test(value);
  const marriageRumor = /传闻|传言|绯闻|恋情|离婚了|结婚了|是否离婚|是否结婚/.test(value);
  const aggregateQuestion = value.replace(/请问|查询|查一下|是多少|多少|[\s？?。]/g, "");
  const marriageAggregate = /^(?:(?:19|20)\d{2}年|每年|年度)?(?:中国|全国|各省|各地|全省|全市)?(?:(?:19|20)\d{2}年|每年)?(?:结婚|离婚|婚姻)登记(?:总数|总量|数量|人数|对数|比例|统计|数据|数|情况)$/.test(aggregateQuestion);
  const marriageLaw = /(?:离婚|结婚|婚姻)(?:登记|法律|法定|协议|诉讼|程序|条件|手续)|(?:法律|法规|法条|规定).{0,8}(?:离婚|结婚|婚姻)(?:登记|程序|手续|条件)/.test(value);
  const publicMarriage = !marriageRumor && (marriageAggregate || marriageLaw);
  if (/时政|政治|政党|党派|大选|总统选举|竞选|政变|国家领导人|现任总统|政治人物|总统近况|总理近况|中美关系|国际局势|俄乌局势|台海局势|选情|政坛|最新言论/.test(value))
    return "本作品不调查时政或政治人物消息，请改为公开作品、科学知识、通用法律条文或统计事实。";
  const withoutOfficialContact = value.replace(/客服电话(?:号码)?|客服热线|(?:公司|企业|商家|机构)(?:的)?(?:官方|公开|客服)?(?:电话号码|电话|联系方式)/g, "");
  if (/身份证|家庭住址|家庭地址|私人住址|现住地|住在哪里|住在哪儿|人肉|开盒|个人行踪|私人电话|私人邮箱|健康隐私|病历|银行卡号/.test(value) ||
      /手机号|手机号码/.test(value) || /电话号码|联系方式|住址/.test(withoutOfficialContact) ||
      /婚外情|出轨|绯闻|恋情|离婚|结婚传闻/.test(value) && !publicMarriage && !fiction)
    return "本作品不查询真人隐私、私人联系方式、行踪或私人传言。影视查询请描述作品或虚构角色。";
  if (/(?:演员|明星|艺人|导演|某人|这个人|这人|他|她).{0,18}(?:近况|现状|动态|最近怎么样|私生活|个人资料|履历|背景调查|身世|家庭|老婆|老公)|(?:调查|查查|查一下|查找).{0,12}(?:这个人|某人|真人|个人背景)|个人消息|人物调查/.test(value))
    return "本作品不做真人消息或人物调查；可以查询公开影视作品及其演职员信息。";
  const media = /电影|影视|电视剧|剧集|片名|剧名|作品|演职员|主演|饰演|扮演|虚构|角色|剧情|动画|小说|纪录片/.test(value);
  const credits = /(?:导演|演员|编剧|作者).{0,12}(?:哪些|哪部|哪一部|作品|执导|主演|出演|拍过)/.test(value);
  if (!fiction && !publicMarriage && /父亲|母亲|妻子|丈夫|老婆|老公|女友|男友|子女|家人|私生活|个人履历|个人动态/.test(value))
    return "人物家庭和私人动态不在调查范围；若指虚构角色，请明确作品和角色。";
  // A work title does not turn an actor's real-life news into fictional plot.
  if (/近况|个人动态|最近怎么样|最近在做什么|今天.{0,8}说了什么/.test(value) ||
      /现状|最新动态/.test(value) && !/(?:手机|平板|电脑|游戏机|新能源汽车|机器人|演唱会|展会|项目|工程|产业|行业|市场|网络)(?:的)?(?:现状|最新动态)/.test(value))
    return "人物近况和动态不在调查范围；若指产品或作品，请明确产品或作品名称与类型。";
  if (!media && !credits && !fiction && /谁是|是谁|叫什么名字|人物资料|个人资料|生平|出生日期|出生年月|出生地|多大年龄/.test(value))
    return "无法确认这是作品线索还是人物查询。请补充作品名、虚构角色或明确的公开演职员查询范围，再开始搜索。";
  return null;
}

export function assertTraceScope(text: string, context = "") {
  const reason = traceScopeReason(text, context);
  if (reason) throw new ExecutionError("TRACE_SCOPE_RESTRICTED", reason);
}

export function assertTraceInputScope(input: { text?: string; payload?: any }) {
  const payload = input.payload || {};
  const context = [input.text, payload.question, payload.claim].filter(Boolean).join(" ");
  for (const value of [input.text, payload.question, payload.claim]) if (value) assertTraceScope(String(value), context);
  for (const fact of Array.isArray(payload.facts) ? payload.facts : []) {
    assertTraceScope(String(fact.text || ""), context);
    for (const query of Array.isArray(fact.queries) ? fact.queries : []) assertTraceScope(String(query), context);
  }
}
