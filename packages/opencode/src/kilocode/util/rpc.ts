/**
 * Hardening for the TUI worker RPC transport.
 *
 * Upstream's transport has two gaps that combine into a permanently blank TUI:
 *
 * 1. `listen` is the last statement in `cli/tui/worker.ts`, so `onmessage` is only assigned
 *    after the worker's top-level `await` and the evaluation of Server/InstanceRuntime/etc.
 *    Any request the parent posts in that window is dropped. Observed gap: ~2s.
 * 2. `call` resolved from `new Promise((resolve) => ...)` with no reject path and no timeout,
 *    and the worker replied only on success. A dropped message or a throwing handler stranded
 *    the caller forever.
 *
 * With no `--port` the TUI proxies every HTTP call through the worker, so one lost message
 * left it painted but dataless: a single blank frame, process alive, no error. That is the
 * release PTY smoke failure seen on darwin-x64/linux-x64/windows-x64 (runs 37371543591,
 * 37476092331, 37493845893), where the worker logged `worker booted` / `worker listening`
 * yet `creating instance` never followed.
 *
 * The fix is parent-side gating: `listen` announces `rpc.ready`, and `client` holds every
 * request until it arrives, so nothing is posted into the window at all. `arm` is a second
 * line of defence for anything that still lands early, `listen` answers handler failures as
 * `rpc.error`, and the only bound is "the worker never became ready" -- once it is ready calls
 * run unbounded, so a long proxied request is never cut short.
 *
 * Arming inside the worker is not sufficient on its own: static imports evaluate before the
 * module body, so `arm` cannot run until Server/InstanceRuntime/etc have loaded, which is
 * where most of the 2s window is spent.
 */

import * as Log from "@opencode-ai/core/util/log"

type Definition = {
  [method: string]: (input: any) => any
}

/**
 * How long to wait for the worker to announce itself. Overridable so the release PTY smoke can
 * fail faster than its own silence watchdog. Read per client so a caller can set it at startup.
 */
function timeout() {
  return Number(process.env["KILO_RPC_HANDSHAKE_TIMEOUT"] ?? 30_000)
}

const log = Log.create({ service: "worker-rpc" })

const early: string[] = []
const armed = { queueing: false }

/**
 * Queue worker messages until `listen` installs the real handler. Call this as early as
 * possible in the worker — before any `await` — so nothing posted during startup is lost.
 * Always paired with a later `listen`, which drains whatever arrived in between.
 */
export function arm() {
  if (armed.queueing) return
  armed.queueing = true
  onmessage = (evt) => {
    early.push(evt.data)
  }
}

export function listen(rpc: Definition) {
  const handle = async (data: string) => {
    const parsed = JSON.parse(data)
    // Covers the reverse order: a parent that attached after this worker already announced
    // itself missed that announcement, so answer its probe with a fresh one.
    if (parsed.type === "rpc.hello") {
      postMessage(JSON.stringify({ type: "rpc.ready" }))
      return
    }
    if (parsed.type !== "rpc.request") return
    // Records that the request actually crossed the channel, which separates a lost
    // request from a lost reply when the parent reports a timeout.
    log.info("rpc request", { method: parsed.method, id: parsed.id })
    const method = rpc[parsed.method]
    if (!method) {
      postMessage(JSON.stringify({ type: "rpc.error", id: parsed.id, error: `unknown method ${parsed.method}` }))
      return
    }
    try {
      const result = await method(parsed.input)
      postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
    } catch (err) {
      // Never leave the caller waiting: a silent throw used to hang the TUI forever.
      postMessage(
        JSON.stringify({
          type: "rpc.error",
          id: parsed.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  armed.queueing = false
  onmessage = (evt) => void handle(evt.data)
  for (const data of early.splice(0)) void handle(data)
  // Tell the parent it is safe to post. Queueing on the parent is what actually closes the
  // race: `arm` can only run once this module's imports have evaluated, which in a compiled
  // binary is seconds after the parent gets its Worker handle.
  postMessage(JSON.stringify({ type: "rpc.ready" }))
}

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
}) {
  type Entry = { resolve: (result: any) => void; reject: (err: unknown) => void }
  const pending = new Map<number, Entry>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  const outbox: string[] = []
  const live = { id: 0, ready: false, timer: undefined as Timer | undefined }

  const settle = (id: number) => {
    const entry = pending.get(id)
    if (!entry) return undefined
    pending.delete(id)
    return entry
  }

  // Bounds only "the worker never came up". Once it is ready, calls run unbounded so a long
  // proxied request is never cut short. Deliberately not keyed off arbitrary inbound traffic:
  // the worker emits global events before it can serve requests, and treating those as proof
  // of readiness is what previously disarmed this guard.
  const limit = timeout()
  live.timer = setTimeout(() => {
    const message = `worker rpc never became ready within ${limit}ms`
    log.error(message, { queued: outbox.length, pending: pending.size })
    live.timer = undefined
    outbox.length = 0
    const waiting = [...pending.values()]
    pending.clear()
    for (const entry of waiting) entry.reject(new Error(message))
  }, limit)
  live.timer?.unref?.()

  target.onmessage = (evt) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type === "rpc.ready") {
      if (live.timer) clearTimeout(live.timer)
      live.timer = undefined
      live.ready = true
      for (const data of outbox.splice(0)) target.postMessage(data)
      return
    }
    if (parsed.type === "rpc.result") settle(parsed.id)?.resolve(parsed.result)
    if (parsed.type === "rpc.error") settle(parsed.id)?.reject(new Error(`worker rpc failed: ${parsed.error}`))
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event)
      if (!handlers) return
      for (const handler of handlers) handler(parsed.data)
    }
  }

  // Probe in case the worker announced itself before this handler existed. `arm` buffers it
  // during startup, so `listen` replays it and answers even when it lands early.
  target.postMessage(JSON.stringify({ type: "rpc.hello" }))

  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
      const id = live.id++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        const data = JSON.stringify({ type: "rpc.request", method, input, id })
        if (live.ready) return target.postMessage(data)
        outbox.push(data)
      })
    },
    on<Data>(event: string, handler: (data: Data) => void) {
      const handlers = listeners.get(event) ?? new Set()
      listeners.set(event, handlers)
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
  }
}

export * as KiloRpc from "./rpc"
