import z from "zod"
import path from "path"
import { type IndexingTelemetryEvent, type VectorStoreSearchResult } from "@kilocode/kilo-indexing/engine"
import { toIndexingConfigInput, type IndexingConfig } from "@kilocode/kilo-indexing/config"
import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"
import { IndexingStatus, disabledIndexingStatus } from "@kilocode/kilo-indexing/status"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { fetchKiloEmbeddingModelCatalog } from "@kilocode/kilo-gateway"
import { Instance } from "@/project/instance"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Auth } from "@/auth"
import { makeRuntime } from "@/effect/run-service"
import { registerDisposer } from "@/effect/instance-registry"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Event as IndexingEvent } from "./indexing-event"
import { IndexingWorker } from "./indexing-worker-client"
import { LanceDBRuntime } from "./lancedb" // kilocode_change
import { indexingWithKiloDefault, resolveKiloIndexingAuth, type KiloIndexingAuth } from "./indexing-auth" // kilocode_change

const log = Log.create({ service: "kilocode-indexing" })
const auth = makeRuntime(Auth.Service, Auth.defaultLayer)
const missing = () => disabledIndexingStatus("Indexing plugin is not enabled for this workspace.")
const noWorkspace = () =>
  disabledIndexingStatus("Codebase indexing is disabled because no workspace folder is open in VS Code.")

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

async function kiloAuth(cfg: Config.Info): Promise<KiloIndexingAuth> {
  const info = await auth.runPromise((svc) => svc.get("kilo"))
  return resolveKiloIndexingAuth({ config: cfg, auth: info })
}

function enrichKilo(input: ReturnType<typeof toIndexingConfigInput>, auth: KiloIndexingAuth) {
  if (input.embedderProvider !== "kilo") return input

  return {
    ...input,
    kiloApiKey: input.kiloApiKey ?? auth.apiKey,
    kiloBaseUrl: input.kiloBaseUrl ?? auth.baseUrl,
    kiloOrganizationId: input.kiloOrganizationId ?? auth.organizationId,
  }
}

