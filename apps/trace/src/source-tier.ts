/**
 * 来源层级：官方原始 > 权威机构 > 媒体报道 > 其他。
 *
 * 用户需要知道「这个数字是官方公告写的，还是媒体转述的」——
 * 同一句话来自不同层级，可信度不一样，不能混在一起说。
 */
export type SourceTier = "official" | "authority" | "media" | "other";

const MEDIA = [
  "people.com.cn", "xinhuanet.com", "news.cn", "cctv.com", "cnr.cn", "chinanews.com.cn",
  "thepaper.cn", "caixin.com", "yicai.com", "stcn.com", "cs.com.cn", "jiemian.com",
  "sina.com.cn", "sohu.com", "163.com", "qq.com", "toutiao.com", "baijiahao.baidu.com",
  "ithome.com", "36kr.com", "huxiu.com", "guancha.cn", "jiemian.com", "ifeng.com",
  "mtime.com", "douban.com", "baike.baidu.com", "zhihu.com", "bilibili.com",
];

const OFFICIAL = [
  "gov.cn", "stats.gov.cn", "mofcom.gov.cn", "mct.gov.cn", "pbc.gov.cn", "nmpa.gov.cn",
  "court.gov.cn", "spp.gov.cn", "miit.gov.cn", "samr.gov.cn",
];

export function sourceTier(url: string, site = ""): { tier: SourceTier; label: string } {
  const value = `${url} ${site}`.toLowerCase();
  if (OFFICIAL.some((domain) => value.includes(domain))) return { tier: "official", label: "官方" };
  if (/(\.gov(\.|$)|\.gov\.cn)/.test(value)) return { tier: "official", label: "官方" };
  if (/(\.edu(\.cn)?|\.ac\.cn|\.org\.cn|who\.int|un\.org)/.test(value)) return { tier: "authority", label: "权威机构" };
  if (MEDIA.some((domain) => value.includes(domain))) return { tier: "media", label: "媒体" };
  return { tier: "other", label: "其他来源" };
}

/** 结论用的层级说明：媒体转述时明确说还没找到官方原文。 */
export function tierNote(tiers: SourceTier[]): string {
  if (!tiers.length) return "";
  if (tiers.includes("official")) return "依据中有官方原始页面";
  if (tiers.includes("authority")) return "依据来自权威机构页面，未见官方原始公告";
  return "目前依据来自媒体报道，尚未找到官方原始公告";
}
