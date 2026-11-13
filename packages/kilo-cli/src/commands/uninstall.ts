import { Commands } from "@opencode/cli/commands/commands"
import uninstall from "@opencode/cli/commands/handlers/uninstall"
import { Runtime } from "@opencode/cli/framework/runtime"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Effect, FileSystem } from "effect"
import { EOL } from "node:os"
import { KiloLoginService } from "../service/login"

// Wrapper of the upstream `uninstall` handler.
export default Runtime.handler(
  Commands.commands.uninstall,
  Effect.fn("kilo.uninstall")(function* (input) {
    const global = yield* Global.Service
    const fs = yield* FileSystem.FileSystem
    const cache = yield* fs.exists(global.cache)
    const before = process.exitCode
    yield* uninstall(input)
    // A failed or interrupted run leaves a non-zero exit code. A declined confirmation returns normally after printing
    // "Cancelled", so the cache the handler removes before anything else is what proves an uninstall ran.
    if (process.exitCode !== before) return
    if (!uninstalled(input, { before: cache, after: yield* fs.exists(global.cache) })) return
    yield* removeLogin(input).pipe(
      Effect.provide(LayerNode.compile(AppProcess.node)),
      Effect.catch(KiloLoginService.report),
    )
  }),
)

/** Whether the upstream handler actually uninstalled, which a declined confirmation and a dry run are not. */
export function uninstalled(
  input: { readonly force?: boolean; readonly dryRun?: boolean },
  cache: { readonly before: boolean; readonly after: boolean },
) {
  if (input.dryRun || input.force) return true
  return cache.before && !cache.after
}

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
