import { Runtime } from "@opencode/cli/framework/runtime"
import { Global } from "@opencode/util/global"
import { Effect, Option } from "effect"
import { existsSync, statSync } from "node:fs"
import { EOL } from "node:os"
import path from "node:path"
import { KiloDatabase } from "../database"
import { KiloV1Store } from "../v1-store"
import { ImportCommand } from "./import"

/**
 * `kilo2 import v1`: the manual form of the first-start import. It runs the same copy, conversion and Kilo steps on the
 * same store layout, and refuses everything the automatic path refuses: an existing store, and a target that is itself a
 * v1 store (which kilo2 never migrates in place).
 */
export default Runtime.handler(
  ImportCommand.commands.v1,
  Effect.fn("kilo.import.v1")(
    function* (input) {
      const global = yield* Global.Service
      const from = Option.getOrUndefined(input.from)
      const source = from
        ? existsSync(from) && statSync(from).isDirectory()
          ? path.join(from, "kilo.db")
          : from
        : KiloDatabase.v1Store(global.data)
      // The host selected the kilo2 store before this command started (./database).
      const file = process.env.OPENCODE_DB
      if (!file || file === ":memory:") return yield* Effect.fail(new Error("No kilo2 session store file is selected."))
      if (input.status) {
        const { Database } = yield* Effect.promise(() => import("bun:sqlite"))
        const sessions = (store: string, table: string) => {
          if (!existsSync(store)) return 0
          const db = new Database(store, { readonly: true })
          try {
            return db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0
          } catch {
            return 0
          } finally {
            db.close()
          }
        }
        process.stdout.write(
          JSON.stringify({
            source,
            sourceSessions: sessions(source, "session"),
            target: file,
            targetSessions: sessions(file, "session_v2"),
          }),
        )
        return
      }
      if (!existsSync(source) || !KiloV1Store.isV1Store(source))
        return yield* Effect.fail(
          new Error(`No Kilo v1 session store at ${source}. Pass --from with the kilo.db file or its data directory.`),
        )
      if (KiloV1Store.isV1Store(file))
        return yield* Effect.fail(
          new Error(
            `${file} is a Kilo v1 session store, and kilo2 never migrates it in place: v1 could no longer read it. Use a kilo2 store name that differs from v1's.`,
          ),
        )
      if (existsSync(file))
        return yield* Effect.fail(
          new Error(
            `kilo2 already has a session store at ${file}. This command only creates a new store: move that file away, or set KILO2_DB to a new path, and run it again.`,
          ),
        )
      const started = Date.now()
      const result = yield* Effect.tryPromise({
        try: () =>
          KiloDatabase.importV1({
            store: source,
            file,
            data: global.data,
            log: (line) => process.stderr.write(`${line}${EOL}`),
            onStart: () => process.stderr.write(`Importing the Kilo v1 sessions of ${source}${EOL}`),
            progress: (done, total) => process.stderr.write(`Importing Kilo v1 sessions ${done}/${total}${EOL}`),
          }),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
      process.stdout.write(
        `Imported ${result.imported} Kilo v1 sessions from ${source} to ${file} in ${Date.now() - started} ms. ${source} is unchanged.${EOL}`,
      )
    },
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(`${error.message}${EOL}`)
        process.exitCode = 1
      }),
    ),
  ),
)
