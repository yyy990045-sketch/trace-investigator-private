import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createPlatform } from "../services/runtime/src/app";
import { standardAssembly, standardPermissions, type DocumentItem } from "@personal/capability-sdk";
import { localKnowledge } from "../services/runtime/src/providers";

let dir: string, p: Awaited<ReturnType<typeof createPlatform>>;
const docs: DocumentItem[] = [
  { id: "a", text: "档案保留期限为五年。访问资料需要登记。", source: "授权档案手册#保留", scope: "general" },
  { id: "b", text: "五年到期后，由管理员处理档案销毁申请。", source: "授权操作说明#销毁", scope: "general" },
  { id: "c", text: "会议室位于三楼，预约请联系前台。", source: "授权场地说明#会议", scope: "general" },
];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "platform-quality-"));
  vi.stubEnv("PLATFORM_MODEL_ENABLED", "false");
  p = await createPlatform({ dbPath: join(dir, "case.sqlite"), artifactRoot: join(dir, "files") });
});
afterEach(async () => { await p.app.close(); await rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const wait = async (id: string, expected: string) => {
  for (let n = 0; n < 600; n++) {
    const r = p.store.run(id)!;
    if (r.status === expected) return r;
    if (["failed", "completed", "rejected", "canceled"].includes(r.status)) throw new Error(JSON.stringify(r.error || r.status));
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("run not settled");
};
function project(model = false, timeoutMs = 30000) {
  const steps = structuredClone(standardAssembly);
  steps[2].config = { query: "档案保留期限五年", limit: 5 };
  if (model) steps.splice(3, 0, { capabilityId: "model.verify", version: "1.0.0", config: {}, timeoutMs });
  return p.engine.createProject({ name: "隔离协议检查", layout: "agent", permissions: [...standardPermissions, ...(model ? ["model:invoke", "data:external"] : [])], steps });
}
function input() { return { filename: "授权资料.json", text: JSON.stringify({ documents: docs, claims: [{ key: "保留期限", value: "五年", source: "a" }] }), modelConsent: true }; }

describe("Rule quality and final evidence", () => {
  it("ranks nonempty Chinese query, excludes unrelated sources, and gives no fabricated empty-query scores", async () => {
    const signal = new AbortController().signal;
    const citations = await localKnowledge.search("档案保留期限五年", docs, 5, signal);
    expect(citations.map((c) => c.documentId)).toEqual(["a", "b"]);
    expect(citations[0].score).toBeGreaterThan(citations[1].score);
    expect(citations[1].score).toBeLessThan(1);
    expect(await localKnowledge.search("", docs, 5, signal)).toEqual([]);
  });
  it("separates export-time snapshot from completed receipt and checks file integrity", async () => {
    const saved = project();
    const r = p.engine.createRun(saved.id, input());
    const waiting = await wait(r.id, "waiting_approval");
    expect((await p.app.inject({ url: `/v1/runs/${r.id}/receipt` })).json().code).toBe("RECEIPT_NOT_FINAL");
    p.engine.decide(r.id, waiting.approvals[0].id, "approve", "本机测试操作者");
    const done = await wait(r.id, "completed");
    const result = done.artifacts.find((a) => a.filename.endsWith("json"))!;
    const bytes = await p.app.inject({ url: `/v1/runs/${r.id}/artifacts/${result.id}` });
    expect(bytes.json().execution).toBeUndefined();
    expect(bytes.json().intermediateExecutionSnapshot.status).toBe("running");
    expect(bytes.json().intermediateExecutionSnapshot.generatedAt).toBeTruthy();
    const receipt = await p.app.inject({ url: `/v1/runs/${r.id}/receipt` });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.json()).toMatchObject({ runId: r.id, finalStatus: "completed" });
    expect(receipt.json().reportExportCompletionEvents).toHaveLength(1);
    expect(receipt.json().approvals).toHaveLength(1);
  });
  it("rejects null JSON and missing source, and distinguishes absence of claims", async () => {
    for (const [text, code] of [["null", "INVALID_DOCUMENTS"], [JSON.stringify({documents:[{id:"x",text:"内容"}]}), "MISSING_SOURCE"]]) {
      const r = p.engine.createRun(project().id, { filename:"case.json",text });
      expect((await wait(r.id,"failed")).error?.code).toBe(code);
    }
    const r = p.engine.createRun(project().id, { filename:"case.json",text:JSON.stringify({documents:docs}) });
    const waiting = await wait(r.id,"waiting_approval");
    expect((waiting.steps[1].output as any).checks[1]).toMatchObject({ status:"not_evaluated" });
    p.engine.cancel(r.id);
  });
});

describe("Local synthetic Provider protocol only — not real AI acceptance", () => {
  for (const mode of ["normal", "http-error", "invalid-schema", "citation-missing", "timeout", "cancel"] as const) {
    it(mode, async () => {
      const server = createServer(async (req, res) => {
        let raw = ""; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        const source = JSON.parse(body.messages[1].content).citations[0]?.id;
        if (mode === "http-error") { res.writeHead(401); res.end("plain-text denial"); return; }
        if (mode === "timeout" || mode === "cancel") { return; }
        const result = mode === "invalid-schema" ? { unexpected:true } : { summary:"合成协议响应，非模型输出", verdict:"supported", citations:mode === "citation-missing" ? [] : [source] };
        res.end(JSON.stringify({ choices:[{message:{content:JSON.stringify(result)}}] }));
      });
      await new Promise<void>((r) => server.listen(0,"127.0.0.1",r));
      const address = server.address() as {port:number};
      vi.stubEnv("PLATFORM_MODEL_ENABLED","true"); vi.stubEnv("PLATFORM_MODEL_BASE_URL",`http://127.0.0.1:${address.port}/v1`);
      vi.stubEnv("PLATFORM_MODEL_NAME","synthetic-contract-only"); vi.stubEnv("PLATFORM_MODEL_API_KEY","non-secret-local-protocol-fixture");
      try {
        const r = p.engine.createRun(project(true,mode === "timeout" ? 100 : 2000).id,input());
        if (mode === "normal") { const waiting = await wait(r.id,"waiting_approval"); expect(waiting.modelCalls[0].status).toBe("completed");p.engine.cancel(r.id); }
        else if (mode === "cancel") {
          for (let n=0;n<200;n++) { if (p.store.run(r.id)!.steps.some((s)=>s.capabilityId==="model.verify" && s.status==="running")) break;await new Promise(r=>setTimeout(r,5)); }
          p.engine.cancel(r.id);expect((await wait(r.id,"canceled")).artifacts).toHaveLength(0);
        } else {
          const failed=await wait(r.id,"failed");
          expect(failed.error?.code).toBe(mode === "http-error" ? "MODEL_HTTP_401" : mode === "timeout" ? "STEP_TIMEOUT" : mode === "citation-missing" ? "MODEL_CITATION_REQUIRED" : "MODEL_SCHEMA_INVALID");
          expect(failed.artifacts).toHaveLength(0);
        }
        while (p.engine.operations.size) await Promise.allSettled([...p.engine.operations]);
        expect(p.store.run(r.id)!.modelCalls).toHaveLength(1);
      } finally { server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); }
    });
  }
});
