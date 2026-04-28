import z from "zod"
import { Schema } from "effect"
import path from "path"
import {
  CodeIndexManager,
  type IndexingTelemetryEvent,
  type VectorStoreSearchResult,
} from "@kilocode/kilo-indexing/engine"
import { toIndexingConfigInput } from "@kilocode/kilo-indexing/config"
import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"
import {
  IndexingStatus,
  INDEXING_STATUS_STATES,
  disabledIndexingStatus,
  normalizeIndexingStatus,
} from "@kilocode/kilo-indexing/status"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { Instance } from "@/project/instance"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config"
import { registerDisposer } from "@/effect/instance-registry"
import { Global } from "@/global"
import { Log } from "@/util"
import { LanceDBRuntime } from "./lancedb" // kilocode_change

const log = Log.create({ service: "kilocode-indexing" })
const missing = () => disabledIndexingStatus("Indexing plugin is not enabled for this workspace.")

function worktreeDisabled(): z.infer<typeof IndexingStatus> {
  return {
    state: "Disabled",
    message: "Indexing is disabled in worktree sessions. Use the main workspace for indexing.",
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
  }
}

function isWorktreePath(dir: string): boolean {
  return /(?:\/|\\)\.kilo(?:code)?(?:\/|\\)worktrees(?:\/|\\)/.test(dir)
}

function failed(err: unknown): z.infer<typeof IndexingStatus> {
  const msg = err instanceof Error ? err.message : String(err)
  const text = msg.startsWith("Failed to initialize:") ? msg : `Failed to initialize: ${msg}`

  return {
    state: "Error",
    message: text,
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
  }
}

function pending(): z.infer<typeof IndexingStatus> {
  return {
    state: "In Progress",
    message: "Indexing is initializing.",
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
  }
}

function trackTelemetry(event: IndexingTelemetryEvent): void {
  if (event.type === "started") {
    Telemetry.trackIndexingStarted({
      trigger: event.trigger,
      source: event.source,
      mode: event.mode,
      provider: event.provider,
      vectorStore: event.vectorStore,
      modelId: event.modelId,
    })
    return
  }

  if (event.type === "completed") {
    Telemetry.trackIndexingCompleted({
      trigger: event.trigger,
      source: event.source,
      mode: event.mode,
      provider: event.provider,
      vectorStore: event.vectorStore,
      modelId: event.modelId,
      filesIndexed: event.filesIndexed,
      filesDiscovered: event.filesDiscovered,
      totalBlocks: event.totalBlocks,
      batchErrors: event.batchErrors,
    })
    return
  }

  if (event.type === "file_count") {
    Telemetry.trackIndexingFileCount({
      source: event.source,
      mode: event.mode,
      provider: event.provider,
      vectorStore: event.vectorStore,
      modelId: event.modelId,
      discovered: event.discovered,
      candidate: event.candidate,
    })
    return
  }

  if (event.type === "batch_retry") {
    Telemetry.trackIndexingBatchRetry({
      source: event.source,
      mode: event.mode,
      provider: event.provider,
      vectorStore: event.vectorStore,
      modelId: event.modelId,
      attempt: event.attempt,
      maxRetries: event.maxRetries,
      batchSize: event.batchSize,
      error: event.error,
    })
    return
  }

  Telemetry.trackIndexingError({
    source: event.source,
    trigger: event.trigger,
    mode: event.mode,
    provider: event.provider,
    vectorStore: event.vectorStore,
    modelId: event.modelId,
    location: event.location,
    error: event.error,
    retryCount: event.retryCount,
    maxRetries: event.maxRetries,
  })
}

export namespace KiloIndexing {
  export const Status = IndexingStatus
  export type Status = z.infer<typeof Status>

  // Mirror of IndexingStatus using Effect Schema for BusEvent.define, which
  // requires a Schema.Top. The zod form above is kept for consumers that still
  // depend on the z.infer-derived type.
  const StateSchema = Schema.Literals(INDEXING_STATUS_STATES).annotate({ identifier: "IndexingStatusState" })

  const StatusSchema = Schema.Struct({
    state: StateSchema,
    message: Schema.String,
    processedFiles: Schema.Number,
    totalFiles: Schema.Number,
    percent: Schema.Number,
  }).annotate({ identifier: "IndexingStatus" })

  type Entry = {
    manager?: CodeIndexManager
    current(): Status
    publish(): Promise<void>
    dispose(): void
  }

  type Cache = {
    promise: Promise<Entry>
    ready: Promise<Entry>
    resolve(entry: Entry): void
    reject(err: unknown): void
    entry?: Entry
    disposed?: boolean
  }

