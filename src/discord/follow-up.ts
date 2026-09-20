import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { ConversationMessage } from "../domain/types";

export interface ConversationState {
  lastActivity: number;
  history: ConversationMessage[];
}

interface SessionRow {
  last_activity: number;
}

interface MessageRow {
  role: "user" | "assistant";
  content: string;
}

/** Maintient les follow-ups et leur historique dans SQLite natif de Bun. */
export class FollowUpState {
  private readonly db: Database;
  private closed = false;

  public constructor(private readonly timeoutMs: number, databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath, { create: true, readwrite: true });
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversation_sessions (
        session_key TEXT PRIMARY KEY,
        last_activity INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL REFERENCES conversation_sessions(session_key) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS conversation_messages_session_idx
        ON conversation_messages(session_key, id);
    `);
  }

  public begin(key: string, now = Date.now()): ConversationState {
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO conversation_sessions (session_key, last_activity) VALUES (?, ?)
         ON CONFLICT(session_key) DO UPDATE SET last_activity = excluded.last_activity`,
        [key, now],
      );
      this.db.run("DELETE FROM conversation_messages WHERE session_key = ?", [key]);
    })();
    return { lastActivity: now, history: [] };
  }

  public getActive(key: string, now = Date.now()): ConversationState | undefined {
    const row = this.db.query("SELECT last_activity FROM conversation_sessions WHERE session_key = ?").get(key) as SessionRow | null;
    if (!row || now - row.last_activity > this.timeoutMs) {
      this.clear(key);
      return undefined;
    }
    const history = this.db
      .query("SELECT role, content FROM conversation_messages WHERE session_key = ? ORDER BY id ASC")
      .all(key) as MessageRow[];
    return { lastActivity: row.last_activity, history };
  }

  public record(key: string, userContent: string, assistantContent: string, now = Date.now()): void {
    if (!this.getActive(key, now)) return;
    this.db.transaction(() => {
      this.db.run(
        "INSERT INTO conversation_messages (session_key, role, content, created_at) VALUES (?, 'user', ?, ?)",
        [key, userContent, now],
      );
      this.db.run(
        "INSERT INTO conversation_messages (session_key, role, content, created_at) VALUES (?, 'assistant', ?, ?)",
        [key, assistantContent, now],
      );
      this.db.run("UPDATE conversation_sessions SET last_activity = ? WHERE session_key = ?", [now, key]);
    })();
  }

  public clear(key: string): void {
    this.db.run("DELETE FROM conversation_sessions WHERE session_key = ?", [key]);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
