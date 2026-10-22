import { Runtime } from "@opencode/cli/framework/runtime"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { Effect, Option } from "effect"
import { UserError } from "../../error"
import { Marketplace } from "../commands"
import { call, connect, print, validateResponse, type Connection } from "./client"

export default Runtime.handler(
  Marketplace.commands.uninstall,
  Effect.fn("cli.marketplace.uninstall")(function* (input) {
    const marketplace = yield* connect
    const records = yield* call(() =>
      marketplace.rpc.installed({}, marketplace.options).then(validateResponse("installed")),
    )
    const record = yield* Effect.try({ try: () => selectUninstall(records, input), catch: (error) => error })
    yield* uninstall(marketplace, record)
    yield* print([`Uninstalled ${record.kind} ${record.id} (${record.scope})`])
  }),
)

export function selectUninstall(
  records: readonly KiloMarketplaceRpc.Installed[],
  input: Runtime.Input<typeof Marketplace.commands.uninstall>,
) {
  if (input.project && input.global) throw new UserError({ message: "Pass only one of --project or --global." })
  const scope = input.project ? "project" : input.global ? "global" : undefined
  const recordsForItem = records.filter(
    (record) =>
      record.kind === input.kind &&
      record.id === input.id &&
      Option.match(input.registry, { onNone: () => true, onSome: (registry) => registry === record.registry }),
  )
  const matches = recordsForItem.filter((record) => scope === undefined || record.scope === scope)
  if (matches.length === 0) {
    const hint =
      recordsForItem.length > 0
        ? ` It is installed in ${recordsForItem[0].scope} scope; rerun with --${recordsForItem[0].scope}.`
        : " Run `market installed` to see installed items and their scopes."
    throw new UserError({
      message: `${input.id} is not installed from a marketplace${scope ? ` (${scope})` : ""}.${hint}`,
    })
  }
  if (new Set(matches.map((record) => record.scope)).size > 1)
    throw new UserError({ message: `${input.id} is installed in both scopes; pass --project or --global.` })
  if (matches.length > 1)
    throw new UserError({
      message: `${input.id} is installed from ${matches.map((record) => record.registry).join(", ")}; pass --registry`,
    })
  return matches[0]
}

export function uninstall(marketplace: Connection, record: KiloMarketplaceRpc.Installed) {
  return Effect.gen(function* () {
    // Resolve credentials before the config disappears, but never delete them when uninstall fails.
    const credentials = record.server
      ? yield* call(async () => {
          const servers = await marketplace.client.mcp.list({ location: marketplace.location })
          const integrationID = servers.data.find((server) => server.name === record.server)?.integrationID
          if (!integrationID) return []
          const integration = await marketplace.client.integration.get({
            integrationID,
            location: marketplace.location,
          })
          return integration.data?.connections.filter((connection) => connection.type === "credential") ?? []
        }).pipe(Effect.orElseSucceed(() => []))
      : []
    yield* call(() =>
      marketplace.rpc
        .uninstall(
          { registry: record.registry, kind: record.kind, id: record.id, scope: record.scope },
          marketplace.options,
        )
        .then(validateResponse("uninstall")),
    )
    yield* call(() =>
      Promise.all(
        credentials.map((connection) => marketplace.client.credential.remove({ credentialID: connection.id })),
      ),
    ).pipe(Effect.ignore)
  })
}
