// The merge step of `import v1` into a kilo2 store that already exists. The window is first converted into a private
// store by the normal import (../database), so this module only copies finished v2 rows. It adds the sessions the
// target does not hold yet and never changes a session the target already has, so a second run imports only what is
// new. The target can be open in a running server: the copy is one write transaction that waits for the server's
// writes, and SQLite's WAL lets the server keep reading meanwhile.
import { Database as SQLite } from "bun:sqlite"

/**
 * The v2 tables the conversion fills for a session, with the column that names the session. The legacy v1 tables the
 * private store still holds (`session`, `message`, `part`, `todo`, `kilo_board`) are not read by kilo2, so they stay out.
 */
const tables = [
  ["session_v2", "id"],
  ["session_message", "session_id"],
  ["event_sequence", "aggregate_id"],
] as const

/** Copies the sessions of the converted store `source` that `target` does not have, and returns how many. */
export function merge(source: string, target: string) {
  const db = new SQLite(target)
  try {
    db.run("PRAGMA busy_timeout = 30000")
    db.run("ATTACH DATABASE ? AS src", [source])
    const run = db.transaction(() => {
      const ids = db
        .query<{ id: string }, []>("SELECT id FROM src.session_v2 WHERE id NOT IN (SELECT id FROM main.session_v2)")
        .all()
        .map((row) => row.id)
      if (ids.length === 0) return 0
      const window = JSON.stringify(ids)
      // A project the target knows under another ID for the same directory keeps the target's ID, so the sessions
      // land in the project the target already lists.
      const columns = shared(db, "project")
      db.run(
        `INSERT OR IGNORE INTO main.project (${columns}) SELECT ${columns} FROM src.project
         WHERE id IN (SELECT project_id FROM src.session_v2 WHERE id IN (SELECT value FROM json_each(?)))
           AND worktree NOT IN (SELECT worktree FROM main.project)`,
        [window],
      )
      for (const [table, key] of tables) {
        const names = shared(db, table)
        db.run(
          `INSERT OR IGNORE INTO main."${table}" (${names}) SELECT ${names} FROM src."${table}"
           WHERE "${key}" IN (SELECT value FROM json_each(?))`,
          [window],
        )
      }
      db.run(
        `UPDATE main.session_v2 SET project_id = coalesce((
           SELECT target.id FROM main.project AS target JOIN src.project AS origin ON origin.worktree = target.worktree
           WHERE origin.id = session_v2.project_id ORDER BY target.time_active DESC LIMIT 1
         ), project_id)
         WHERE id IN (SELECT value FROM json_each(?)) AND project_id NOT IN (SELECT id FROM main.project)`,
        [window],
      )
      return ids.length
    })
    return run.immediate()
  } finally {
    db.close()
  }
}

/** The columns both stores have, quoted, so a store a migration ahead or behind still merges. */
function shared(db: SQLite, table: string) {
  const columns = (schema: string) =>
    db
      .query<{ name: string }, [string, string]>("SELECT name FROM pragma_table_info(?, ?)")
      .all(table, schema)
      .map((column) => column.name)
  const source = new Set(columns("src"))
  return columns("main")
    .filter((name) => source.has(name))
    .map((name) => `"${name}"`)
    .join(", ")
}
