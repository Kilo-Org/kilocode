import { KiloCustomRouter } from "@kilocode/gateway-core"
import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect } from "effect"
import { AutoCommand } from "./auto"
import { call, connect, decode, info, reference, report, splitModel } from "./shared"

export default Runtime.handler(
  AutoCommand.commands.router.commands.remove,
  Effect.fn("kilo.auto.router.remove")(
    function* (input) {
      yield* reference(input.router)
      yield* splitModel(input.model)
      const connection = yield* connect(input)
      const response = yield* decode(
        KiloCustomRouter.RouterResponse,
        yield* call(() =>
          connection.rpc["routers.remove"]({ router: input.router, model: input.model }, connection.options),
        ),
      )
      yield* info(`Removed ${input.model} from ${response.router.modelId}.`)
    },
    Effect.catch(report("Could not remove the client entry")),
  ),
)
