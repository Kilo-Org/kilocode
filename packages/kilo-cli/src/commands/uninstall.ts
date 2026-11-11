import { Commands } from "@opencode/cli/commands/commands"
import uninstall from "@opencode/cli/commands/handlers/uninstall"
import { Runtime } from "@opencode/cli/framework/runtime"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { Effect } from "effect"
import { EOL } from "node:os"
import { KiloLoginService } from "../service/login"

// Wrapper of the upstream `uninstall` handler.
export default Runtime.handler(
  Commands.commands.uninstall,
  Effect.fn("kilo.uninstall")(function* (input) {
    // Kilo: remove the login unit first. launchd and systemd would restart the background service that the upstream
    // uninstall stops. A failure stops here, before the upstream uninstall changes anything.
    const removed = yield* removeLogin(input).pipe(
      Effect.provide(LayerNode.compile(AppProcess.node)),
      Effect.as(true),
      Effect.catch((error) => KiloLoginService.report(error).pipe(Effect.as(false))),
    )
    if (!removed) return
    return yield* uninstall(input)
  }),
)

// A preview only reports the unit. The upstream refuses to run without --force and without a terminal, so that run
// keeps it. The upstream asks for confirmation later, so a cancelled interactive uninstall leaves the unit removed;
// `service install` restores it.
const removeLogin = Effect.fnUntraced(function* (input: Runtime.Input<typeof Commands.commands.uninstall>) {
  const target = yield* KiloLoginService.target
  if (KiloLoginService.unit(target) === undefined) return
  const run = yield* KiloLoginService.processRunner
  if (input.dryRun) {
    const state = yield* KiloLoginService.status(target, run)
    if (state.installed) process.stdout.write(`Would remove the login unit ${state.name} (${state.kind})${EOL}`)
    return
  }
  if (!input.force && !(process.stdin.isTTY && process.stdout.isTTY)) return
  const result = yield* KiloLoginService.uninstall(target, run)
  if (result.removed) process.stdout.write(`Removed the login unit ${result.name} (${result.kind})${EOL}`)
})
