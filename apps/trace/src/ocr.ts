/**
 * 浏览器本地 OCR（Tesseract.js）。
 *
 * 为什么放本地：
 *  - 截图里常含聊天记录、昵称等信息，本轮不上传原图、不落库；
 *  - 识别只负责「把字读出来」，不判断真假，也不产生任何结论。
 *
 * 资源全部同源自托管（`apps/trace/public/ocr/`，随前端产物发布）：
 *  - 引擎：tesseract.js 7.0.0（npm 依赖）
 *  - worker：worker.min.js（来自 tesseract.js/dist）
 *  - core：tesseract-core-simd-lstm.wasm(.js)（来自 tesseract.js-core）
 *  - 语言包：chi_sim / eng（tessdata 4.0.0，@tesseract.js-data 的 int 量化版）
 *
 * 之前从 jsdelivr / tessdata 走公网 CDN，国内网络经常「连上了但一直不返回」，
 * 于是界面永久卡在「正在加载识别引擎」。现在同源加载，并且额外加超时保护：
 * 初始化或识别超过时限就抛错，让界面能退出忙碌状态。
 */
import { createWorker } from "tesseract.js";

export const OCR_ENGINE = "tesseract.js 7.0.0（chi_sim+eng，浏览器本地识别，资源同源自托管）";
export const OCR_ASSET_BASE = "/ocr";
/** 语言包单独放版本目录：换语言包时路径变化，浏览器不会命中旧缓存。 */
export const OCR_LANG_DIR = `${OCR_ASSET_BASE}/4.0.0_best`;
/**
 * 首次要同源下载 core 与语言包（约 27MB：中文 best 包 20MB + 英文 2MB + core 6MB），
 * 之后浏览器缓存，实测二次识别约 8 秒。给足时间但仍然必须有上限，
 * 否则网络半通时会永久卡在「正在加载识别引擎」。
 */
export const OCR_TIMEOUT_MS = 180_000;

export interface OcrProgress {
  status: string;
  progress: number;
}

export interface OcrResult {
  text: string;
  confidence: number;
}

type Worker = Awaited<ReturnType<typeof createWorker>>;

let workerPromise: Promise<Worker> | null = null;

function getWorker(onProgress: (p: OcrProgress) => void) {
  if (!workerPromise) {
    workerPromise = createWorker(["chi_sim", "eng"], undefined, {
      workerPath: `${OCR_ASSET_BASE}/worker.min.js`,
      corePath: OCR_ASSET_BASE,
      langPath: OCR_LANG_DIR,
      logger: (message: { status?: string; progress?: number }) =>
        onProgress({
          status: String(message.status || "working"),
          progress: Number(message.progress || 0),
        }),
    }).catch((error) => {
      // 失败后不要把坏掉的 Promise 缓存下来，否则重试永远失败。
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

/** 丢弃缓存的 worker（超时或取消后调用），下次重新初始化。 */
export function resetOcrWorker() {
  const pending = workerPromise;
  workerPromise = null;
  void pending
    ?.then((worker) => worker.terminate().catch(() => {}))
    .catch(() => {});
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 识别一张图片；超时或失败都抛错，由界面显示原因并解除忙碌状态。 */
export async function recognizeImage(
  file: File | Blob,
  onProgress: (p: OcrProgress) => void,
  options: { timeoutMs?: number } = {},
): Promise<OcrResult> {
  const timeoutMs = options.timeoutMs ?? OCR_TIMEOUT_MS;
  try {
    const worker = await withTimeout(getWorker(onProgress), timeoutMs, "OCR_ENGINE_TIMEOUT");
    // 不做预放大：实测放大 1.6 倍会把「自」认成「目」这类形近字，原尺寸配合
    // best 语言包反而更准。这里直接送原图（仍不上传、不落库）。
    const result = await withTimeout(worker.recognize(file), timeoutMs, "OCR_RECOGNIZE_TIMEOUT");
    return {
      text: result?.data?.text || "",
      confidence: Number(result?.data?.confidence || 0),
    };
  } catch (error) {
    // 超时意味着 worker 可能卡在半初始化状态：丢掉它，避免下次继续卡。
    resetOcrWorker();
    throw error;
  }
}
