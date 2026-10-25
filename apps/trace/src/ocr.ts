/** Browser-only OCR. Images stay local; all engine and language resources are same-origin. */
import { createWorker } from "tesseract.js";
export const OCR_ENGINE = "tesseract.js 7.0.0（chi_sim+eng，浏览器本地识别）";
function resource(path: string) {
  return new URL(`${import.meta.env.BASE_URL}ocr/v7/${path}`, document.baseURI).href;
}
export interface OcrProgress { status: string; progress: number }
export interface OcrResult { text: string; confidence: number }
type OcrWorker = Awaited<ReturnType<typeof createWorker>>;
let workerPromise: Promise<OcrWorker> | null = null;
let progress: (value: OcrProgress) => void = () => {};
function deadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([operation, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("识别资源加载或处理超时，请检查本站连接后重试")), milliseconds);
  })]).finally(() => clearTimeout(timer));
}
function getWorker() {
  if (!workerPromise) {
    const pending = createWorker(["chi_sim", "eng"], 1, {
      workerPath: resource("runtime/worker.min.js"),
      corePath: resource("runtime"),
      langPath: resource("lang"),
      workerBlobURL: false,
      logger: (message: { status?: string; progress?: number }) => progress({
        status: String(message.status || "working"), progress: Number(message.progress || 0),
      }),
      errorHandler: () => {}, // Rejection is handled and displayed by the caller.
    });
    workerPromise = deadline(pending, 60000).catch((error) => {
      void pending.then((worker) => worker.terminate()).catch(() => {});
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}
export async function recognizeImage(file: File | Blob, onProgress: (value: OcrProgress) => void): Promise<OcrResult> {
  progress = onProgress;
  const worker = await getWorker();
  try {
    const result = await deadline(worker.recognize(file), 90000);
    return { text: result.data.text || "", confidence: Number(result.data.confidence || 0) };
  } catch (error) {
    workerPromise = null;
    await worker.terminate().catch(() => {});
    throw error;
  }
}
