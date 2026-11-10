// The Kilo v1 session store import (host composition, rung 2). ./database copies a v1 `kilo.db` to a private file; this
// module converts that file into a kilo2 store before ./database links it into place, so no server ever opens a store
// that is still being converted. The conversion itself is upstream's: the v2 schema migrations, then the V1 migration
// that also converts an OpenCode v1 database. Kilo only runs it in one process on a file nobody else can see, and adds
// the Kilo-specific steps (`finish`).
export * as KiloV1Store from "./v1-store"

import { Database as SQLite } from "bun:sqlite"
import { openReadonly } from "./sqlite-readonly"
import { Effect, Layer, References } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { V1Migration } from "@opencode/core/database/v1-migration"
import { Project } from "@opencode/core/project"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"

export type Options = {
  /** The kilo2 data directory the converted store belongs to. */
  readonly data: string
  /** Called with converted and total sessions while the conversion runs. */
  readonly progress?: (done: number, total: number) => void
}

/**
 * Converts the private copy of a Kilo v1 store at `file` in place and returns its number of sessions. Throws when the
 * file is not a Kilo v1 store or a step fails; the caller then discards the copy.
 */
export async function convert(file: string, options: Options) {
  requireV1Store(file)
  const total = count(file, "session")
  // Progress between the blocking phases: the caller refreshes its import lock with every report.
  options.progress?.(0, total)
  prepare(file)
  options.progress?.(0, total)
  // The conversion yields after each session, so the timer reports progress while it runs.
  const timer = setInterval(() => options.progress?.(count(file, "session_v2"), total), 2_000)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, FSUtil.node, Global.node]), [
              Database.node.replace(Database.configured({ path: file })),
              Global.node.replace(Global.layerWith({ data: options.data })),
            ]),
          )
          // A missing path: the import never pulls in an `opencode-next.db` that happens to lie in the data directory.
          yield* V1Migration.run({ nextDatabasePath: `${file}.none` }).pipe(Effect.provide(context))
        }),
        // The import runs in the CLI process before a TUI starts: only warnings reach the terminal, not the INFO log of
        // every schema migration.
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    clearInterval(timer)
  }
  finish(file)
  options.progress?.(total, total)
  return total
}

/**
 * Whether `file` holds a v1 session schema the V1 migration can convert: the tables it reads and no `session_v2` of a
 * kilo2 or V2 store. This is the check for a store the user names as the import source, so it accepts every v1 store,
 * also one that no Kilo v1 version has opened since its own tables were added.
 */
export function isV1Store(file: string) {
  return tablesOf(file)?.v1 === true
}

/**
 * The store at `file` for the guard that protects Kilo v1's only copy: a Kilo v1 store, another SQLite database, or a
 * file that cannot be read, which the caller must not treat as a normal store. It is stricter than `isV1Store`: a v1
 * schema counts only with a table that only Kilo v1 creates, so an older upstream `opencode.db` (which the server may
 * still migrate in place) and a kilo2 store from before the `session_v2` split do not stop a start. A store that another
 * process holds is `other`: it is in use, not a v1 store to protect.
 */
export function inspect(file: string): "v1" | "other" | "unreadable" {
  try {
    const found = tablesOf(file, { strict: true })
    return found?.v1 && found.kilo ? "v1" : "other"
  } catch (error) {
    return /locked|busy/i.test(String(error)) ? "other" : "unreadable"
  }
}

/** Whether `file` is a Kilo v1 store by the guard's strict check. */
export function isKiloV1Store(file: string) {
  return inspect(file) === "v1"
}

/** The v1 traits of the tables in `file`; undefined when it cannot be read, unless `strict` asks for the error. */
function tablesOf(file: string, options: { strict?: boolean } = {}) {
  try {
    const db = openReadonly(file).db
    try {
      const tables = new Set(
        db
          .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((table) => table.name),
      )
      return {
        v1: !tables.has("session_v2") && ["session", "message", "part", "project"].every((name) => tables.has(name)),
        kilo: kiloV1Tables.some((name) => tables.has(name)),
      }
    } finally {
      db.close()
    }
  } catch (error) {
    if (options.strict) throw error
    // Not a readable SQLite file, so not a store to import.
    return undefined
  }
}

/** Tables that only a Kilo v1 store creates: the v2 schema never does, and a conversion of v1 keeps `session_v2`. */
const kiloV1Tables = [
  "kilo_am_project",
  "kilo_am_section",
  "kilo_am_tab",
  "kilo_am_worktree",
  "kilo_board",
  "kilo_board_message",
  "kilo_continuation_intent",
  "kilo_subscription",
]

