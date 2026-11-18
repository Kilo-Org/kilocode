import { Runtime } from "@opencode/cli/framework/runtime"
import { selfCommand } from "@opencode/cli/util/process"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { KiloLoginService } from "./login"
import { KiloServiceCommands } from "./service"

export default Runtime.handler(
  KiloServiceCommands.install,
  Effect.fn("kilo.service.install")(
    function* (input) {
      const command = yield* Effect.try({
        try: () =>
          KiloLoginService.resolveCommand({ executable: Option.getOrUndefined(input.command), self: selfCommand }),
        catch: (cause) => cause,
      })
      const target = yield* KiloLoginService.target
      const run = yield* KiloLoginService.processRunner
      const state = yield* KiloLoginService.install(target, { command, path: process.env.PATH }, run)
      process.stdout.write(`${KiloLoginService.describe(state)}: ${command.join(" ")}${EOL}`)
    },
    Effect.provide(LayerNode.compile(AppProcess.node)),
    Effect.catch(KiloLoginService.report),
  ),
)
