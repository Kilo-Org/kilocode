// `kilo browser install-host`: write the native messaging shim, the per-browser host
// manifests, and the Windows registry keys that point the browsers at them.
import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect } from "effect"
import { KiloBrowserCommands } from "./commands"

export default Runtime.handler(
  KiloBrowserCommands.commands["install-host"],
  Effect.fn("kilo.browser.install-host")(function* () {
    const { install } = yield* Effect.promise(() => import("./install"))
    const result = yield* Effect.tryPromise({ try: () => install(), catch: (cause) => cause as Error })
    for (const line of [result.shim, ...result.files, ...result.keys]) process.stdout.write(`${line}\n`)
  }),
)
