/**
 * 输入导入（AI 识图）：把用户明确同意上传的截图交给平台已配置的模型读字。
 *
 * 为什么需要这一条：本机 Tesseract 对「实拍照片 + 白色标签块」这类视频截图
 * 识别很差（实测同一张图只读出半行并夹大量噪声），而平台配置的
 * deepseek-flash 支持图片输入，能逐行读全。
 *
 * 三条硬边界：
 *  1. 只有用户显式选择「AI 识别」才会把图片发出去；默认仍是本机 OCR，不上传；
 *  2. 原图不落库、不写磁盘，只在这一次请求的内存里转成 base64；
 *  3. 模型只负责「读出图上的字」，不判断真假；识别结果一律标为「尚未核实」，
 *     必须经用户校对并勾选确认才能进入调查。
 */
import type { FastifyInstance } from "fastify";
import { ExecutionError } from "./contracts.ts";
import type { Store } from "./store.ts";
import { modelConfiguration } from "./providers.ts";
import { now } from "./util.ts";

/** 图片体积上限与前端一致：5MB（解码后）。 */
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
/** 单次识图超时：实测 1MB 图片约 6 秒，给足余量。 */
const TIMEOUT_MS = 120_000;

const SYSTEM_PROMPT =
  "你是图片文字转录器。只转录图片里真实出现的文字，不解释、不总结、不补全、不翻译。" +
  "每行一条，保持原有顺序与标点；模糊或看不清的字写成[看不清]，不要猜。" +
  "如果图片里没有可读文字，只输出[没有识别到文字]。";

function dailyVisionLimit() {
  const raw = Number(process.env.PLATFORM_VISION_PER_DAY);
  return Number.isFinite(raw) && raw > 0 ? Math.min(200, Math.trunc(raw)) : 20;
}

/** 去掉模型可能加的代码块围栏与多余空行，不改变文字内容。 */
export function tidyVisionText(raw: string) {
  return String(raw || "")
    .replace(/^```[a-zA-Z]*\s*/m, "")
    .replace(/```\s*$/m, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line, index, all) => line.trim() || (index > 0 && all[index - 1]?.trim()))
    .join("\n")
    .trim();
}

export function registerImageIntake(app: FastifyInstance, store: Store) {
  app.post<{ Body: { image: string; mime: string } }>(
    "/v1/ingest/image",
    {
      // 5MB 图片 base64 后约 6.7MB，超过默认 1MB 的全局上限。
      bodyLimit: 9 * 1024 * 1024,
      schema: {
        body: {
          type: "object",
          required: ["image", "mime"],
          additionalProperties: false,
          properties: {
            image: { type: "string", minLength: 64, maxLength: 8_000_000 },
            mime: { type: "string", enum: [...ALLOWED_MIME] },
          },
        },
      },
    },
    async (req) => {
      const config = modelConfiguration();
      if (!config.available)
        throw new ExecutionError(
          "BLOCKED_MODEL_NOT_CONFIGURED",
          "当前实例没有可用的模型配置，无法用 AI 识图；可以改用本机识别。",
        );

      const { image, mime } = req.body;
      const base64 = image.replace(/^data:[^;]+;base64,/, "");
      let bytes: Buffer;
      try {
        bytes = Buffer.from(base64, "base64");
      } catch {
        throw new ExecutionError("IMAGE_INVALID", "图片数据无法解析，请重新选择文件。");
      }
      if (!bytes.length)
        throw new ExecutionError("IMAGE_INVALID", "图片数据为空，请重新选择文件。");
      if (bytes.length > MAX_BYTES)
        throw new ExecutionError("IMAGE_TOO_LARGE", "图片超过 5MB，请裁剪或压缩后再上传。");

      // 会话级每日上限：AI 识图按次计费，必须有闸门（公网实例由 public-guard 保证有会话）。
      const session = (req as unknown as { traceSession?: { id: string } }).traceSession;
      const sessionId = session?.id || "local";
      const day = now().slice(0, 10);
      const used = Number(
        store.get(
          "SELECT count FROM usage_daily WHERE day=? AND scope='session' AND scope_key=? AND metric='vision'",
          day,
          sessionId,
        )?.count || 0,
      );
      const limit = dailyVisionLimit();
      if (used >= limit)
        throw new ExecutionError(
          "VISION_QUOTA_EXCEEDED",
          `今天的 AI 识图次数用完了（每天 ${limit} 次）。可以改用本机识别，或直接粘贴原话。`,
        );

      const startedAt = Date.now();
      let payload: any = null;
      try {
        const response = await fetch(
          process.env.PLATFORM_MODEL_BASE_URL!.replace(/\/$/, "") + "/chat/completions",
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: {
              "content-type": "application/json",
              authorization: "Bearer " + process.env.PLATFORM_MODEL_API_KEY,
            },
            body: JSON.stringify({
              model: config.model,
              max_tokens: 1500,
              temperature: 0,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                {
                  role: "user",
                  content: [
                    { type: "text", text: "逐行转录这张图片里的中文文字。" },
                    {
                      type: "image_url",
                      image_url: { url: `data:${mime};base64,${base64}` },
                    },
                  ],
                },
              ],
            }),
          },
        );
        const body = await response.text();
        if (!response.ok) {
          const code =
            response.status === 401 || response.status === 403
              ? "MODEL_AUTH_FAILED"
              : response.status === 429
                ? "MODEL_RATE_LIMITED"
                : "MODEL_FAILED";
          throw new ExecutionError(
            code,
            response.status === 429
              ? "模型服务限流了，请稍后再试，或改用本机识别。"
              : `AI 识图失败（HTTP ${response.status}）：${body.slice(0, 160)}`,
          );
        }
        payload = JSON.parse(body);
      } catch (error) {
        if (error instanceof ExecutionError) throw error;
        const aborted = (error as Error)?.name === "TimeoutError";
        throw new ExecutionError(
          aborted ? "MODEL_TIMEOUT" : "MODEL_FAILED",
          aborted
            ? "AI 识图超时（图片可能过大或模型繁忙），可以改用本机识别。"
            : `AI 识图请求失败：${(error as Error)?.message || "未知原因"}。可以改用本机识别。`,
        );
      }

      const text = tidyVisionText(payload?.choices?.[0]?.message?.content || "");
      if (!text)
        throw new ExecutionError(
          "VISION_EMPTY",
          "模型没有从这张图里读出文字。可以换一张更清晰的截图，或改用本机识别。",
        );

      store.exec(
        "INSERT INTO usage_daily(day,scope,scope_key,metric,count,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(day,scope,scope_key,metric) DO UPDATE SET count=excluded.count,updated_at=excluded.updated_at",
        day,
        "session",
        sessionId,
        "vision",
        used + 1,
        now(),
      );

      return {
        text,
        model: String(payload?.model || config.model || ""),
        tookMs: Date.now() - startedAt,
        usage: payload?.usage || null,
        bytes: bytes.length,
        remainingToday: Math.max(0, limit - used - 1),
        note: "AI 只负责读图上的字；识别结果尚未核实，请校对后再调查。原图不保存。",
      };
    },
  );
}
