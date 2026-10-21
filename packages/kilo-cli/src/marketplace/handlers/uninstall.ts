import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect, Option } from "effect"
import { Marketplace } from "../commands"
import { call, connect, print, type Connection } from "./client"

export default Runtime.handler(
  Marketplace.commands.uninstall,
  Effect.fn("cli.marketplace.uninstall")(function* (input) {
    const marketplace = yield* connect
    const scope = input.project ? "project" : "global"
    const records = yield* call(() => marketplace.rpc.installed({}, marketplace.options))
    const matches = records.filter(
      (record) =>
        record.kind === input.kind &&
        record.id === input.id &&
        record.scope === scope &&
        Option.match(input.registry, { onNone: () => true, onSome: (registry) => registry === record.registry }),
    )
    if (matches.length === 0) {
      return yield* Effect.fail(new Error(`${input.id} is not installed from a marketplace (${scope})`))
    }
    if (matches.length > 1) {
      const registries = matches.map((record) => record.registry).join(", ")
      return yield* Effect.fail(new Error(`${input.id} is installed from ${registries}; pass --registry`))
    }
    const server = matches[0].server
    if (server) yield* signOut(marketplace, server)
    yield* call(() =>
      marketplace.rpc.uninstall(
        { registry: matches[0].registry, kind: input.kind, id: input.id, scope },
        marketplace.options,
      ),
    )
    yield* print([`Uninstalled ${input.kind} ${input.id} (${scope})`])
  }),
)

// Removes the server's stored OAuth credentials first, as `mcp logout` and the TUI do: the plugin API cannot remove
// credentials, so the client does it. Best effort: a server without a sign-in has nothing to remove.
function signOut(marketplace: Connection, name: string) {
  return call(async () => {
    const servers = await marketplace.client.mcp.list({ location: marketplace.location })
    const integrationID = servers.data.find((server) => server.name === name)?.integrationID
    if (!integrationID) return
    const integration = await marketplace.client.integration.get({ integrationID, location: marketplace.location })
    const credentials = integration.data?.connections.filter((connection) => connection.type === "credential") ?? []
    await Promise.all(
      credentials.map((connection) => marketplace.client.credential.remove({ credentialID: connection.id })),
    )
  }).pipe(Effect.ignore)
}
