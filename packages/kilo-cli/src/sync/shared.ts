import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { UI } from "@opencode/cli/run/ui"
import { ServerConnection } from "@opencode/cli/services/server-connection"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { KiloSessionSyncRpc } from "@opencode/schema/kilocode/session-sync"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { resolve } from "node:path"

export class SyncError extends Error {}

export const connect = Effect.fn("kilo.sync.connect")(function* (input: {
  readonly server: Option.Option<string>
  readonly standalone: boolean
  readonly directory: Option.Option<string>
}) {
  const directory = resolve(Option.getOrElse(input.directory, () => process.cwd()))
  const server = yield* ServerConnection.resolve({
    server: Option.getOrUndefined(input.server),
    standalone: input.standalone,
  })
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const options = { location: { directory } }
  // RPC awaits plugin activation without loading the model catalog or requiring provider authentication.
  yield* call(() => client.rpc(KiloHandshakeRpc.Definition).get({}, options))
  return {
    directory,
    options,
    rpc: client.rpc(KiloSessionSyncRpc.Definition),
    gateway: client.rpc(KiloGatewayRpc.Definition),
  }
})

export function call<A>(run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => {
      if (typeof cause === "object" && cause !== null && "type" in cause) {
        if (cause.type === "unauthorized") return new SyncError("Sign in to Kilo with `kilo auth login`.")
        if (cause.type === "failed" && "data" in cause) {
          const data = cause.data
          if (typeof data === "object" && data !== null && "code" in data && typeof data.code === "string") {
            const message = "message" in data && typeof data.message === "string" ? `: ${sanitize(data.message)}` : ""
            return new SyncError(`Synchronization rejected (${sanitize(data.code)})${message}`)
          }
        }
      }
      return new SyncError("Could not communicate with the Kilo server. Check --server and server availability.")
    },
  })
}

export function destination(value: string, local: boolean) {
  return Effect.try({
    try: () => {
      const url = new URL(value)
      const loopback =
        url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname)
      if (url.username || url.password || url.search || url.hash || value.includes("?") || value.includes("#"))
        throw new SyncError("Destination URL cannot contain credentials, a query, or a fragment.")
      if (url.protocol !== "https:" && !(local && url.protocol === "http:" && loopback))
        throw new SyncError("Use an HTTPS destination, or --local with an HTTP loopback destination.")
      return url.toString().replace(/\/$/, "")
    },
    catch: (cause) => (cause instanceof SyncError ? cause : new SyncError("Invalid destination URL.")),
  })
}

export function sanitize(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/https?:\/\/[^\s]+/gi, "[URL]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:token|secret|password|authorization|credential|grant)\s*[:=]\s*\S+/gi, "[redacted]")
    .slice(0, 1024)
}

export function printStatus(status: KiloSessionSyncRpc.Status, json: boolean) {
  return Effect.sync(() => {
    const safe = {
      ...status,
      directory: sanitize(status.directory),
      ...(status.destination ? { destination: safeDestination(status.destination) } : {}),
      ...(status.tenant ? { tenant: { type: status.tenant.type, id: sanitize(status.tenant.id) } } : {}),
      ...(status.userID ? { userID: sanitize(status.userID) } : {}),
      ...(status.sourceID ? { sourceID: sanitize(status.sourceID) } : {}),
      ...(status.error
        ? { error: { code: sanitize(status.error.code), message: sanitize(status.error.message) } }
        : {}),
    }
    const lines = [
      `Session sync: ${safe.enabled ? "enabled" : "disabled"}`,
      `Workspace: ${safe.directory}`,
      ...(safe.destination ? [`Destination: ${safe.destination}`] : []),
      ...(safe.tenant ? [`Tenant: ${safe.tenant.type} ${safe.tenant.id}`] : []),
      ...(safe.userID ? [`Creator: ${safe.userID}`] : []),
      ...(safe.sourceID ? [`Source: ${safe.sourceID}`] : []),
      `Sessions: ${safe.sessions}; pending: ${safe.pending}`,
      ...(safe.lastSuccess !== undefined ? [`Last success: ${safe.lastSuccess} (epoch ms)`] : []),
      ...(safe.error ? [`Error: ${safe.error.code}: ${safe.error.message}`] : []),
    ]
    process.stdout.write((json ? JSON.stringify(safe, null, 2) : lines.join(EOL)) + EOL)
  })
}

function safeDestination(value: string) {
  if (!URL.canParse(value)) return "[invalid destination]"
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash) return "[invalid destination]"
  return (url.origin + url.pathname).replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
}

export const report = (error: unknown) =>
  Effect.sync(() => {
    UI.error(
      error instanceof SyncError
        ? sanitize(error.message)
        : "Session synchronization failed. Check server availability.",
    )
    process.exitCode = 1
  })
