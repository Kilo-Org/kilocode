import { createKiloClient, type Event, type KiloClient } from "@kilocode/sdk/v2"
import z from "zod"
import { setTimeout } from "node:timers/promises"
import { promisify } from "node:util"

const connections = new WeakMap<KiloClient, NonNullable<Parameters<typeof createKiloClient>[0]>>()
const capability = z.object({
  paths: z.object({
    "/kilocode/session/{sessionID}/drain": z.object({
      post: z.object({ operationId: z.literal("kilocode.drainSession") }),
    }),
  }),
})

export namespace KiloRunDrain {
  export function client(config: NonNullable<Parameters<typeof createKiloClient>[0]>) {
    const sdk = createKiloClient(config)
    connections.set(sdk, config)
    return sdk
  }

  export function scope(sdk: KiloClient, directory: string, signal?: AbortSignal) {
    const config = connections.get(sdk)
    if (!config) throw new Error("Missing headless server transport")
    return client({ ...config, directory, signal: signal ?? config.signal })
  }

  export async function check(sdk: KiloClient, signal: AbortSignal) {
    const config = connections.get(sdk)
    if (!config?.baseUrl) throw new Error("Missing headless server transport")
    const headers = new Headers()
    if (config.headers instanceof Headers) config.headers.forEach((value, name) => headers.set(name, value))
    else if (Array.isArray(config.headers)) for (const [name, value] of config.headers) headers.set(name, value)
    else
      for (const [name, value] of Object.entries(config.headers ?? {})) {
        if (typeof value === "string") headers.set(name, value)
        else if (value != null) throw new Error("Unsupported server header value")
      }
    const request = new Request(`${config.baseUrl.replace(/\/$/, "")}/doc`, { headers, signal })
    const response = await (config.fetch ?? globalThis.fetch)(request)
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Server rejected access (HTTP ${response.status}); check server authentication and permissions`)
    }
    if (!response.ok && response.status !== 404) {
      throw new Error(`Server capability check failed (HTTP ${response.status})`)
    }
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new Error("Server does not support session draining; upgrade or restart the server")
    }
    const body: unknown = await response.json().catch(() => {
      throw new Error("Server returned invalid capability JSON")
    })
    if (!capability.safeParse(body).success) {
      throw new Error("Server does not support session draining; upgrade or restart the server")
    }
  }

  export function create(sessionID: string) {
    const token = crypto.randomUUID()
    const abort = new AbortController()
    const connected = Promise.withResolvers<void>()
    const acknowledged = Promise.withResolvers<void>()
    const failure = Promise.withResolvers<Error>()
    let closing = false
    let drained = false
    const race = <A extends Promise<unknown>>(work: A) =>
      Promise.race([
        work,
        failure.promise.then((error): never => {
          throw error
        }),
      ])
    return {
      token,
      signal: abort.signal,
      race,
      ready: () => race(connected.promise),
      pause: (ms: number) => setTimeout(ms, undefined, { signal: abort.signal }),
      event(event: Event) {
        if (event.type === "server.connected") connected.resolve()
        if (
          (event.type === "session.drain.interrupted" ||
            (event.type === "session.turn.close" && event.properties.reason === "interrupted")) &&
          event.properties.sessionID === sessionID
        ) {
          failure.resolve(new Error("Session interrupted before completion"))
        }
        if (
          event.type !== "session.drained" ||
          event.properties.sessionID !== sessionID ||
          event.properties.token !== token
        )
          return false
        drained = true
        acknowledged.resolve()
        return true
      },
      end(error?: unknown) {
        if (closing || (drained && !error)) return
        failure.resolve(error instanceof Error ? error : new Error("Session event stream ended before completion"))
      },
      async wait(sdk: KiloClient, directory?: string) {
        const result = await race(sdk.kilocode.drainSession({ sessionID, directory, token }, { signal: abort.signal }))
        if (result.error || result.data !== true) throw new Error("Server did not acknowledge session completion")
        await race(acknowledged.promise)
      },
      close() {
        closing = true
        abort.abort()
      },
    }
  }

  export async function flush(
    streams: readonly { write(chunk: string, callback: (error?: Error | null) => void): unknown }[] = [
      process.stdout,
      process.stderr,
    ],
  ) {
    await Promise.all(
      streams.map((stream) =>
        promisify(stream.write.bind(stream))("").catch((error: unknown) => {
          if (
            error instanceof Error &&
            "code" in error &&
            (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED")
          )
            return
          throw error
        }),
      ),
    )
  }
}
