import { define, type Plugin } from "@opencode-ai/plugin/effect/plugin"
import { NetworkRpc, type NetworkWait } from "@opencode-ai/schema/kilocode/network"
import type { SessionError } from "@opencode-ai/schema/session-error"
import { Deferred, Duration, Effect, Exit } from "effect"

export const NETWORK_POLICY_ID = "kilocode.network-policy"

const POLL_MS = 3_000
const PROBE_MS = 5_000
const RESUME_MS = 10_000
const PUBLIC_PROBES = ["https://kilo.ai", "https://example.com", "https://cloudflare.com/cdn-cgi/trace"]

// Transport text carries the platform code first (Bun: "ECONNRESET: ...", "ConnectionRefused: ...").
const DESCRIPTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/TimeoutError|UND_ERR_HEADERS_TIMEOUT/, "Request timed out"],
  [/ECONNRESET/, "Connection reset by server"],
  [/ECONNREFUSED|ConnectionRefused/, "Connection refused"],
  [/ENOTFOUND/, "Host not found"],
  [/EAI_AGAIN/, "DNS lookup failed"],
  [/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|ERR_SOCKET_CONNECTION_TIMEOUT/, "Connection timed out"],
  [/ENETUNREACH/, "Network is unreachable"],
  [/EHOSTUNREACH/, "Host is unreachable"],
  [/ENETDOWN/, "Network is down"],
  [/UND_ERR_SOCKET/, "Network socket failed"],
  [/failed to fetch|fetch failed/i, "Network request failed"],
]

// Messages that identify a lost connection even when the error was not classified as transport.
const DISCONNECTED = [
  /ECONNRESET|ECONNREFUSED|ConnectionRefused|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ENETDOWN/,
  /UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_SOCKET|ERR_SOCKET_CONNECTION_TIMEOUT|TimeoutError/,
  /load failed|failed to fetch|fetch failed|network connection was lost|network is unreachable/i,
  /socket connection|socket hang up|connection timed out|connection terminated|connect timeout/i,
  /unable to connect.*access the url/i,
]

export interface NetworkPolicyOptions {
  /** Resolves true while the network path to the provider endpoint is usable. */
  readonly probe?: (endpoint: string | undefined) => Promise<boolean>
  /** Reconnects a failed MCP server once the network is back. */
  readonly reconnect?: (input: { server: string; directory: string; workspaceID?: string }) => Promise<void>
  readonly pollMs?: number
  readonly resumeMs?: number
}

export function disconnected(error: SessionError.Error) {
  if (error.type === "provider.transport") return true
  return DISCONNECTED.some((pattern) => pattern.test(error.message))
}

export function describe(error: SessionError.Error) {
  const match = DESCRIPTIONS.find(([pattern]) => pattern.test(error.message))
  if (match) return match[1]
  if (/unable to connect.*access the url/i.test(error.message)) return error.message
  return "Network connection failed"
}

/**
 * Holds a retrying session step while the network is down, then lets the native retry proceed.
 * The wait runs inside the `session.retry` hook, so a session interrupt cancels it like any step.
 */
