import { intro, log, outro, spinner } from "@clack/prompts"
import { Commands } from "@opencode/cli/commands/commands"
import { Runtime } from "@opencode/cli/framework/runtime"
import { Updater } from "@opencode/cli/services/updater"
import { OPENCODE_VERSION } from "@opencode/cli/version"
import { handlePromptErrors } from "@opencode/cli/ui/prompt"
import { Effect, Option } from "effect"

// Mirrors upstream's upgrade handler, so an expected failure prints one readable line instead of a stack trace.
export default Runtime.handler(
  Commands.commands.upgrade,
  Effect.fn("kilo.upgrade")(
    function* (input) {
      intro("Upgrade")
      const updater = yield* Updater.Service
      const available = yield* updater.check()
      if (available?.type === "unavailable") return yield* Effect.fail(new Error(available.message))

      const target = Option.getOrUndefined(input.target)?.trim().replace(/^v/, "")
      if (available?.type === "installed" && (!target || target === available.version)) {
        log.warn(`Kilo ${available.version} is already installed`)
        outro("Please restart Kilo to use it")
        return
      }
      if (!available && target === undefined) return outro("Kilo is up to date")

      const version = target ?? available?.version
      if (!version) return yield* Effect.fail(new Error("No Kilo v2 release selected."))
      log.info(`From ${OPENCODE_VERSION} → ${version}`)

      const progress = spinner()
      progress.start("Upgrading...")
      const method = Option.getOrUndefined(input.method)
      yield* method ? updater.upgrade(method, version) : updater.apply(version).pipe(Effect.asVoid)
      progress.stop("Upgrade complete")
      outro(`Please restart Kilo to use ${version}`)
    },
    (effect) => handlePromptErrors(effect),
  ),
)
