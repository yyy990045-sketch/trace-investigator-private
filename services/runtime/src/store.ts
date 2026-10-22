import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { id, now, hash } from "./util.ts";
import type { RunRecord, ProjectDraft } from "@personal/capability-sdk";
export class Store {
  db: DatabaseSync;
  constructor(public path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),project_name TEXT NOT NULL,revision INTEGER NOT NULL,plan TEXT NOT NULL,permissions TEXT NOT NULL,input TEXT NOT NULL,status TEXT NOT NULL,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS steps(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),position INTEGER NOT NULL,capability_id TEXT NOT NULL,version TEXT NOT NULL,definition_hash TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,input TEXT,output TEXT,error TEXT,started_at TEXT,finished_at TEXT,duration_ms INTEGER,UNIQUE(run_id,position));
 CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),step_id TEXT NOT NULL REFERENCES steps(id),input_hash TEXT NOT NULL,status TEXT NOT NULL,actor TEXT,decided_at TEXT);
 CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),step_id TEXT NOT NULL REFERENCES steps(id),kind TEXT NOT NULL,sha256 TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),step_id TEXT NOT NULL REFERENCES steps(id),filename TEXT NOT NULL,mime TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,path TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(run_id,filename));
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES runs(id),type TEXT NOT NULL,data TEXT NOT NULL,at TEXT NOT NULL,previous_hash TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS model_calls(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),step_id TEXT NOT NULL REFERENCES steps(id),model TEXT NOT NULL,status TEXT NOT NULL,duration_ms INTEGER NOT NULL,request_hash TEXT NOT NULL,response TEXT,error TEXT);
CREATE TABLE IF NOT EXISTS capability_settings(capability_id TEXT NOT NULL,version TEXT NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(capability_id,version));
CREATE TABLE IF NOT EXISTS compositions(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,layout TEXT NOT NULL,permissions TEXT NOT NULL,steps TEXT NOT NULL,source_project_id TEXT,source_project_name TEXT,created_by TEXT NOT NULL,reuse_count INTEGER NOT NULL DEFAULT 0,last_reused_at TEXT,last_reused_project_id TEXT,last_reused_project_name TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS run_feedback(id TEXT PRIMARY KEY,run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),project_id TEXT NOT NULL,project_name TEXT NOT NULL,outcome TEXT NOT NULL,correction TEXT NOT NULL,reusable INTEGER NOT NULL,reference_value TEXT NOT NULL,author TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS experiences(id TEXT PRIMARY KEY,title TEXT NOT NULL,kind TEXT NOT NULL,problem TEXT NOT NULL,resolution TEXT NOT NULL,project_id TEXT,project_name TEXT,run_id TEXT,capabilities TEXT NOT NULL,tags TEXT NOT NULL,source_feedback_id TEXT,verified_run_id TEXT,verified_project_name TEXT,verified_at TEXT,author TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_applications(project_id TEXT PRIMARY KEY REFERENCES projects(id),app_name TEXT NOT NULL,title TEXT NOT NULL,layout TEXT NOT NULL,port INTEGER NOT NULL,path TEXT NOT NULL,status TEXT NOT NULL,message TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
`);
  }
  get(sql: string, ...args: any[]): any {
    return this.db.prepare(sql).get(...args);
  }
  all(sql: string, ...args: any[]): any[] {
    return this.db.prepare(sql).all(...args);
  }
  exec(sql: string, ...args: any[]) {
    return this.db.prepare(sql).run(...args);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  event(runId: string, type: string, data: unknown) {
    const previous =
      this.get(
        "SELECT hash FROM events WHERE run_id=? ORDER BY id DESC LIMIT 1",
        runId,
      )?.hash || "";
    const at = now();
    this.exec(
      "INSERT INTO events(run_id,type,data,at,previous_hash,hash) VALUES(?,?,?,?,?,?)",
      runId,
      type,
      JSON.stringify(data),
      at,
      previous,
      hash({ runId, type, data, at, previous }),
    );
  }
  setStatus(runId: string, status: string, error: unknown = null) {
    this.exec(
      "UPDATE runs SET status=?,error=?,updated_at=? WHERE id=?",
      status,
      error ? JSON.stringify(error) : null,
      now(),
      runId,
    );
    this.event(runId, "run." + status, error || {});
  }
  project(row: any) {
    return row
      ? {
          ...JSON.parse(row.data),
          id: row.id,
          revision: row.revision,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }
  createProject(data: ProjectDraft) {
    const pid = id("project"),
      at = now();
    this.exec(
      "INSERT INTO projects VALUES(?,?,?,?,?,?)",
      pid,
      data.name,
      1,
      JSON.stringify(data),
      at,
      at,
    );
    return this.project(this.get("SELECT * FROM projects WHERE id=?", pid));
  }
  run(runId: string): RunRecord | null {
    const r = this.get("SELECT * FROM runs WHERE id=?", runId);
    if (!r) return null;
    return {
      id: r.id,
      projectId: r.project_id,
      projectName: r.project_name,
      projectRevision: r.revision,
      assembly: JSON.parse(r.plan),
      status: r.status,
      input: JSON.parse(r.input),
      error: r.error ? JSON.parse(r.error) : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      steps: this.all(
        "SELECT * FROM steps WHERE run_id=? ORDER BY position",
        runId,
      ).map((s) => ({
        id: s.id,
        position: s.position,
        capabilityId: s.capability_id,
        version: s.version,
        status: s.status,
        attempts: s.attempts,
        input: s.input ? JSON.parse(s.input) : null,
        output: s.output ? JSON.parse(s.output) : null,
        error: s.error ? JSON.parse(s.error) : null,
        startedAt: s.started_at,
        finishedAt: s.finished_at,
        durationMs: s.duration_ms,
      })),
      approvals: this.all("SELECT * FROM approvals WHERE run_id=?", runId).map(
        (a) => ({
          id: a.id,
          stepId: a.step_id,
          inputHash: a.input_hash,
          status: a.status,
          actor: a.actor,
          decidedAt: a.decided_at,
        }),
      ),
      evidence: this.all(
        "SELECT * FROM evidence WHERE run_id=? ORDER BY created_at,id",
        runId,
      ).map((e) => ({
        id: e.id,
        kind: e.kind,
        sha256: e.sha256,
        data: JSON.parse(e.data),
        createdAt: e.created_at,
        stepId: e.step_id,
      })),
      artifacts: this.all(
        "SELECT * FROM artifacts WHERE run_id=? ORDER BY created_at",
        runId,
      ).map((a) => ({
        id: a.id,
        filename: a.filename,
        mime: a.mime,
        sha256: a.sha256,
        bytes: a.bytes,
        createdAt: a.created_at,
      })),
      events: this.all(
        "SELECT * FROM events WHERE run_id=? ORDER BY id",
        runId,
      ).map((e) => ({
        id: e.id,
        type: e.type,
        at: e.at,
        data: JSON.parse(e.data),
        previousHash: e.previous_hash,
        hash: e.hash,
      })),
      modelCalls: this.all(
        "SELECT * FROM model_calls WHERE run_id=?",
        runId,
      ).map((m) => ({
        id: m.id,
        model: m.model,
        status: m.status,
        durationMs: m.duration_ms,
        response: m.response ? JSON.parse(m.response) : null,
        error: m.error ? JSON.parse(m.error) : null,
      })),
    };
  }
  close() {
    this.db.close();
  }
}
