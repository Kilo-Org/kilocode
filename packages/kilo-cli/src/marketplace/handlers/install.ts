import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect, Option } from "effect"
import { UserError } from "../../error"
import { Marketplace } from "../commands"
import { call, connect, print, validateResponse } from "./client"

export default Runtime.handler(
  Marketplace.commands.install,
  Effect.fn("cli.marketplace.install")(function* (input) {
    const marketplace = yield* connect
    const registry = yield* Option.match(input.registry, {
      onSome: (registry) => Effect.succeed(registry),
      // Without --registry, use the only registry that has the item; an id in several registries is ambiguous.
      onNone: () =>
        // Search by the last id segment: searchable registries list only a top slice without a query.
        call(() =>
          marketplace.rpc
            .list({ kind: input.kind, query: input.id.split("/").at(-1) }, marketplace.options)
            .then(validateResponse("list")),
        ).pipe(
          Effect.flatMap((listed) => {
            const registries = [
              ...new Set(listed.items.filter((item) => item.id === input.id).map((item) => item.registry)),
            ]
            if (registries.length === 1) return Effect.succeed(registries[0])
            if (registries.length === 0)
              return Effect.fail(new UserError({ message: `No ${input.kind} ${input.id} in any marketplace` }))
            return Effect.fail(
              new UserError({ message: `${input.id} is in ${registries.join(", ")}; pass --registry` }),
            )
          }),
        ),
    })
    const record = yield* call(() =>
      marketplace.rpc
        .install(
          {
            registry,
            kind: input.kind,
            id: input.id,
            scope: input.project ? "project" : "global",
            option: Option.getOrUndefined(input.option),
            params: Option.getOrUndefined(input.param),
          },
          marketplace.options,
        )
        .then(validateResponse("install")),
    )
    yield* print([
      `Installed ${record.kind} ${record.id} from ${record.registry} (${record.scope})`,
      ...record.paths.map((target) => `  ${target}`),
      ...(record.config ? [`  ${record.config}`] : []),
    ])
  }),
)
