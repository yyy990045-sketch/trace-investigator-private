/**
 * 浏览器本地 OCR（Tesseract.js）。
 *
 * 为什么放本地：
 *  - 截图里常含聊天记录、姓名等信息，本轮不上传原图、不落库；
 *  - 识别只负责「把字读出来」，不判断真假，也不产生任何结论。
 *
 * 资源来源（写死版本，便于复核）：
 *  - 引擎：tesseract.js 7.0.0（npm 依赖，随前端产物一起发布）
 *  - worker/core/language data：默认走 jsdelivr CDN 与 tessdata 镜像，
 *    失败时由调用方显示「识别失败」，不静默降级成假文字。
 *  - 语言：chi_sim（简体中文）+ eng（英文）
 */
import { createWorker } from "tesseract.js";

export const OCR_ENGINE = "tesseract.js 7.0.0（chi_sim+eng，浏览器本地识别）";
export const OCR_LANG_PATH = "https://tessdata.projectnaptha.com/4.0.0";

export interface OcrProgress {
  status: string;
  progress: number;
}

export interface OcrResult {
  text: string;
  confidence: number;
}

let workerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;

function getWorker(onProgress: (p: OcrProgress) => void) {
  if (!workerPromise) {
    workerPromise = createWorker(["chi_sim", "eng"], undefined, {
      langPath: OCR_LANG_PATH,
      logger: (message: { status?: string; progress?: number }) =>
        onProgress({
          status: String(message.status || "working"),
          progress: Number(message.progress || 0),
        }),
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

/** 识别一张图片；失败时抛错，由界面显示失败原因。 */
export async function recognizeImage(
  file: File | Blob,
  onProgress: (p: OcrProgress) => void,
): Promise<OcrResult> {
  const worker = await getWorker(onProgress);
  const result = await worker.recognize(file);
  return {
    text: result?.data?.text || "",
    confidence: Number(result?.data?.confidence || 0),
  };
}
