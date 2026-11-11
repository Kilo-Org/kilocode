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
    const before = process.exitCode
    // The upstream handler asks for confirmation and may still be cancelled, so the login unit is untouched until it
    // has actually uninstalled. It reports a declined prompt as exit code 130 and a failed run as 1.
    yield* uninstall(input)
    if (process.exitCode !== before) return
    yield* removeLogin(input).pipe(
      Effect.provide(LayerNode.compile(AppProcess.node)),
      Effect.catch(KiloLoginService.report),
    )
  }),
)

// A preview only reports the unit. A non-interactive run without --force never reaches here: the upstream refuses it
// and sets a non-zero exit code first, so the unit is kept.
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
