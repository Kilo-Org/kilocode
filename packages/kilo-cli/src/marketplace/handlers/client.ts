import { EOL } from "node:os"
import { ServerConnection } from "@opencode/cli/services/server-connection"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import type { Rpc } from "@opencode/schema/rpc"
import { Effect } from "effect"
import { UserError } from "../../error"

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
  Effect.tryPromise({
    try: run,
    catch: (error) => {
      if (error instanceof Error) return error
      if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
        if (
          "type" in error &&
          typeof error.type === "string" &&
          Object.hasOwn(KiloMarketplaceRpc.Definition.methods.list.errors, error.type)
        )
          return new UserError({ message: error.message })
        return new Error(error.message, { cause: error })
      }
      return new Error(String(error), { cause: error })
    },
  })

export const print = (lines: readonly string[]) => Effect.sync(() => process.stdout.write(lines.join(EOL) + EOL))

export function validateResponse<M extends keyof typeof KiloMarketplaceRpc.Definition.methods>(method: M) {
  return async (value: unknown) => {
    const result = await KiloMarketplaceRpc.Definition.methods[method].output["~standard"].validate(value)
    if (result.issues)
      throw new UserError({
        message:
          "Incompatible marketplace response from the background server. Restart it with `kilo service restart` " +
          "(or `bun dev service restart` in this checkout) and retry.",
      })
    // The selected method's output schema validates the value; preserve that correlation for generic callers.
    return result.value as Rpc.Output<(typeof KiloMarketplaceRpc.Definition.methods)[M]["output"]>
  }
}

export function scopesOf(installed: readonly KiloMarketplaceRpc.Installed[], item: KiloMarketplaceRpc.Item) {
  return installed
    .filter((record) => record.registry === item.registry && record.kind === item.kind && record.id === item.id)
    .map((record) => record.scope)
}
