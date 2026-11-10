// The windowed copy of a Kilo v1 store for `import v1 --since`. A real v1 store can be tens of gigabytes, so the copy
// cannot use `VACUUM INTO`: it would copy the whole store first and defeat the window. This module reads the source
// through one read-only connection inside one read transaction, so the selection and every copied row come from the
// same snapshot even while Kilo v1 writes, and it never writes the source database or its WAL.
import { Database as SQLite, type SQLQueryBindings } from "bun:sqlite"

const BATCH = 1_000

// The v1 event journal names its session in `aggregate_id`, not `session_id`. The conversion clears it, so copying every
// event of a large store would defeat the window. The other session tables all carry a `session_id` column.
const eventJournal = new Set(["event", "event_sequence"])

type Table = {
  readonly name: string
  readonly columns: ReadonlyArray<string>
  readonly scope: "session" | "session_id" | "full"
}

/** Writes the v1 tables and the rows of the `since` window from `source` into the new file `target`. */
export function extract(source: string, target: string, since: number, onProgress: () => void = () => {}) {
  const from = new SQLite(source, { readonly: true })
  try {
    from.run("BEGIN")
    const ids = selectSessions(from, since)
    // An empty window would publish an empty store and leave the caller without its earlier sessions, so it fails first.
    if (ids.length === 0)
      throw new Error(`No Kilo v1 sessions were updated since ${new Date(since).toISOString().slice(0, 10)}.`)
    const schema = readSchema(from)
    const tables = readTables(from)
    const to = new SQLite(target)
    try {
      to.run("PRAGMA foreign_keys = OFF")
      to.run("BEGIN")
      try {
        for (const statement of schema) to.run(statement)
        const window = JSON.stringify(ids)
        for (const table of tables) copyTable(from, to, table, window, onProgress)
        to.run("COMMIT")
      } catch (error) {
        to.run("ROLLBACK")
        throw error
      }
    } finally {
      to.close()
    }
    from.run("COMMIT")
  } finally {
    try {
      if (from.inTransaction) from.run("ROLLBACK")
    } finally {
      from.close()
    }
  }
}

/**
 * The sessions to import: every session updated at or after `since`, plus all its ancestors and descendants through
 * `parent_id`, so a subagent tree stays complete when only its root or only one of its children is recent.
 */
function selectSessions(from: SQLite, since: number) {
  return from
    .query<{ id: string }, [number]>(
      `
      WITH RECURSIVE
        recent(id) AS (SELECT id FROM session WHERE time_updated >= ?),
        ancestors(id) AS (
          SELECT id FROM recent
          UNION
          SELECT session.parent_id FROM session JOIN ancestors ON session.id = ancestors.id
          WHERE session.parent_id IS NOT NULL
        ),
        tree(id) AS (
          SELECT id FROM ancestors
          UNION
          SELECT session.id FROM session JOIN tree ON session.parent_id = tree.id
        )
      SELECT id FROM tree
    `,
    )
    .all(since)
    .map((row) => row.id)
}

/** Every table and index of the source, tables before the indexes and triggers that use them. */
function readSchema(from: SQLite) {
  return from
    .query<{ sql: string }, []>(
      `
      SELECT sql FROM sqlite_master
      WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END
    `,
    )
    .all()
    .map((statement) => statement.sql)
}

function readTables(from: SQLite): Table[] {
  return from
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .filter((table) => !eventJournal.has(table.name))
    .map((table) => {
      const columns = from
        .query<{ name: string }, [string]>("SELECT name FROM pragma_table_info(?)")
        .all(table.name)
        .map((column) => column.name)
      return { name: table.name, columns, scope: scopeOf(table.name, columns) }
    })
}

/** Session scope comes from the schema, so message, part and every other table that names its session is filtered. */
function scopeOf(name: string, columns: ReadonlyArray<string>): Table["scope"] {
  if (name === "session") return "session"
  if (columns.some((column) => column === "session_id")) return "session_id"
  return "full"
}

function copyTable(from: SQLite, to: SQLite, table: Table, window: string, onProgress: () => void) {
  const columns = table.columns.map(quote).join(", ")
  const insert = to.prepare<unknown, SQLQueryBindings[]>(
    `INSERT INTO ${quote(table.name)} (${columns}) VALUES (${table.columns.map(() => "?").join(", ")})`,
  )
  const rows = from.query<Record<string, SQLQueryBindings>, SQLQueryBindings[]>(select(table, columns))
  const iterator = table.scope === "full" ? rows.iterate() : rows.iterate(window)
  let count = 0
  for (const row of iterator) {
    insert.run(...table.columns.map((column) => row[column]))
    // The caller refreshes the import lock with every report, so a long table copy cannot look like a dead importer.
    if (++count % BATCH === 0) onProgress()
  }
  onProgress()
}

function select(table: Table, columns: string) {
  const id = table.scope === "session" ? "id" : table.scope === "session_id" ? "session_id" : undefined
  const where = id === undefined ? "" : ` WHERE ${quote(id)} IN (SELECT value FROM json_each(?))`
  return `SELECT ${columns} FROM ${quote(table.name)}${where}`
}

function quote(name: string) {
  return `"${name.replaceAll('"', '""')}"`
}
