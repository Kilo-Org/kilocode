import { Runtime } from "@opencode/cli/framework/runtime"
import { Global } from "@opencode/util/global"
import { Effect, Option } from "effect"
import { existsSync, statSync } from "node:fs"
import { EOL } from "node:os"
import path from "node:path"
import { KiloDatabase } from "../database"
import { KiloV1Store } from "../v1-store"
import { ImportCommand } from "./import"
import { cutoff } from "./since"

/**
 * `kilo2 import v1`: the manual import of an earlier Kilo installation. It copies, converts and links a new store, and
 * refuses an existing store and a target that is itself a v1 store (which kilo2 never migrates in place). `--since`
 * limits the copy to one time window and the parent and child sessions of every session in it.
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
      const since = Option.getOrUndefined(input.since)
      const window = yield* Effect.try({
        try: () => (since === undefined ? undefined : cutoff(since)),
        catch: asError,
      })
      // The host selected the kilo2 store before this command started (./database).
      const file = process.env.OPENCODE_DB
      if (!file || file === ":memory:") return yield* Effect.fail(new Error("No kilo2 session store file is selected."))
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
            since: window,
            log: (line) => process.stderr.write(`${line}${EOL}`),
            onStart: () => process.stderr.write(`Importing the Kilo v1 sessions of ${source}${EOL}`),
            progress: (done, total) => process.stderr.write(`Importing Kilo v1 sessions ${done}/${total}${EOL}`),
          }),
        catch: asError,
      })
      const scope = window === undefined ? "" : ` (updated since ${new Date(window).toISOString().slice(0, 10)})`
      process.stdout.write(
        `Imported ${result.imported} Kilo v1 sessions${scope} from ${source} to ${file} in ${Date.now() - started} ms. ${source} is unchanged.${EOL}`,
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

function asError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause))
}
