import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect, Option } from "effect"
import { Marketplace } from "../commands"
import { call, connect, print, validateResponse } from "./client"

export default Runtime.handler(
  Marketplace.commands.registries,
  Effect.fn("cli.marketplace.registries")(function* (input) {
    const marketplace = yield* connect
    const change = Option.match(input.enable, {
      onSome: (id) => ({ id, enabled: true }),
      onNone: () => Option.match(input.disable, { onSome: (id) => ({ id, enabled: false }), onNone: () => undefined }),
    })
    const registries = yield* call(() =>
      change
        ? marketplace.rpc["registries.set"](change, marketplace.options).then(validateResponse("registries.set"))
        : marketplace.rpc.registries({}, marketplace.options).then(validateResponse("registries")),
    )
    const width = Math.max(...registries.map((registry) => registry.id.length))
    yield* print(
      registries.map(
        (registry) =>
          `${registry.enabled ? "on " : "off"}  ${registry.id.padEnd(width)}  ${registry.kinds.join(",").padEnd(15)}  ${registry.description}`,
      ),
    )
  }),
)
