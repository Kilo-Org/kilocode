import { KiloCustomRouter } from "@kilocode/gateway-core"
import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect } from "effect"
import { AutoCommand } from "./auto"
import { call, connect, decode, describeEntry, describeRouter, info, location, print, report } from "./shared"

export default Runtime.handler(
  AutoCommand.commands.router.commands.list,
  Effect.fn("kilo.auto.router.list")(
    function* (input) {
      const connection = yield* connect(input)
      const raw = yield* call(() => connection.rpc["routers.list"]({}, connection.options))
      if (input.json) return yield* print(JSON.stringify(raw, null, 2))
      const list = yield* decode(KiloCustomRouter.ListResponse, raw)
      if (list.routers.length === 0) return yield* info("No custom auto routers. Create one in the Kilo web editor.")
      const models = (yield* call(() => connection.client.model.list({ location }))).data
      const servable = (provider: string, model: string) =>
        models.some((item) => item.providerID === provider && item.id === model)
      for (const router of list.routers) {
        yield* print(router.modelId)
        yield* print(`  ${describeRouter(router)}`)
        for (const item of router.entries) yield* print(`  ${describeEntry(item, servable)}`)
      }
    },
    Effect.catch(report("Could not load custom auto routers")),
  ),
)
