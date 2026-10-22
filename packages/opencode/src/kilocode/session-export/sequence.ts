import { Database } from "bun:sqlite"

export function createSequencer(path: string) {
  const sqlite = new Database(path, { create: true })
  sqlite.exec("PRAGMA journal_mode = WAL")
  sqlite.exec("PRAGMA busy_timeout = 5000")
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS session_export_sequence (
      session_id TEXT PRIMARY KEY,
      next INTEGER NOT NULL
    )
  `)
  const stmt = sqlite.query(`
    INSERT INTO session_export_sequence (session_id, next)
    VALUES (?, 1)
    ON CONFLICT(session_id) DO UPDATE SET next = next + 1
    RETURNING next - 1 AS seq
  `)
  return {
    next(sessionId: string): number {
      const row = stmt.get(sessionId) as { seq: number }
      return row.seq
    },
    close(): void {
      sqlite.close()
    },
  }
}
