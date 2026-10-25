import { currentSessionToken, ensureSession } from "./api";
export interface VisionStatus { available: boolean; model: string; provider: string; reason: string }
export interface VisionResult { text: string; model: string; provider: string; lineCount: number; note: string }
const root = () => (import.meta.env.VITE_RUNTIME_API_URL || "/api").replace(/\/$/, "");
function headers() {
  const token = currentSessionToken();
  return { "content-type": "application/json", "x-platform-client": "workbench-v1", ...(token ? { "x-trace-session": token } : {}) };
}
export async function visionAvailability(): Promise<VisionStatus> {
  await ensureSession();
  const response = await fetch(`${root()}/v1/ingest/image/availability`, { headers: headers(), credentials: "same-origin" });
  if (!response.ok) throw new Error("AI识图当前不可用，可以使用本地识别。");
  return response.json();
}
export async function recognizeWithAI(file: File, signal: AbortSignal): Promise<VisionResult> {
  // Re-encode locally to strip metadata and bound provider image size. Pixels stay legible.
  const image = await createImageBitmap(file);
  let dataUrl: string;
  try {
    if (image.width * image.height > 40_000_000) throw new Error("图片像素过大，请裁剪文字区域后重试。");
    const ratio = Math.min(1, 2400 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法读取图片，请换一张截图。");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL("image/jpeg", .95);
  } finally { image.close(); }
  signal.throwIfAborted();
  await ensureSession();
  signal.throwIfAborted();
  const response = await fetch(`${root()}/v1/ingest/image/vision`, {
    method: "POST", credentials: "same-origin", headers: headers(), signal,
    body: JSON.stringify({ image: dataUrl, consent: true }),
  });
  const result = await response.json().catch(() => null) as (VisionResult & { message?: string }) | null;
  if (!response.ok || !result) throw new Error(result?.message || `AI识图失败（HTTP ${response.status}），可以改用本地识别。`);
  return result;
}
