// The Kilo v1 session store import (host composition, rung 2). ./database copies a v1 `kilo.db` to a private file; this
// module converts that file into a kilo2 store before ./database links it into place, so no server ever opens a store
// that is still being converted. The conversion itself is upstream's: the v2 schema migrations, then the V1 migration
// that also converts an OpenCode v1 database. Kilo only runs it in one process on a file nobody else can see, and adds
// the Kilo-specific steps (`finish`).
export * as KiloV1Store from "./v1-store"

import { Database as SQLite } from "bun:sqlite"
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
  prepare(file)
  const total = count(file, "session")
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

/** The tables the V1 migration reads; a kilo2 or earlier V2 store has `session_v2` already. */
export function requireV1Store(file: string) {
  const db = new SQLite(file, { readonly: true })
  try {
    const tables = new Set(
      db
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((table) => table.name),
    )
    if (tables.has("session_v2") || !["session", "message", "part", "project"].every((name) => tables.has(name)))
      throw new Error("not a Kilo v1 session store")
  } finally {
    db.close()
  }
}

/**
 * The Kilo-specific steps before the upstream conversion, on the legacy tables of the copy:
 * - Kilo v1 never sent ignored text parts or its transient progress parts (`kilocode.lifecycle`, such as "Initializing
 *   snapshot…") to the model, and a crash can leave the latter behind. The upstream conversion keeps every assistant
 *   text part, so it would add them to the model context of a continued session.
 * - A v1 workspace is a git worktree record that the v2 migrations replace with a different workspace model, so a v1
 *   workspace ID points at nothing in v2. Without it the conversion resolves the session by its directory, like any
 *   other session; Agent Manager keeps its own state in the project's `.kilo` directory.
 */
function prepare(file: string) {
  const db = new SQLite(file)
  try {
    db.transaction(() => {
      db.run(`
        DELETE FROM part
        WHERE json_extract(data, '$.type') = 'text'
          AND (json_extract(data, '$.ignored') = 1
            OR json_extract(data, '$.metadata."kilocode.lifecycle"') = 'transient')
      `)
      db.run("UPDATE session SET workspace_id = NULL WHERE workspace_id IS NOT NULL")
    })()
  } finally {
    db.close()
  }
}

/**
 * The Kilo-specific steps after the upstream conversion:
 * - The editor context the VS Code client sent with each v1 prompt (open files, active file, shell) has no field in the
 *   v2 user message, so it moves to the message metadata under `kilocode.editorContext`.
 * - Credentials stay in the v1 store: whether the import brings them is a product decision that is still open, so the
 *   copy keeps no provider credential or account token.
 * - The WAL is folded into the file, so the file is complete without a `-wal` file when ./database links it into place.
 *   It stays in WAL mode: servers that open it at the same time would otherwise race to switch it back, and that switch
 *   fails with "database is locked".
 */
function finish(file: string) {
  const db = new SQLite(file)
  try {
    db.transaction(() => {
      db.run(`
        UPDATE session_message
        SET data = json_set(data, '$.metadata."kilocode.editorContext"', json(
          (SELECT json_extract(message.data, '$.editorContext') FROM message WHERE message.id = session_message.id)
        ))
        WHERE type = 'user'
          AND EXISTS (
            SELECT 1 FROM message
            WHERE message.id = session_message.id AND json_extract(message.data, '$.editorContext') IS NOT NULL
          )
      `)
      for (const table of ["credential", "account", "account_state", "control_account", "kilo_continuation_intent"])
        if (db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
          db.run(`DELETE FROM "${table}"`)
    })()
    const result = db.query<{ busy: number }, []>("PRAGMA wal_checkpoint(TRUNCATE)").get()
    if (result?.busy) throw new Error("could not fold the WAL into the converted store")
  } finally {
    db.close()
  }
}

function count(file: string, table: string) {
  try {
    const db = new SQLite(file, { readonly: true })
    try {
      return db.query<{ n: number }, []>(`SELECT count(*) AS n FROM "${table}"`).get()?.n ?? 0
    } finally {
      db.close()
    }
  } catch {
    return 0
  }
}
