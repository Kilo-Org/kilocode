import { Commands } from "@opencode/cli/commands/commands"
import status from "@opencode/cli/commands/handlers/service/status"
import { Runtime } from "@opencode/cli/framework/runtime"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { Effect } from "effect"
import { EOL } from "node:os"
import { KiloLoginService } from "./login"

// Wrapper of the upstream `service status` handler, which prints the server URL or `stopped`.
export default Runtime.handler(
  Commands.commands.service.commands.status,
  Effect.fn("kilo.service.status")(function* (input) {
    yield* status(input)
    // Kilo: the login unit state follows on stderr, because scripts read the server URL from stdout.
    yield* login.pipe(Effect.provide(LayerNode.compile(AppProcess.node)), Effect.catch(KiloLoginService.report))
  }),
)

const login = Effect.gen(function* () {
  const target = yield* KiloLoginService.target
  const run = yield* KiloLoginService.processRunner
  const state = yield* KiloLoginService.status(target, run)
  process.stderr.write(KiloLoginService.describe(state) + EOL)
})
