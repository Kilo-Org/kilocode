import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect, Option } from "effect"
import { Marketplace } from "../commands"
import { call, connect, print, scopesOf, validateResponse } from "./client"

export default Runtime.handler(
  Marketplace.commands.list,
  Effect.fn("cli.marketplace.list")(function* (input) {
    const marketplace = yield* connect
    const kinds = Option.match(input.kind, {
      onNone: () => ["skill", "mcp", "agent"] as const,
      onSome: (kind) => [kind] as const,
    })
    // The server searches registries that support it and filters the others by the same text.
    const query = Option.getOrUndefined(input.search)
    const [lists, installed] = yield* call(() =>
      Promise.all([
        Promise.all(
          kinds.map((kind) =>
            marketplace.rpc
              .list({ kind, refresh: input.refresh, query }, marketplace.options)
              .then(validateResponse("list")),
          ),
        ),
        marketplace.rpc.installed({}, marketplace.options).then(validateResponse("installed")),
      ]),
    )
    const items = lists.flatMap((list) => list.items)
    const failures = lists.flatMap((list) => list.failures)
    // A registry that failed does not hide the others; report it on stderr so the list stays parseable.
    for (const failure of failures) process.stderr.write(`warning: ${failure.registry}: ${failure.message}\n`)
    if (items.length === 0) return yield* print(["No marketplace items found in the enabled registries that responded"])
    const width = Math.max(...items.map((item) => item.id.length))
    const registries = Math.max(...items.map((item) => item.registry.length))
    yield* print(
      items.map((item) => {
        const scopes = scopesOf(installed, item)
        const mark = scopes.length > 0 ? `[installed: ${scopes.join(", ")}]` : ""
        return [
          item.kind.padEnd(5),
          item.id.padEnd(width),
          item.registry.padEnd(registries),
          oneLine(item.description),
          mark,
        ]
          .join("  ")
          .trimEnd()
      }),
    )
  }),
)

function oneLine(text: string) {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat
}
