import { KiloCustomRouter } from "@kilocode/gateway-core"
import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect } from "effect"
import { AutoCommand } from "./auto"
import {
  call,
  connect,
  decode,
  describeEntry,
  info,
  location,
  reference,
  report,
  splitModel,
  UsageError,
} from "./shared"

export default Runtime.handler(
  AutoCommand.commands.router.commands.add,
  Effect.fn("kilo.auto.router.add")(
    function* (input) {
      yield* reference(input.router)
      const target = yield* splitModel(input.model)
      const connection = yield* connect(input)
      const models = (yield* call(() => connection.client.model.list({ location }))).data
      const servable = (provider: string, model: string) =>
        models.some((item) => item.providerID === provider && item.id === model)
      if (!servable(target.provider, target.model))
        return yield* Effect.fail(
          new UsageError(`Model ${input.model} is not configured in this CLI. Check \`kilo models\`.`),
        )
      const response = yield* decode(
        KiloCustomRouter.RouterResponse,
        yield* call(() =>
          connection.rpc["routers.add"]({ router: input.router, model: input.model }, connection.options),
        ),
      )
      const registered = response.router.entries.find(
        (item) => item.key === KiloCustomRouter.entryKey({ kind: "client", ...target }),
      )
      yield* info(`Registered ${input.model} on ${response.router.modelId}.`)
      if (registered) yield* info(describeEntry(registered, servable))
      if (registered?.needsClientEval)
        yield* info(`This entry needs a client eval: run \`kilo auto eval ${response.router.modelId}\`.`)
    },
    Effect.catch(report("Could not register the client entry")),
  ),
)
