import { Runtime } from "@opencode/cli/framework/runtime"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { Effect, Option } from "effect"
import { UserError } from "../../error"
import { Marketplace } from "../commands"
import { call, connect, print, recordMessages, validateResponse, type Connection } from "./client"

export default Runtime.handler(
  Marketplace.commands.install,
  Effect.fn("cli.marketplace.install")(function* (input) {
    const marketplace = yield* connect
    const registry = yield* Option.match(input.registry, {
      onSome: (registry) => Effect.succeed(registry),
      onNone: () => call(() => resolveRegistry(marketplace, input.kind, input.id)),
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
      ...recordMessages(record),
    ])
  }),
)

/** Implicit selection needs complete discovery; a failed source may contain another matching id. */
export async function resolveRegistry(marketplace: Connection, kind: KiloMarketplaceRpc.Kind, id: string) {
  // Searchable registries list only a top slice without a query.
  const listed = await marketplace.rpc
    .list({ kind, query: id.split("/").at(-1) }, marketplace.options)
    .then(validateResponse("list"))
  const matches = [...new Set(listed.items.filter((item) => item.id === id).map((item) => item.registry))]
  if (matches.length === 1 && listed.failures.length === 0) return matches[0]
  const failures = listed.failures.map((failure) => `${failure.registry}: ${failure.message}`)
  const sources = await marketplace.rpc
    .registries({}, marketplace.options)
    .then(validateResponse("registries"))
    .catch((error: Error) => {
      failures.push(`Couldn't load registry settings: ${error.message}`)
      return []
    })
  const disabled = sources.filter((source) => !source.enabled && source.kinds.includes(kind))
  throw new UserError({
    message: [
      ...(listed.failures.length > 0
        ? [`Discovery in enabled registries is incomplete; cannot automatically select a registry for ${id}.`]
        : []),
      ...failures.map((failure) => `Warning: ${failure}`),
      matches.length > 0
        ? `${id} was found in ${matches.join(", ")}; pass --registry <id> to choose explicitly.`
        : `No ${kind} ${id} found in the enabled registries${listed.failures.length ? " that responded" : ""}.`,
      ...disabled.map(
        (source) =>
          `${source.name} (${source.id}) is disabled and supports ${kind} items; enable it with ` +
          `\`kilo marketplace registries --enable ${source.id}\` and retry.`,
      ),
    ].join("\n"),
  })
}
