import { Runtime } from "@opencode/cli/framework/runtime"
import { Global } from "@opencode/util/global"
import { Effect, Option } from "effect"
import { existsSync, statSync } from "node:fs"
import { EOL, homedir } from "node:os"
import path from "node:path"
import { KiloDatabase } from "../database"
import { KiloV1Store } from "../v1-store"
import { copyConfig } from "./config"
import { ImportCommand } from "./import"
import { cutoff } from "./since"

/**
 * `kilo2 import v1`: the manual import of an earlier Kilo installation. Without a kilo2 store it copies, converts and
 * links a new one; with one it adds the v1 sessions that store does not have yet. It refuses a target that is itself a
 * v1 store (which kilo2 never migrates in place). `--since` limits the copy to one time window and the parent and child
 * sessions of every session in it, and `--config` also copies the v1 global config.
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
        : beside(KiloDatabase.v1Store(global.data), path.join(homedir(), ".local", "share", "kilo", "kilo.db"))
      const since = Option.getOrUndefined(input.since)
      const window = yield* Effect.try({
        try: () => (since === undefined ? undefined : cutoff(since)),
        catch: asError,
      })
      if (input.config) {
        const config = beside(
          path.join(path.dirname(Global.Path.config), "kilo"),
          path.join(homedir(), ".config", "kilo"),
        )
        const copied = existsSync(config) ? copyConfig(config, Global.Path.config) : []
        process.stdout.write(
          copied.length === 0
            ? `No Kilo v1 config to copy from ${config}.${EOL}`
            : `Copied the Kilo v1 config ${copied.join(", ")} from ${config} to ${Global.Path.config}.${EOL}`,
        )
      }
      // The host selected the kilo2 store before this command started (./database).
      const file = process.env.OPENCODE_DB
      if (!file || file === ":memory:") return yield* Effect.fail(new Error("No kilo2 session store file is selected."))
      if (!existsSync(source) || !KiloV1Store.isV1Store(source))
        return yield* Effect.fail(
          new Error(`No Kilo v1 session store at ${source}. Pass --from with the kilo.db file or its data directory.`),
        )
      if (KiloV1Store.isKiloV1Store(file))
        return yield* Effect.fail(
          new Error(
            `${file} is a Kilo v1 session store, and kilo2 never migrates it in place: v1 could no longer read it. Use a kilo2 store name that differs from v1's.`,
          ),
        )
      const started = Date.now()
      const scope = window === undefined ? "" : ` (updated since ${new Date(window).toISOString().slice(0, 10)})`
      const progress = (done: number, total: number) =>
        process.stderr.write(`Importing Kilo v1 sessions ${done}/${total}${EOL}`)
      if (existsSync(file)) {
        process.stderr.write(`Importing the Kilo v1 sessions of ${source} into ${file}${EOL}`)
        const added = yield* Effect.tryPromise({
          try: () => KiloDatabase.mergeV1({ store: source, file, data: global.data, since: window, progress }),
          catch: asError,
        })
        return process.stdout.write(
          `Imported ${added} new Kilo v1 sessions${scope} from ${source} to ${file} in ${Date.now() - started} ms. Sessions already in kilo2 were kept as they are, and ${source} is unchanged.${EOL}`,
        )
      }
      const result = yield* Effect.tryPromise({
        try: () =>
          KiloDatabase.importV1({
            store: source,
            file,
            data: global.data,
            since: window,
            log: (line) => process.stderr.write(`${line}${EOL}`),
            onStart: () => process.stderr.write(`Importing the Kilo v1 sessions of ${source}${EOL}`),
            progress,
          }),
        catch: asError,
      })
      // Another process took the lock and created the store while this one waited, so its sessions are the result.
      if (result.skipped)
        return process.stdout.write(
          `Another kilo2 import created ${file} first, so this run imported nothing. It holds that run's sessions.${EOL}`,
        )
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

/**
 * The v1 path beside the kilo2 directory, or the default v1 path in the home directory when there is none: the
 * isolated `bun dev` profile moves the kilo2 directories away from the user's v1 ones.
 */
function beside(sibling: string, home: string) {
  return existsSync(sibling) || !existsSync(home) ? sibling : home
}

function asError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause))
}
