import { Capture } from "./capture"
import { Config } from "./config"
import { setKillSwitch } from "./eligibility"
import { SyncSubscriber } from "./sync-subscriber"

let worker: Worker | undefined
let capture: Capture | undefined
let subscriber: SyncSubscriber | undefined
let unsubscribe: (() => void) | undefined
let seq = 0

export const init = (opts: {
  agentVersion: string
  dbPath: string
  syncSeq?: () => number
  subscribeAll: (cb: (event: unknown) => void) => () => void
}): void => {
  if (worker) return
  const url = new URL("./worker.ts", import.meta.url)
  try {
    worker = new Worker(url)
    worker.postMessage({ kind: "init", dbPath: opts.dbPath, agentVersion: opts.agentVersion })

    const syncSeq = opts.syncSeq ?? (() => seq++)
    capture = new Capture({
      worker,
      agentVersion: opts.agentVersion,
      nowMs: () => Date.now(),
      syncSeq,
    })
    subscriber = new SyncSubscriber({
      isEligibleSession: (sessionId) => capture?.hasEligibleSession(sessionId) ?? false,
      dispatch: (event) => capture?.dispatchRaw(event),
      agentVersion: opts.agentVersion,
      now: () => Date.now(),
      syncSeq,
    })
    unsubscribe = opts.subscribeAll((event) => subscriber?.onSyncEvent(event as never))

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as { kind?: string; sessionId?: string; reason?: string; name?: string }
      if (msg.kind === "pressure" && msg.sessionId) capture?.markDegraded(msg.sessionId)
      if (msg.kind === "kill_switch") setKillSwitch(true, msg.reason ?? "worker")
    }
    worker.onerror = (event: ErrorEvent) => {
      console.warn("[session-export] worker error", event.message)
    }
  } catch (err) {
    worker?.terminate()
    worker = undefined
    capture = undefined
    subscriber = undefined
    unsubscribe = undefined
    throw err
  }
}

export const beforeRequest = (...args: Parameters<Capture["beforeRequest"]>): void => {
  capture?.beforeRequest(...args)
}

export const afterRequest = (...args: Parameters<Capture["afterRequest"]>): void => {
  capture?.afterRequest(...args)
}

export const compaction = (args: Parameters<Capture["compaction"]>[0]): void => {
  capture?.compaction(args)
}

export const onSessionClose = async (sessionId: string): Promise<void> => {
  await capture?.onSessionClose(sessionId)
}

export const shutdown = async (): Promise<void> => {
  if (!worker) return
  unsubscribe?.()
  worker.postMessage({ kind: "shutdown", timeoutMs: Config.shutdownFlushTimeoutMs })
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Config.shutdownFlushTimeoutMs + 500)
    const current = worker!
    current.onmessage = (event: MessageEvent) => {
      if ((event.data as { kind?: string }).kind === "shutdown_done") {
        clearTimeout(timer)
        resolve()
      }
    }
  })
  worker.terminate()
  worker = undefined
  capture = undefined
  subscriber = undefined
  unsubscribe = undefined
}
