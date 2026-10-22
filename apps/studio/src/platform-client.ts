import { createRuntimeClient } from "@personal/capability-sdk";
/** Studio 与新增产品页面共用的同一份 Runtime 客户端。 */
export const client = createRuntimeClient(
  import.meta.env.VITE_RUNTIME_API_URL || "/api",
);
const ACTOR_KEY = "platform:actor";
export function readActor() {
  try {
    return localStorage.getItem(ACTOR_KEY) || "";
  } catch {
    return "";
  }
}
export function rememberActor(value: string) {
  try {
    localStorage.setItem(ACTOR_KEY, value);
  } catch {
    /* 只是本机偏好，存不住不影响记录人填写。 */
  }
}
