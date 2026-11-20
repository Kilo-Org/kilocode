import { Commands } from "@opencode/cli/commands/commands"
import { Runtime } from "@opencode/cli/framework/runtime"
import { Updater } from "@opencode/cli/services/updater"
import { Effect, Option } from "effect"

export default Runtime.handler(
  Commands.commands.upgrade,
  Effect.fn("kilo.upgrade")(function* (input) {
    const updater = yield* Updater.Service
    const available = yield* updater.check()
    if (available?.type === "unavailable") return yield* Effect.fail(new Error(available.message))
    const target = Option.getOrUndefined(input.target)?.trim().replace(/^v/, "")
    if (available?.type === "installed" && (!target || target === available.version)) {
      process.stdout.write(`Kilo ${available.version} is installed. Relaunch Kilo to use it.\n`)
      return
    }
    if (!available && target === undefined) {
      process.stdout.write("Kilo is up to date.\n")
      return
    }

    const version = target ?? available?.version
    if (!version) return yield* Effect.fail(new Error("No Kilo v2 release selected."))
    const method = Option.getOrUndefined(input.method)
    yield* method ? updater.upgrade(method, version) : updater.apply(version)
    process.stdout.write(`Kilo ${version} is installed. Relaunch Kilo to use it.\n`)
  }),
)
