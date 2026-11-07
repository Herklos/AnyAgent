import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class GatewayState {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cursors (
        space_id TEXT NOT NULL,
        source TEXT NOT NULL,
        cursor TEXT NOT NULL,
        PRIMARY KEY (space_id, source)
      );
      CREATE TABLE IF NOT EXISTS delivered (
        space_id TEXT NOT NULL,
        key TEXT NOT NULL,
        delivered_at INTEGER NOT NULL,
        PRIMARY KEY (space_id, key)
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  getCursor(spaceId: string, source: string): string | undefined {
    const row = this.db
      .prepare("SELECT cursor FROM cursors WHERE space_id = ? AND source = ?")
      .get(spaceId, source) as { cursor: string } | undefined;
    return row?.cursor;
  }

  isDelivered(spaceId: string, key: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS ok FROM delivered WHERE space_id = ? AND key = ?")
      .get(spaceId, key) as { ok: number } | undefined;
    return row !== undefined;
  }

  /** Commit cursor and mark key delivered in one transaction. */
  commitAndMarkDelivered(spaceId: string, source: string, cursor: string, key: string): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO cursors (space_id, source, cursor) VALUES (?, ?, ?)
           ON CONFLICT(space_id, source) DO UPDATE SET cursor = excluded.cursor`,
        )
        .run(spaceId, source, cursor);
      this.db
        .prepare(
          `INSERT INTO delivered (space_id, key, delivered_at) VALUES (?, ?, ?)
           ON CONFLICT(space_id, key) DO UPDATE SET delivered_at = excluded.delivered_at`,
        )
        .run(spaceId, key, Date.now());
    });
    tx();
  }

  markDelivered(spaceId: string, key: string): void {
    this.db
      .prepare(
        `INSERT INTO delivered (space_id, key, delivered_at) VALUES (?, ?, ?)
         ON CONFLICT(space_id, key) DO UPDATE SET delivered_at = excluded.delivered_at`,
      )
      .run(spaceId, key, Date.now());
  }

  commit(spaceId: string, source: string, cursor: string): void {
    this.db
      .prepare(
        `INSERT INTO cursors (space_id, source, cursor) VALUES (?, ?, ?)
         ON CONFLICT(space_id, source) DO UPDATE SET cursor = excluded.cursor`,
      )
      .run(spaceId, source, cursor);
  }

  pruneDelivered(nowMs = Date.now()): number {
    const cutoff = nowMs - SEVEN_DAYS_MS;
    const info = this.db.prepare("DELETE FROM delivered WHERE delivered_at < ?").run(cutoff);
    return Number(info.changes);
  }

  close(): void {
    this.db.close();
  }
}