  export const Event = BusEvent.define(
    "indexing.status",
    Schema.Struct({
      status: StatusSchema,
    }),
  )

  const cache = new Map<string, Cache>()

  const inert = async (current: () => Status): Promise<Entry> => {
    const publish = async () => {
      await Bus.publish(Event, { status: current() })
    }

    await publish()
    return {
      current,
      publish,
      dispose() {},
    }
  }

  function track(hit: Cache, entry: Entry) {
    if (!hit.entry) hit.resolve(entry)
    hit.entry = entry
    if (hit.disposed) entry.dispose()
    return entry
  }

  const boot = async (hit: Cache): Promise<Entry> => {
    const dir = Instance.directory
    const cfg = await Config.get()
    if (!hasIndexingPlugin(cfg.plugin)) {
      return track(hit, await inert(() => missing()))
    }

    if (cfg.experimental?.semantic_indexing !== true) {
      return track(
        hit,
        await inert(() => disabledIndexingStatus("Semantic indexing is disabled. Enable it in the Experimental settings.")),
      )
    }

    if (isWorktreePath(dir)) {
      return track(hit, await inert(() => worktreeDisabled()))
    }

    log.info("initializing project indexing", { workspacePath: dir })
    const root = path.join(Global.Path.state, "indexing")
    const manager = new CodeIndexManager(dir, root)
    const input = toIndexingConfigInput(cfg.indexing)
    const box = { status: pending() as Status | undefined }
    const current = () => box.status ?? normalizeIndexingStatus(manager)
    let disposed = false

    const publish = async () => {
      await Bus.publish(Event, { status: current() })
    }
    const report = async () => {
      try {
        return await publish()
      } catch (err) {
        log.error("failed to publish indexing status", { err })
      }
    }

    const unsub = manager.onProgressUpdate.on(() => {
      void report()
    })
    const telemetrySub = manager.onTelemetry.on((event) => {
      trackTelemetry(event)
    })

    const base: Entry = {
      current,
      publish,
      dispose() {
        if (disposed) return
        disposed = true
        unsub.dispose()
        telemetrySub.dispose()
        manager.dispose()
      },
    }
    track(hit, base)
    await report()

    if (hit.disposed) return base

    // kilocode_change start
    const err = await LanceDBRuntime.ensure(input.vectorStoreProvider)
      .then(() => manager.initialize(input))
      .then(
        () => undefined,
        (err) => err,
      )
    // kilocode_change end
    if (hit.disposed) return base

    if (err) {
      box.status = failed(err)
      log.error("project indexing initialization failed", {
        err,
        workspacePath: dir,
      })
      await report()
      return base
    }
    box.status = undefined
    base.manager = manager

    log.info("project indexing initialized", {
      workspacePath: dir,
      featureEnabled: manager.isFeatureEnabled,
      featureConfigured: manager.isFeatureConfigured,
      state: manager.getCurrentStatus().systemStatus,
    })
    await report()

    return base
  }

  const hit = () => {
    const dir = Instance.directory
    const existing = cache.get(dir)
    if (existing) return existing

    const gate = Promise.withResolvers<Entry>()
    const next = {
      ready: gate.promise,
      resolve: gate.resolve,
      reject: gate.reject,
    } as Cache
    next.promise = boot(next)
      .then((entry) => {
        if (next.disposed) {
          entry.dispose()
          return entry
        }
        next.entry = entry
        return entry
      })
      .catch((err) => {
        next.reject(err)
        if (cache.get(dir) === next) cache.delete(dir)
        throw err
      })
    cache.set(dir, next)
    return next
  }

  registerDisposer(async (dir) => {
    const hit = cache.get(dir)
    cache.delete(dir)
    if (hit) hit.disposed = true
    if (hit?.entry) {
      hit.entry.dispose()
      return
    }
  })

  export async function init() {
    const current = hit()
    void current.promise.catch((err) => {
      log.error("failed to initialize indexing", { err })
    })
    await current.ready
  }

  export async function current(): Promise<Status> {
    return (await hit().ready).current()
  }

  export function ready(): boolean {
    const entry = cache.get(Instance.directory)?.entry
    if (!entry?.manager) return false
    return entry.current().state !== "Disabled"
  }

  export async function available(): Promise<boolean> {
    const entry = await hit().ready
    if (!entry.manager) return false
    return entry.current().state !== "Disabled"
  }

  export async function search(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
    const entry = await hit().ready
    if (!entry.manager) return []
    return entry.manager.searchIndex(query, directoryPrefix)
  }
}
