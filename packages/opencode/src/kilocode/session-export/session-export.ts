import { Capture, type CaptureDeps } from "./capture"
import { Config } from "./config"
import { setKillSwitch } from "./eligibility"
import { createSequencer } from "./sequence"
import { SyncSubscriber } from "./sync-subscriber"

declare global {
  const KILO_SESSION_EXPORT_WORKER_PATH: string
}

type WorkerTarget = string | URL

let worker: Worker | undefined
let capture: Capture | undefined
let subscriber: SyncSubscriber | undefined
let unsubscribe: (() => void) | undefined
let attempts = 0
let sequencer: ReturnType<typeof createSequencer> | undefined
let options:
  | {
      agentVersion: string
      dbPath: string
      endpoint?: string
      surface: string
      anonId?: string
      snapshotProvider?: CaptureDeps["snapshotProvider"]
      syncSeq: (sessionId: string) => number
      subscribeAll: (cb: (event: unknown) => void) => () => void
      createWorker: (url: WorkerTarget) => Worker
    }
  | undefined

const maxRespawns = 3

export const init = (opts: {
  agentVersion: string
  dbPath: string
  endpoint?: string
  surface?: string
  anonId?: string
  snapshotProvider?: CaptureDeps["snapshotProvider"]
  syncSeq?: (sessionId: string) => number
  subscribeAll: (cb: (event: unknown) => void) => () => void
  createWorker?: (url: WorkerTarget) => Worker
}): void => {
  if (worker) return
  const url = target()
  try {
    sequencer = opts.syncSeq ? undefined : createSequencer(opts.dbPath)
    const syncSeq = opts.syncSeq ?? ((sessionId: string) => sequencer!.next(sessionId))
    options = {
      agentVersion: opts.agentVersion,
      dbPath: opts.dbPath,
      endpoint: opts.endpoint,
      surface: opts.surface ?? currentSurface(),
      anonId: opts.anonId,
      snapshotProvider: opts.snapshotProvider,
      syncSeq,
      subscribeAll: opts.subscribeAll,
      createWorker: opts.createWorker ?? ((file) => new Worker(file)),
    }
    spawn(url)
    unsubscribe = opts.subscribeAll((event) => subscriber?.onSyncEvent(event as never))
  } catch (err) {
    const current = worker as unknown as Worker | undefined
    if (current) current.terminate()
    worker = undefined
    capture = undefined
    subscriber = undefined
    unsubscribe = undefined
    options = undefined
    sequencer?.close()
    sequencer = undefined
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
  options = undefined
  sequencer?.close()
  sequencer = undefined
  attempts = 0
}

function target(): WorkerTarget {
  if (typeof KILO_SESSION_EXPORT_WORKER_PATH !== "undefined") return KILO_SESSION_EXPORT_WORKER_PATH
  return new URL("./worker.ts", import.meta.url)
}

function spawn(url = target()): void {
  if (!options) return
  worker = options.createWorker(url)
  worker.postMessage({
    kind: "init",
    dbPath: options.dbPath,
    agentVersion: options.agentVersion,
    endpoint: options.endpoint,
    surface: options.surface,
    anonId: options.anonId,
  })
  capture = new Capture({
    worker,
    agentVersion: options.agentVersion,
    nowMs: () => Date.now(),
    syncSeq: options.syncSeq,
    onPostError: respawn,
    snapshotProvider: options.snapshotProvider,
  })
  subscriber = new SyncSubscriber({
    isEligibleSession: (sessionId) => capture?.hasEligibleSession(sessionId) ?? false,
    dispatch: (event) => capture?.dispatchRaw(event),
    agentVersion: options.agentVersion,
    now: () => Date.now(),
    syncSeq: options.syncSeq,
    getTurnId: (sessionId) => capture?.turnId(sessionId),
    getRootSessionId: (sessionId) => capture?.rootSessionId(sessionId),
  })
  worker.onmessage = (event: MessageEvent) => {
    const msg = event.data as { kind?: string; sessionId?: string; reason?: string; name?: string }
    if (msg.kind === "pressure" && msg.sessionId) capture?.markDegraded(msg.sessionId)
    if (msg.kind === "kill_switch") setKillSwitch(true, msg.reason ?? "worker")
  }
  worker.onerror = (event: ErrorEvent) => {
    console.warn("[session-export] worker error", event.message)
    respawn(event.error ?? event.message)
  }
}

function currentSurface(): string {
  return process.env.KILOCODE_FEATURE?.trim() || "unknown"
}

function respawn(err: unknown): void {
  console.warn("[session-export] worker respawn", err)
  worker?.terminate()
  worker = undefined
  capture = undefined
  subscriber = undefined
  attempts++
  if (attempts > maxRespawns) {
    setKillSwitch(true, "worker_respawn_failed")
    return
  }
  spawn()
}
