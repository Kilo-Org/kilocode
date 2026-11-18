import { Commands } from "@opencode/cli/commands/commands"
import stop from "@opencode/cli/commands/handlers/service/stop"
import { Runtime } from "@opencode/cli/framework/runtime"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { Effect } from "effect"
import { EOL } from "node:os"
import { KiloLoginService } from "./login"

// Wrapper of the upstream `service stop` handler. The login unit would restart the background server it stops: launchd's
// `KeepAlive` and systemd's `Restart=on-failure` read the SIGTERM exit code 143 as a failure. The unit is stopped first
// and stays installed, so the server starts again at the next login.
export default Runtime.handler(
  Commands.commands.service.commands.stop,
  Effect.fn("kilo.service.stop")(function* (input) {
    yield* login.pipe(
      Effect.provide(LayerNode.compile(AppProcess.node)),
      Effect.catch((error) => KiloLoginService.notice(error)),
    )
    yield* stop(input)
  }),
)

const login = Effect.gen(function* () {
  const target = yield* KiloLoginService.target
  const run = yield* KiloLoginService.processRunner
  const result = yield* KiloLoginService.stop(target, run)
  if (result.stopped) process.stdout.write(`Stopped the login unit (${result.kind}, ${result.name})${EOL}`)
})
