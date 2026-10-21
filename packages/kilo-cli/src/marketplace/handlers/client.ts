import { EOL } from "node:os"
import { ServerConnection } from "@opencode/cli/services/server-connection"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { Effect } from "effect"

// Shared parts of the `kilo marketplace` handlers. Each handler connects to the running server (starting it when
// needed) and calls the `kilocode.marketplace` RPC for the current directory.

export const connect = Effect.gen(function* () {
  const { endpoint } = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  const location = { directory: process.cwd() }
  return { client, rpc: client.rpc(KiloMarketplaceRpc.Definition), options: { location }, location }
})

export type Connection = Effect.Success<typeof connect>

export const call = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (error) => new Error(error instanceof Error ? error.message : String(error)) })

export const print = (lines: readonly string[]) => Effect.sync(() => process.stdout.write(lines.join(EOL) + EOL))

export function scopesOf(installed: readonly KiloMarketplaceRpc.Installed[], item: KiloMarketplaceRpc.Item) {
  return installed
    .filter((record) => record.registry === item.registry && record.kind === item.kind && record.id === item.id)
    .map((record) => record.scope)
}
