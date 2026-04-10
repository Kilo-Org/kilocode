// kilocode_change - new file
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { fn } from "../util/fn"
import { MCP } from "../mcp"
import z from "zod"

export namespace SessionNetwork {
  const log = Log.create({ service: "session.network" })
  const codes = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ENETUNREACH"])
  const POLL_MS = 3_000

  function chain(err: unknown, seen = new Set<unknown>()): unknown[] {
    if (err === undefined) return []
    if (typeof err === "object" && err !== null) {
      if (seen.has(err)) return []
      seen.add(err)
    }
    const cause = typeof err === "object" && err !== null ? (err as { cause?: unknown }).cause : undefined
    return [err, ...chain(cause, seen)]
  }

  function msgs(err: unknown) {
    return chain(err).flatMap((item) => {
      const msg =
        item instanceof Error
          ? item.message
          : typeof item === "string"
            ? item
            : typeof item === "object" && item !== null && typeof (item as { message?: unknown }).message === "string"
              ? (item as { message: string }).message
              : undefined
      return msg ? [msg] : []
    })
  }

  export const Wait = z
    .object({
      id: Identifier.schema("question"),
      sessionID: Identifier.schema("session"),
      message: z.string(),
      restored: z.boolean(),
      time: z.object({
        created: z.number(),
      }),
    })
    .meta({
      ref: "SessionNetworkWait",
    })
  export type Wait = z.infer<typeof Wait>

  export const Event = {
    Asked: BusEvent.define("session.network.asked", Wait),
    Replied: BusEvent.define(
      "session.network.replied",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
      }),
    ),
    Rejected: BusEvent.define(
      "session.network.rejected",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
      }),
    ),
    Restored: BusEvent.define(
      "session.network.restored",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
      }),
    ),
  }

  const state = Instance.state(async () => {
    const pending: Record<
      string,
      {
        info: Wait
        resolve: () => void
        reject: (e: unknown) => void
      }
    > = {}
    return { pending }
  })

  export function code(err: unknown) {
    for (const item of chain(err)) {
      const code = (item as { code?: unknown })?.code
      if (typeof code === "string") return code
    }
  }

  export function disconnected(err: unknown) {
    const match = code(err)
    if (match && codes.has(match)) return true
    // kilocode_change - recognize AbortSignal.timeout() errors
    for (const item of chain(err)) {
      if (item instanceof DOMException && item.name === "TimeoutError") return true
    }
    return msgs(err).some((item) => {
      const msg = item.toLowerCase()
      if (msg.includes("fetch failed")) return true
      if (msg.includes("network is unreachable")) return true
      if (msg.includes("socket connection")) return true
      if (msg.includes("unable to connect") && msg.includes("access the url")) return true
      return false
    })
  }

  export function message(err: unknown) {
    // kilocode_change - check for timeout first
    for (const item of chain(err)) {
      if (item instanceof DOMException && item.name === "TimeoutError") return "Request timed out"
    }
    const match = code(err)
    if (match === "ECONNRESET") return "Connection reset by server"
    if (match === "ECONNREFUSED") return "Connection refused"
    if (match === "ENOTFOUND") return "Host not found"
    if (match === "EAI_AGAIN") return "DNS lookup failed"
    if (match === "ETIMEDOUT") return "Connection timed out"
    if (match === "ENETUNREACH") return "Network is unreachable"
    const matchMsg = msgs(err).find((item) => {
      const msg = item.toLowerCase()
      return msg.includes("unable to connect") && msg.includes("access the url")
    })
    if (matchMsg) return matchMsg
    if (msgs(err).some((item) => item.toLowerCase().includes("fetch failed"))) return "Network request failed"
    return "Network connection failed"
  }

  async function probe() {
    const info = await Bun.dns.lookup("dns.google")
    return info.length > 0
  }

  async function watch(input: { requestID: string; abort: AbortSignal }) {
    while (!input.abort.aborted) {
      await Bun.sleep(POLL_MS)
      if (input.abort.aborted) return
      const s = await state()
      const req = s.pending[input.requestID]
      if (!req || req.info.restored) return
      const ok = await probe().catch(() => false)
      if (!ok) continue
      await restore({ requestID: input.requestID })
      return
    }
  }

  export async function ask(input: { sessionID: string; message: string; abort: AbortSignal }) {
    const s = await state()
    const id = Identifier.ascending("question")
    const info: Wait = {
      id,
      sessionID: input.sessionID,
      message: input.message,
      restored: false,
      time: {
        created: Date.now(),
      },
    }

    const promise = new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        if (!s.pending[id]) return
        input.abort.removeEventListener("abort", onAbort)
        delete s.pending[id]
        Bus.publish(Event.Rejected, {
          sessionID: input.sessionID,
          requestID: id,
        })
        reject(new DOMException("Aborted", "AbortError"))
      }
      s.pending[id] = {
        info,
        resolve: () => {
          input.abort.removeEventListener("abort", onAbort)
          resolve()
        },
        reject: (err) => {
          input.abort.removeEventListener("abort", onAbort)
          reject(err)
        },
      }
      input.abort.addEventListener("abort", onAbort, { once: true })
      if (input.abort.aborted) {
        onAbort()
        return
      }
      log.warn("waiting for network", { sessionID: input.sessionID, requestID: id, message: input.message })
      Bus.publish(Event.Asked, info)
      void watch({ requestID: id, abort: input.abort }).catch((err) => {
        log.error("restore watch failed", { err, requestID: id })
      })
    })
    return { id, promise }
  }

  export const restore = fn(
    z.object({
      requestID: z.string(),
    }),
    async (input) => {
      const s = await state()
      const req = s.pending[input.requestID]
      if (!req || req.info.restored) return
      req.info.restored = true
      log.info("network restored", { sessionID: req.info.sessionID, requestID: input.requestID })
      Bus.publish(Event.Restored, {
        sessionID: req.info.sessionID,
        requestID: req.info.id,
      })
    },
  )

  export const reply = fn(
    z.object({
      requestID: z.string(),
    }),
    async (input) => {
      const s = await state()
      const req = s.pending[input.requestID]
      if (!req) {
        log.warn("reply for unknown request", { requestID: input.requestID })
        return
      }
      delete s.pending[input.requestID]
      void MCP.reconnectRemote().catch((err) => {
        log.error("remote reconnect failed", { err })
      })
      Bus.publish(Event.Replied, {
        sessionID: req.info.sessionID,
        requestID: req.info.id,
      })
      req.resolve()
    },
  )

  export const reject = fn(
    z.object({
      requestID: z.string(),
    }),
    async (input) => {
      const s = await state()
      const req = s.pending[input.requestID]
      if (!req) {
        log.warn("reject for unknown request", { requestID: input.requestID })
        return
      }
      delete s.pending[input.requestID]
      Bus.publish(Event.Rejected, {
        sessionID: req.info.sessionID,
        requestID: req.info.id,
      })
      req.reject(new RejectedError())
    },
  )

  export async function list() {
    return state().then((s) => Object.values(s.pending).map((item) => item.info))
  }

  export class RejectedError extends Error {
    constructor() {
      super("Network reconnect was rejected")
    }
  }
}
