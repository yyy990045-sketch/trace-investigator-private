import { useState } from "react";
import { Button, StatePanel, DemoNotice } from "@personal/ui-core";

export function NotesModule() {
  const [state, setState] = useState<"ready" | "empty" | "error" | "loading">(
    "ready",
  );
  const [note, setNote] = useState(
    () => localStorage.getItem("agent-example-preview-note") || "",
  );
  const [saved, setSaved] = useState(false);
  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <h1>任务笔记</h1>
          <p className="page-subtitle">
            这是后加入的应用模块：仅修改应用自己的文件，不修改共享核心。
          </p>
        </div>
      </div>
      <DemoNotice />
      <div className="filter-bar">
        <div className="segmented">
          {[
            ["ready", "正常内容"],
            ["loading", "加载预览"],
            ["empty", "空态预览"],
            ["error", "失败预览"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={state === id ? "active" : ""}
              onClick={() => setState(id as typeof state)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <StatePanel
        state={state}
        onRetry={() => setState("ready")}
        detail="这是组件状态预览，不是真实请求失败。"
        emptyTitle="这里还没有笔记"
        errorTitle="演示：资料读取失败"
      >
        <div className="module-proof">
          <h2>为当前演示记一点想法</h2>
          <label className="field-label" htmlFor="preview-note">
            笔记内容
          </label>
          <textarea
            id="preview-note"
            rows={5}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setSaved(false);
            }}
            placeholder="写下你对页面或资料的观察…"
          />
          <div className="dialog-actions">
            <Button
              onClick={() => {
                localStorage.setItem("agent-example-preview-note", note);
                setSaved(true);
              }}
            >
              保存在本机
            </Button>
          </div>
          {saved && (
            <p role="status" className="inline-note">
              笔记已保存在本机浏览器；未调用后端或模型。
            </p>
          )}
        </div>
      </StatePanel>
    </div>
  );
}
