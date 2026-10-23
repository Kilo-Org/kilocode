import { KiloCustomRouter } from "@kilocode/gateway-core"
import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect } from "effect"
import { AutoCommand } from "./auto"
import { call, connect, decode, describeEntry, location, print, reference, report, splitModel } from "./shared"

export default Runtime.handler(
  AutoCommand.commands.router.commands.add,
  Effect.fn("kilo.auto.router.add")(
    function* (input) {
      yield* reference(input.router)
      const target = yield* splitModel(input.model)
      const connection = yield* connect(input)
      const response = yield* decode(
        KiloCustomRouter.RouterResponse,
        yield* call(() =>
          connection.rpc["routers.add"]({ router: input.router, model: input.model }, connection.options),
        ),
      )
      const models = (yield* call(() => connection.client.model.list({ location }))).data
      const registered = response.router.entries.find(
        (item) => item.key === KiloCustomRouter.entryKey({ kind: "client", ...target }),
      )
      yield* print(`Registered ${input.model} on ${response.router.modelId}.`)
      if (registered)
        yield* print(
          describeEntry(registered, (provider, model) =>
            models.some((item) => item.providerID === provider && item.id === model),
          ),
        )
      if (registered?.needsClientEval)
        yield* print(`This entry needs a client eval: run \`kilo auto eval ${response.router.modelId}\`.`)
    },
    Effect.catch(report("Could not register the client entry")),
  ),
)