async function model(input: ReturnType<typeof toIndexingConfigInput>, auth: KiloIndexingAuth) {
  if (input.embedderProvider !== "kilo") return input

  const catalog = await fetchKiloEmbeddingModelCatalog({ baseURL: auth.baseUrl, token: auth.apiKey })
  const id = input.modelId ? (catalog.aliases[input.modelId] ?? input.modelId) : catalog.defaultModel
  const chosen = catalog.models.find((item) => item.id === id)
  const fallback = catalog.aliases[catalog.defaultModel] ?? catalog.defaultModel
  const found = chosen ?? catalog.models.find((item) => item.id === fallback)

  if (!found) {
    if (input.modelId || input.modelDimension) {
      log.warn("ignoring unsupported Kilo embedding model configuration", { model: input.modelId })
    }
    return { ...input, modelId: undefined, modelDimension: undefined }
  }

  if (input.modelId && !chosen) {
    log.warn("using default Kilo embedding model instead of unsupported configuration", {
      model: input.modelId,
      fallback: found.id,
    })
  }

  return {
    ...input,
    modelId: found.id,
    modelDimension: chosen ? (input.modelDimension ?? found.dimension) : found.dimension,
    searchMinScore: input.searchMinScore ?? found.scoreThreshold,
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

  export function input(config?: IndexingConfig, global?: IndexingConfig) {
    return toIndexingConfigInput({
      ...config,
      enabled: config?.enabled === true || global?.enabled === true,
    })
  }

  type Entry = {
    engine?: IndexingWorker.Driver
    initialized?: boolean
    current(): Status
    publish(): Promise<void>
    dispose(): Promise<void>
  }

  type Cache = {
    promise: Promise<Entry>
    ready: Promise<Entry>
    resolve(entry: Entry): void
    reject(err: unknown): void
    entry?: Entry
    disposed?: boolean
  }

  export const Event = IndexingEvent

  const cache = new Map<string, Cache>()

  const inert = async (current: () => Status): Promise<Entry> => {
    const publish = async () => {
      await Bus.publish(Event, { status: current() })
    }

    return {
      current,
      publish,
      async dispose() {},
    }
  }

  function track(hit: Cache, entry: Entry) {
    if (!hit.entry) hit.resolve(entry)
    hit.entry = entry
    if (hit.disposed) void entry.dispose()
    return entry
  }

  const boot = async (hit: Cache): Promise<Entry> => {
    const dir = Instance.directory
    const cfg = await AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
    if (process.env["KILO_DISABLE_CODEBASE_INDEXING"] === "vscode-no-workspace") {
      return track(hit, await inert(() => noWorkspace()))
    }
    if (!hasIndexingPlugin(cfg.plugin)) {
      return track(hit, await inert(() => missing()))
    }

    if (isWorktreePath(dir)) {
      return track(hit, await inert(() => worktreeDisabled()))
    }

    log.info("initializing project indexing", { workspacePath: dir })
    const root = path.join(Global.Path.state, "indexing")
    const auth = await kiloAuth(cfg)
    const globalConfig = await AppRuntime.runPromise(Config.Service.use((svc) => svc.getGlobal()))
    const global = globalConfig.indexing
    const merged = indexingWithKiloDefault({ ...global, ...cfg.indexing }, auth)
    const cfgInput = await model(enrichKilo(input(merged, global), auth), auth)
    const box = { status: pending() }
    const current = () => box.status
    let disposed = false

    const publish = async () => {
      await Bus.publish(Event, { status: current() })
    }
    const report = Instance.bind(async () => {
      try {
        return await publish()
      } catch (err) {
        log.error("failed to publish indexing status", { err })
      }
    })
    const status = Instance.bind((next: Status) => {
      if (disposed) return
      box.status = next
      void report()
    })
    const telemetry = Instance.bind((event: IndexingTelemetryEvent) => {
      if (disposed) return
      trackTelemetry(event)
    })
    const base: Entry = {
      current,
      publish,
      async dispose() {
        if (disposed) return
        disposed = true
        base.initialized = false
        await base.engine?.dispose().catch((err) => {
          log.warn("failed to dispose project indexing worker", { err, workspacePath: dir })
        })
      },
    }
    const failure = Instance.bind((err: unknown) => {
      if (disposed) return
      base.initialized = false
      box.status = failed(err)
      log.error("project indexing worker failed", { err, workspacePath: dir })
      void report()
    })
    track(hit, base)
    await report()

    if (hit.disposed) return base

    if (!cfgInput.enabled) {
      box.status = disabledIndexingStatus()
      await report()
      return base
    }

    const err = await LanceDBRuntime.ensure(cfgInput.vectorStoreProvider)
      .then(async () => {
        if (hit.disposed) return
        const engine = IndexingWorker.create(dir, root, { status, telemetry, failure })
        base.engine = engine
        box.status = await engine.init(cfgInput)
        base.initialized = true
      })
      .then(
        () => undefined,
        (err) => err,
      )
    if (hit.disposed) return base

    if (err) {
      await base.engine?.dispose().catch((disposeErr) => {
        log.warn("failed to dispose failed project indexing worker", { err: disposeErr, workspacePath: dir })
      })
      base.engine = undefined
      box.status = failed(err)
      log.error("project indexing initialization failed", {
        err,
        workspacePath: dir,
      })
      await report()
      return base
    }

    log.info("project indexing initialized", {
      workspacePath: dir,
      state: current().state,
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
      .then(async (entry) => {
        if (next.disposed) {
          await entry.dispose()
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
      await hit.entry.dispose()
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
    if (!entry?.initialized) return false
    return entry.current().state !== "Disabled"
  }

  export async function available(): Promise<boolean> {
    const entry = await hit().ready
    if (!entry.initialized) return false
    return entry.current().state !== "Disabled"
  }

  export async function search(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
    const entry = await hit().ready
    if (!entry.initialized || entry.current().state === "Disabled" || !entry.engine) return []
    return entry.engine.search(query, directoryPrefix)
  }
}
