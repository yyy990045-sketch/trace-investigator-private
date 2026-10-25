/**
 * 输入导入：把一个公开网页链接读成「待核查材料」。
 *
 * 只复用现有受保护抓取（`fetch-source.ts`：协议限制、SSRF 校验、重定向校验、
 * 超时与字节上限），不自建爬虫，也不尝试解析短视频平台。
 *
 * 三条硬边界：
 *  1. 抓到的正文只是**待核查材料**，不进入证据体系，不算独立支持来源；
 *  2. 短视频链接（抖音/快手等）不抓取，直接告诉用户补截图或复制原话；
 *  3. 失败必须报错，不返回空字符串让上层误以为成功。
 */
import type { FastifyInstance } from "fastify";
import { ExecutionError } from "./contracts.ts";
import { fetchSource } from "../adapters/trace/fetch-source.ts";

/** 只读正文，够用户挑一句就停，不把整站读进来。 */
const MAX_CHARS = 6000;
/** 少于这个长度就当作没读到正文。 */
const MIN_CHARS = 20;

/** 不抓取的短视频平台：没有稳定、合规、可复核的公开读取方式。 */
const SHORT_VIDEO_HOSTS =
  /(^|\.)(douyin\.com|iesdouyin\.com|kuaishou\.com|xiaohongshu\.com|xhslink\.com|bilibili\.com|weibo\.com)$/i;

const UNREADABLE_MESSAGE =
  "暂时无法读取这条视频的口播或字幕，请上传视频截图，或复制视频中的原话。";

export function registerLinkIntake(app: FastifyInstance) {
  app.post<{ Body: { url: string } }>(
    "/v1/ingest/link",
    {
      schema: {
        body: {
          type: "object",
          required: ["url"],
          additionalProperties: false,
          properties: {
            url: { type: "string", minLength: 8, maxLength: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      const raw = String(req.body.url || "").trim();
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        throw new ExecutionError("LINK_INVALID", "这个链接格式不正确，请粘贴完整网址。");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        throw new ExecutionError("LINK_INVALID", "只接受 http/https 链接。");
      if (SHORT_VIDEO_HOSTS.test(parsed.hostname))
        throw new ExecutionError("LINK_UNREADABLE", UNREADABLE_MESSAGE);

      const source = await fetchSource(parsed.toString(), {
        timeoutMs: 12000,
        maxBytes: 1_200_000,
      });
      if (!source.ok && parsed.protocol === "https:" && /^(?:www\.)?npc\.gov\.cn$/.test(parsed.hostname) && /SSL|TLS|CERT|EPROTO/.test(source.error?.code || "")) {
        const alternative = new URL(parsed);
        alternative.protocol = "http:";
        return reply.code(422).send({ code: "LINK_TLS_FAILED", message: "人大网站的 HTTPS 连接失败。可选择读取同一地址的 HTTP 公开页面；HTTP 传输未经加密，请核对原文。", httpAlternative: alternative.toString() });
      }
      if (!source.ok)
        throw new ExecutionError(
          "LINK_FETCH_FAILED",
          source.error?.message
            ? `没有读到这个页面的正文：${source.error.message}`
            : "没有读到这个页面的正文，请换一个可直接访问的链接。",
        );

      const text = String(source.text || "").replace(/\s+/g, " ").trim();
      if (text.length < MIN_CHARS)
        throw new ExecutionError(
          "LINK_NO_CONTENT",
          "这个页面没有可引用的正文（可能要求登录、付费或为动态页面），请换一个页面或直接复制原话。",
        );

      return {
        url: source.finalUrl || parsed.toString(),
        title: source.title || parsed.hostname,
        text: text.slice(0, MAX_CHARS),
        truncated: text.length > MAX_CHARS,
        bytes: source.bytes,
        fetchedAt: source.fetchedAt,
        // 前端要用同一句话提示用户：网页自述不等于已核实证据。
        note: "网页正文只作为待核查材料，不作为独立支持证据。" + (parsed.protocol === "http:" ? "本次使用 HTTP，传输未经加密。" : ""),
      };
    },
  );
}
