import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export interface SessionRow {
  workflowId: string;
  harness: string;
  model: string;
  mode: string;
  sessionId: string;
}

/**
 * Node-local SQLite: harness sessions (survive workflow rotation) and idempotent deliver ops.
 */
export class NodeStore {
  readonly #db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.#db = new Database(path);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        workflow_id TEXT PRIMARY KEY,
        harness TEXT NOT NULL,
        model TEXT NOT NULL,
        mode TEXT NOT NULL,
        session_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ops (
        key TEXT PRIMARY KEY,
        message_id TEXT NOT NULL
      );
    `);
  }

  getSession(workflowId: string): SessionRow | undefined {
    const row = this.#db
      .prepare(
        `SELECT workflow_id AS workflowId, harness, model, mode, session_id AS sessionId
         FROM sessions WHERE workflow_id = ?`,
      )
      .get(workflowId) as SessionRow | undefined;
    return row;
  }

  putSession(row: SessionRow): void {
    this.#db
      .prepare(
        `INSERT INTO sessions (workflow_id, harness, model, mode, session_id)
         VALUES (@workflowId, @harness, @model, @mode, @sessionId)
         ON CONFLICT(workflow_id) DO UPDATE SET
           harness = excluded.harness,
           model = excluded.model,
           mode = excluded.mode,
           session_id = excluded.session_id`,
      )
      .run(row);
  }

  clearSession(workflowId: string): void {
    this.#db.prepare(`DELETE FROM sessions WHERE workflow_id = ?`).run(workflowId);
  }

  getOp(key: string): string | undefined {
    const row = this.#db
      .prepare(`SELECT message_id AS messageId FROM ops WHERE key = ?`)
      .get(key) as { messageId: string } | undefined;
    return row?.messageId;
  }

  putOp(key: string, messageId: string): void {
    this.#db
      .prepare(
        `INSERT INTO ops (key, message_id) VALUES (?, ?)
         ON CONFLICT(key) DO NOTHING`,
      )
      .run(key, messageId);
  }

  close(): void {
    this.#db.close();
  }
}