export function requireV1Store(file: string) {
  if (!isV1Store(file)) throw new Error("not a v1 session store")
}

/**
 * The Kilo-specific steps before the upstream conversion, on the legacy tables of the copy:
 * - Kilo v1 never sent ignored text parts or its transient progress parts (`kilocode.lifecycle`, such as "Initializing
 *   snapshot…") to the model, and a crash can leave the latter behind. The upstream conversion keeps every assistant
 *   text part, so it would add them to the model context of a continued session.
 * - A v1 workspace is a git worktree record that the v2 migrations replace with a different workspace model, so a v1
 *   workspace ID points at nothing in v2. Without it the conversion resolves the session by its directory, like any
 *   other session; Agent Manager keeps its own state in the project's `.kilo` directory.
 * - The v1 credentials and account tokens are removed before the v2 migrations touch their rows (see `clearCredentials`).
 * Rows with malformed JSON stay for the upstream conversion, which skips and reports them.
 */
function prepare(file: string) {
  const db = new SQLite(file)
  try {
    db.run("PRAGMA secure_delete = ON")
    db.transaction(() => {
      db.run(`
        DELETE FROM part
        WHERE CASE WHEN json_valid(data) THEN
          json_extract(data, '$.type') = 'text'
            AND (json_extract(data, '$.ignored') = 1
              OR json_extract(data, '$.metadata."kilocode.lifecycle"') = 'transient')
        ELSE 0 END
      `)
      db.run("UPDATE session SET workspace_id = NULL WHERE workspace_id IS NOT NULL")
      clearCredentials(db)
    })()
  } finally {
    db.close()
  }
}

/**
 * The Kilo-specific steps after the upstream conversion:
 * - The editor context the VS Code client sent with each v1 prompt (open files, active file, shell) has no field in the
 *   v2 user message, so it moves to the message metadata under `kilocode.editorContext`.
 * - Credentials are cleared again: the v2 migration `import_legacy_credentials` adds the ones of an `auth.json` in the
 *   data directory, which after the release rename is v1's own.
 * - The WAL is folded into the file, so the file is complete without a `-wal` file when ./database links it into place.
 *   It stays in WAL mode: servers that open it at the same time would otherwise race to switch it back, and that switch
 *   fails with "database is locked".
 */
function finish(file: string) {
  const db = new SQLite(file)
  try {
    db.run("PRAGMA secure_delete = ON")
    db.transaction(() => {
      db.run(`
        UPDATE session_message
        SET data = json_set(data, '$.metadata."kilocode.editorContext"', json(
          (SELECT json_extract(message.data, '$.editorContext') FROM message
           WHERE message.id = session_message.id AND json_valid(message.data))
        ))
        WHERE type = 'user'
          AND json_valid(data)
          AND EXISTS (
            SELECT 1 FROM message
            WHERE message.id = session_message.id
              AND CASE WHEN json_valid(message.data) THEN json_extract(message.data, '$.editorContext') IS NOT NULL
                ELSE 0 END
          )
      `)
      clearCredentials(db)
    })()
    const result = db.query<{ busy: number }, []>("PRAGMA wal_checkpoint(TRUNCATE)").get()
    if (result?.busy) throw new Error("could not fold the WAL into the converted store")
  } finally {
    db.close()
  }
}

/**
 * Whether the import brings credentials is a product decision that is still open, so the copy keeps no provider
 * credential, account token or OAuth continuation; the v1 store keeps them. The connection runs with `secure_delete`, so
 * SQLite overwrites the deleted content instead of leaving it in free pages of the file.
 */
function clearCredentials(db: SQLite) {
  for (const table of ["credential", "account", "account_state", "control_account", "kilo_continuation_intent"])
    if (db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
      db.run(`DELETE FROM "${table}"`)
  // The origins of the well-known credentials `import_legacy_credentials` added.
  if (db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kv'").get())
    db.run("DELETE FROM kv WHERE key = 'wellknown:sources'")
}

function count(file: string, table: string) {
  try {
    const db = openReadonly(file).db
    try {
      return db.query<{ n: number }, []>(`SELECT count(*) AS n FROM "${table}"`).get()?.n ?? 0
    } finally {
      db.close()
    }
  } catch {
    return 0
  }
}
