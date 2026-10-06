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
 * `arm` closes the race by queueing early messages; `listen` replays them and reports handler
 * failures as `rpc.error`; `client` rejects on those failures and bounds only the pre-handshake
 * window, so legitimately long calls (a proxied LLM request) are never cut short.
 */

import * as Log from "@opencode-ai/core/util/log"

type Definition = {
  [method: string]: (input: any) => any
}

/**
 * Only bounds calls issued before the worker's first reply, never in-flight work after it.
 * Overridable so the release PTY smoke can fail faster than its own silence watchdog.
 */
const HANDSHAKE_TIMEOUT = Number(process.env["KILO_RPC_HANDSHAKE_TIMEOUT"] ?? 30_000)

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
}

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
}) {
  type Entry = { resolve: (result: any) => void; reject: (err: unknown) => void; timer?: Timer }
  const pending = new Map<number, Entry>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  const live = { id: 0, handshake: false }

  const settle = (id: number) => {
    const entry = pending.get(id)
    if (!entry) return undefined
    if (entry.timer) clearTimeout(entry.timer)
    pending.delete(id)
    return entry
  }

  target.onmessage = (evt) => {
    const parsed = JSON.parse(evt.data)
    // Any message proves the channel is live, so stop bounding the calls already in flight.
    if (!live.handshake) {
      live.handshake = true
      for (const entry of pending.values()) if (entry.timer) clearTimeout(entry.timer)
    }
    if (parsed.type === "rpc.result") settle(parsed.id)?.resolve(parsed.result)
    if (parsed.type === "rpc.error") settle(parsed.id)?.reject(new Error(`worker rpc failed: ${parsed.error}`))
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event)
      if (!handlers) return
      for (const handler of handlers) handler(parsed.data)
    }
  }

  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
      const id = live.id++
      return new Promise((resolve, reject) => {
        const timer = live.handshake
          ? undefined
          : setTimeout(() => {
              pending.delete(id)
              const message = `worker rpc ${String(method)} got no reply within ${HANDSHAKE_TIMEOUT}ms: the worker never answered`
              log.error(message, { method: String(method), id })
              reject(new Error(message))
            }, HANDSHAKE_TIMEOUT)
        pending.set(id, { resolve, reject, timer })
        target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id }))
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
