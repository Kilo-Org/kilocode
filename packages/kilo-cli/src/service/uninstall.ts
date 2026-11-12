import { Runtime } from "@opencode/cli/framework/runtime"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { Effect } from "effect"
import { EOL } from "node:os"
import { KiloLoginService } from "./login"
import { KiloServiceCommands } from "./service"

export default Runtime.handler(
  KiloServiceCommands.uninstall,
  Effect.fn("kilo.service.uninstall")(
    function* () {
      const target = yield* KiloLoginService.target
      const run = yield* KiloLoginService.processRunner
      const result = yield* KiloLoginService.uninstall(target, run)
      process.stdout.write(
        (result.removed ? `login: removed (${result.kind}, ${result.name})` : "login: not installed") + EOL,
      )
    },
    Effect.provide(LayerNode.compile(AppProcess.node)),
    Effect.catch(KiloLoginService.report),
  ),
)
