import { OpenCode } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { local } from "../../local"
import type { Manager } from "../../server"

// Autocomplete requests go through the `kilocode.gateway` RPC of the v2 server, so the Kilo token and the provider
// keys stay in the server process. The extension host only knows the server URL and its local password.
export type FimInput = {
  prefix: string
  suffix: string
  provider?: string
  model?: string
  maxTokens?: number
  temperature?: number
}

export type FimResult = { text: string; cost: number; inputTokens: number; outputTokens: number }

export interface AutocompleteConnection {
  /** True while the Kilo server runs. */
  connected(): boolean
  onStateChange(listener: () => void): () => void
  /** Credential or team changes on the server, which can lift an authentication or credit failure. */
  onAuthChange(listener: () => void): () => void
  fim(input: FimInput, signal?: AbortSignal): Promise<FimResult>
  /** The Kilo credit balance, or undefined when it cannot be read. */
  balance(): Promise<number | undefined>
}

/** A failed request. `status` is the HTTP status the error backoff classifies, when one is known. */
export class AutocompleteRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = "AutocompleteRequestError"
  }
}

/**
 * The autocomplete connection of the extension host. `started` and `stopped` follow the server manager, so
 * `connected()` is true only while a server runs. Each server start subscribes to its event stream to report
 * credential and team changes, which can lift an authentication or credit failure.
 */
export function createConnection(input: { server: Manager; directory: string }) {
  const state: { connected: boolean; client?: { url: string; api: ReturnType<typeof OpenCode.make> }; events?: AbortController } = {
    connected: false,
  }
  const listeners = new Set<() => void>()
  const auth = new Set<() => void>()
  const location = { directory: input.directory }

  const api = async () => {
    const server = await input.server.get()
    if (state.client?.url === server.url) return state.client.api
    const client = OpenCode.make({ baseUrl: server.url, headers: { authorization: server.authorization }, fetch: local })
    state.client = { url: server.url, api: client }
    return client
  }
  const rpc = async () => (await api()).rpc(KiloGatewayRpc.Definition)

  const watch = async (signal: AbortSignal) => {
    const client = await api()
    for await (const event of client.event.subscribe({ signal })) {
      if (AUTH_EVENTS.includes(event.type)) auth.forEach((listener) => listener())
    }
  }

  return {
    connected: () => state.connected,
    onStateChange(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    onAuthChange(listener: () => void) {
      auth.add(listener)
      return () => void auth.delete(listener)
    },
    async fim(request: FimInput, signal?: AbortSignal) {
      const client = await rpc()
      return client["autocomplete.fim"](request, { location, signal }).catch((error: unknown) => {
        throw failure(error, signal)
      })
    },
    async balance() {
      const client = await rpc().catch(() => undefined)
      const result = await client?.balance({}, { location }).catch(() => undefined)
      return result?.balance ?? undefined
    },
    /** Starts the server, as the first autocomplete request would. */
    start: () => void input.server.get().catch(() => undefined),
    started() {
      state.connected = true
      state.events?.abort()
      const events = new AbortController()
      state.events = events
      void watch(events.signal).catch(() => undefined)
      listeners.forEach((listener) => listener())
    },
    stopped() {
      state.connected = false
      state.client = undefined
      state.events?.abort()
      state.events = undefined
      listeners.forEach((listener) => listener())
    },
    dispose() {
      state.events?.abort()
      listeners.clear()
      auth.clear()
    },
  } satisfies AutocompleteConnection & Record<string, unknown>
}

export type Connection = ReturnType<typeof createConnection>

const AUTH_EVENTS: string[] = ["credential.updated", "credential.switched", `rpc.${KiloGatewayRpc.Definition.id}.organization`]

/** An RPC failure as an error the backoff can classify: `request` carries the status, `unauthorized` is a 401. */
function failure(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return error
  if (typeof error !== "object" || error === null || !("type" in error) || !("message" in error)) return error
  const data = "data" in error ? error.data : undefined
  const status =
    error.type === "request" && typeof data === "object" && data !== null && "status" in data && typeof data.status === "number"
      ? data.status
      : error.type === "unauthorized"
        ? 401
        : null
  const detail = String(error.message)
  // A provider failure already reads `FIM request failed: <status> <body>`; keep it as it is.
  if (detail.startsWith("FIM request failed")) return new AutocompleteRequestError(detail, status)
  return new AutocompleteRequestError(
    status === null ? `FIM request failed: ${detail}` : `FIM request failed: ${status} ${detail}`,
    status,
  )
}
