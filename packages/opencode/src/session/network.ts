// kilocode_change - new file
import { Context, Effect, Layer, Schema, Types } from "effect"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { QuestionID } from "../question/schema"
import { SessionID } from "../session/schema"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import * as Log from "@opencode-ai/core/util/log"
import { fn } from "../util/fn"
import { MCP } from "../mcp"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import z from "zod"

export namespace SessionNetwork {
  const log = Log.create({ service: "session.network" })
  const codes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ENETDOWN",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
    "ERR_SOCKET_CONNECTION_TIMEOUT",
  ])
  const urls = ["https://kilo.ai", "https://example.com", "https://cloudflare.com/cdn-cgi/trace"]
  const POLL_MS = 3_000
  const PROBE_MS = 5_000
  const RESUME_MS = 10_000

  function chain(err: unknown, seen = new Set<unknown>()): unknown[] {
    if (err === undefined) return []
    if (typeof err === "object" && err !== null) {
      if (seen.has(err)) return []
      seen.add(err)
    }
    const cause = typeof err === "object" && err !== null ? (err as { cause?: unknown }).cause : undefined
    const kids =
      typeof err === "object" && err !== null && Array.isArray((err as { errors?: unknown }).errors)
        ? ((err as { errors: unknown[] }).errors ?? [])
        : []
    return [err, ...chain(cause, seen), ...kids.flatMap((item) => chain(item, seen))]
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

  export const Wait = Schema.Struct({
    id: QuestionID,
    sessionID: SessionID,
    message: Schema.String,
    restored: Schema.Boolean,
    time: Schema.Struct({
      created: Schema.Finite,
      restored: Schema.optional(Schema.Finite),
    }),
  })
    .annotate({ identifier: "SessionNetworkWait" })
    .pipe(withStatics((s) => ({ zod: zod(s) })))
  export type Wait = Schema.Schema.Type<typeof Wait>

  export const Event = {
    Asked: BusEvent.define("session.network.asked", Wait),
    Replied: BusEvent.define(
      "session.network.replied",
      Schema.Struct({
        sessionID: SessionID,
        requestID: QuestionID,
      }),
    ),
    Rejected: BusEvent.define(
      "session.network.rejected",
      Schema.Struct({
        sessionID: SessionID,
        requestID: QuestionID,
      }),
    ),
    Restored: BusEvent.define(
      "session.network.restored",
      Schema.Struct({
        sessionID: SessionID,
        requestID: QuestionID,
        time: Schema.Finite,
      }),
    ),
  }

  interface StateShape {
    pending: Map<
      QuestionID,
      {
        info: Types.Mutable<Wait>
        abort: AbortSignal
        resolve: () => void
        reject: (e: unknown) => void
      }
    >
  }

  class StateService extends Context.Service<StateService, { readonly get: () => Effect.Effect<StateShape> }>()(
    "@kilocode/SessionNetwork.State",
  ) {}

  const stateLayer = Layer.effect(
    StateService,
    Effect.gen(function* () {
      const is = yield* InstanceState.make(
        Effect.fn("SessionNetwork.state")(function* () {
          return { pending: new Map() } as StateShape
        }),
      )
      return StateService.of({
        get: () => InstanceState.get(is),
      })
    }),
  )

  const stateRuntime = makeRuntime(StateService, stateLayer)
  const state = (): Promise<StateShape> => stateRuntime.runPromise((svc) => svc.get())

  export function code(err: unknown) {
    for (const item of chain(err)) {
      const code = (item as { code?: unknown })?.code
      if (typeof code === "string") return code
    }
  }

  export function disconnected(err: unknown) {
    for (const item of chain(err)) {
      const match = (item as { code?: unknown })?.code
      if (typeof match === "string" && codes.has(match)) return true
    }
    // kilocode_change - recognize AbortSignal.timeout() errors
    for (const item of chain(err)) {
      if (item instanceof DOMException && item.name === "TimeoutError") return true
    }
    return msgs(err).some((item) => {
      const msg = item.toLowerCase()
      if (msg.includes("load failed")) return true
      if (msg.includes("failed to fetch")) return true
      if (msg.includes("fetch failed")) return true
      if (msg.includes("network connection was lost")) return true
      if (msg.includes("network is unreachable")) return true
      if (msg.includes("socket connection")) return true
      if (msg.includes("socket hang up")) return true
      if (msg.includes("connection timed out")) return true
      if (msg.includes("connection terminated")) return true
      if (msg.includes("connect timeout")) return true
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
    if (match === "EHOSTUNREACH") return "Host is unreachable"
    if (match === "ENETDOWN") return "Network is down"
    if (match === "UND_ERR_CONNECT_TIMEOUT") return "Connection timed out"
    if (match === "UND_ERR_HEADERS_TIMEOUT") return "Request timed out"
    if (match === "UND_ERR_SOCKET") return "Network socket failed"
    if (match === "ERR_SOCKET_CONNECTION_TIMEOUT") return "Connection timed out"
    const matchMsg = msgs(err).find((item) => {
      const msg = item.toLowerCase()
      return msg.includes("unable to connect") && msg.includes("access the url")
    })
    if (matchMsg) return matchMsg
    if (msgs(err).some((item) => item.toLowerCase().includes("failed to fetch"))) return "Network request failed"
    if (msgs(err).some((item) => item.toLowerCase().includes("fetch failed"))) return "Network request failed"
    return "Network connection failed"
  }

  async function check(url: string) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), PROBE_MS)
    return fetch(url, {
      method: "HEAD",
      signal: ctl.signal,
    })
      .then((res) => res.status < 500)
      .catch(() => false)
      .finally(() => clearTimeout(timer))
  }

  async function probe() {
    return Promise.any(
      urls.map(async (url) => {
        if (await check(url)) return true
        throw new Error("network probe failed")
      }),
    ).catch(() => false)
  }

  async function delay(abort: AbortSignal) {
    if (abort.aborted) return false
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        abort.removeEventListener("abort", onAbort)
        resolve(true)
      }, RESUME_MS)
      function onAbort() {
        clearTimeout(timer)
        resolve(false)
      }
      abort.addEventListener("abort", onAbort, { once: true })
    })
  }

  async function resume(input: { requestID: QuestionID; abort: AbortSignal }) {
    if (!(await delay(input.abort))) return
    const s = await state()
    const req = s.pending.get(input.requestID)
    if (!req || !req.info.restored) return
    await reply({ requestID: input.requestID })
  }

  async function watch(input: { requestID: QuestionID; abort: AbortSignal }) {
    while (!input.abort.aborted) {
      await Bun.sleep(POLL_MS)
      if (input.abort.aborted) return
      const s = await state()
      const req = s.pending.get(input.requestID)
      if (!req || req.info.restored) return
      const ok = await probe().catch(() => false)
      if (!ok) continue
      await restore({ requestID: input.requestID })
      return
    }
  }

  export async function ask(input: { sessionID: SessionID; message: string; abort: AbortSignal }) {
    const s = await state()
    const id = QuestionID.ascending()
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
        if (!s.pending.has(id)) return
        input.abort.removeEventListener("abort", onAbort)
        s.pending.delete(id)
        Bus.publish(Event.Rejected, {
          sessionID: input.sessionID,
          requestID: id,
        })
        reject(new DOMException("Aborted", "AbortError"))
      }
      s.pending.set(id, {
        info,
        abort: input.abort,
        resolve: () => {
          input.abort.removeEventListener("abort", onAbort)
          resolve()
        },
        reject: (err) => {
          input.abort.removeEventListener("abort", onAbort)
          reject(err)
        },
      })
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
      requestID: QuestionID.zod,
    }),
    async (input) => {
      const s = await state()
      const requestID = input.requestID as QuestionID
      const req = s.pending.get(requestID)
      if (!req || req.info.restored) return
      const time = Date.now()
      req.info.restored = true
      req.info.time = { ...req.info.time, restored: time }
      log.info("network restored", { sessionID: req.info.sessionID, requestID })
      Bus.publish(Event.Restored, {
        sessionID: req.info.sessionID,
        requestID: req.info.id,
        time,
      })
      void resume({ requestID, abort: req.abort }).catch((err) => {
        log.error("auto resume failed", { err, requestID })
      })
    },
  )

  export const reply = fn(
    z.object({
      requestID: QuestionID.zod,
    }),
    async (input) => {
      const s = await state()
      const requestID = input.requestID as QuestionID
      const req = s.pending.get(requestID)
      if (!req) {
        log.warn("reply for unknown request", { requestID })
        return
      }
      s.pending.delete(requestID)
      // kilocode_change start — reconnect failed remote MCP servers after network recovery
      void MCP.status()
        .then((statuses) => {
          for (const [name, s] of Object.entries(statuses)) {
            if (s.status === "failed") {
              MCP.connect(name).catch((err) => {
                log.error("remote reconnect failed", { name, err })
              })
            }
          }
        })
        .catch((err) => {
          log.error("failed to get MCP status for reconnect", { err })
        })
      // kilocode_change end
      Bus.publish(Event.Replied, {
        sessionID: req.info.sessionID,
        requestID: req.info.id,
      })
      req.resolve()
    },
  )

  export const reject = fn(
    z.object({
      requestID: QuestionID.zod,
    }),
    async (input) => {
      const s = await state()
      const requestID = input.requestID as QuestionID
      const req = s.pending.get(requestID)
      if (!req) {
        log.warn("reject for unknown request", { requestID })
        return
      }
      s.pending.delete(requestID)
      Bus.publish(Event.Rejected, {
        sessionID: req.info.sessionID,
        requestID: req.info.id,
      })
      req.reject(new RejectedError())
    },
  )

  export async function list() {
    return state().then((s) => Array.from(s.pending.values()).map((item) => item.info))
  }

  export class RejectedError extends Error {
    constructor() {
      super("Network reconnect was rejected")
    }
  }
}