export function createNetworkPolicy(options: NetworkPolicyOptions = {}): Plugin {
  const probe = options.probe ?? probeProvider
  const poll = Duration.millis(options.pollMs ?? POLL_MS)
  const countdown = Duration.millis(options.resumeMs ?? RESUME_MS)
  return define({
    id: NETWORK_POLICY_ID,
    effect: Effect.fn("KiloNetworkPolicy.effect")(function* (ctx) {
      const scope = yield* Effect.scope
      const endpoints = new Map<string, string>()
      const waits = new Map<string, { info: NetworkWait; resume: Deferred.Deferred<void> }>()
      const registration = yield* ctx.rpc.register(NetworkRpc, {
        list: () => Effect.succeed({ waits: Array.from(waits.values(), (wait) => wait.info) }),
        resume: (input) =>
          Effect.gen(function* () {
            const wait = waits.get(input.id)
            if (!wait) return { resumed: false }
            return { resumed: yield* Deferred.succeed(wait.resume, undefined) }
          }),
      }).pipe(Effect.orDie)
      const emit = registration.events.emit
      const check = (endpoint: string | undefined) => Effect.promise(() => probe(endpoint).catch(() => false))

      yield* ctx.session.hook("http.request", (event) =>
        Effect.sync(() => endpoints.set(event.sessionID, event.request.url)),
      )

      yield* ctx.session.hook("retry", (event) =>
        Effect.gen(function* () {
          if (!event.decision.retry || !disconnected(event.error)) return
          const endpoint = endpoints.get(event.sessionID)
          // A reachable endpoint means the provider failed, not the network: keep native backoff.
          if (yield* check(endpoint)) return

          const id = `net_${crypto.randomUUID()}`
          const wait: { info: NetworkWait; resume: Deferred.Deferred<void> } = {
            info: {
              id,
              sessionID: event.sessionID,
              message: describe(event.error),
              restored: false,
              time: { created: Date.now() },
            },
            resume: yield* Deferred.make<void>(),
          }
          waits.set(id, wait)
          yield* emit("asked", wait.info).pipe(Effect.ignore)

          const restore = Effect.gen(function* () {
            do yield* Effect.sleep(poll)
            while (!(yield* check(endpoint)))
            const restored = Date.now()
            wait.info = {
              ...wait.info,
              restored: true,
              time: { ...wait.info.time, restored, resume: restored + Duration.toMillis(countdown) },
            }
            yield* emit("restored", wait.info).pipe(Effect.ignore)
            yield* Effect.sleep(countdown)
          })

          yield* Effect.race(restore, Deferred.await(wait.resume)).pipe(
            Effect.onExit((exit) =>
              Effect.gen(function* () {
                waits.delete(id)
                yield* emit("resolved", {
                  id,
                  sessionID: event.sessionID,
                  outcome: Exit.isSuccess(exit) ? "resumed" : "cancelled",
                }).pipe(Effect.ignore)
              }),
            ),
          )
          event.decision = { retry: true, delay: 0 }
          // Reconnect in the background so a slow MCP server never delays the held step.
          if (options.reconnect) yield* reconnectFailedServers(options.reconnect).pipe(Effect.forkIn(scope))
        }),
      )

      function reconnectFailedServers(reconnect: NonNullable<NetworkPolicyOptions["reconnect"]>) {
        return Effect.gen(function* () {
          const servers = yield* ctx.mcp.list().pipe(Effect.orElseSucceed(() => ({ data: [] })))
          const target = {
            directory: ctx.location.directory,
            ...(ctx.location.workspaceID === undefined ? {} : { workspaceID: ctx.location.workspaceID }),
          }
          yield* Effect.forEach(
            servers.data.filter((server) => server.status.status === "failed"),
            (server) => Effect.promise(() => reconnect({ ...target, server: server.name }).catch(() => undefined)),
            { concurrency: "unbounded", discard: true },
          )
        })
      }
    }),
  })
}

/**
 * The provider endpoint is probed at the TCP level, so a busy or slow provider is never mistaken
 * for a dead network. When the socket does not open, public probes distinguish a dead network
 * from a provider-specific outage.
 */
export async function probeProvider(endpoint: string | undefined) {
  if (endpoint && (await dial(endpoint))) return true
  return Promise.any(
    PUBLIC_PROBES.map(async (url) => {
      const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(PROBE_MS) })
      if (response.status < 500) return true
      throw new Error("network probe failed")
    }),
  ).catch(() => false)
}

export async function dial(endpoint: string) {
  const target = URL.parse(endpoint)
  if (!target) return false
  const connecting = Bun.connect({
    hostname: target.hostname,
    port: Number(target.port) || (target.protocol === "https:" ? 443 : 80),
    socket: { data() {} },
  })
  // A silently dropped SYN never rejects; only the OS connect timeout (minutes) would end it.
  const socket = await Promise.race([connecting.catch(() => undefined), Bun.sleep(PROBE_MS).then(() => undefined)])
  if (socket) {
    socket.end()
    return true
  }
  connecting.then(
    (late) => late.end(),
    () => undefined,
  )
  return false
}
