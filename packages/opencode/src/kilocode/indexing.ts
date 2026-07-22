import z from "zod"
import path from "path"
import { Effect, Schema } from "effect"
import { type IndexingTelemetryEvent, type VectorStoreSearchResult } from "@kilocode/kilo-indexing/engine"
import { toIndexingConfigInput, type IndexingConfig } from "@kilocode/kilo-indexing/config"
import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"
import { IndexingStatus, disabledIndexingStatus } from "@kilocode/kilo-indexing/status"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { fetchKiloEmbeddingModelCatalog } from "@kilocode/kilo-gateway"
import { Instance } from "@/kilocode/instance"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Auth } from "@/auth"
import { makeRuntime } from "@/effect/run-service"
import { registerDisposer } from "@/effect/instance-registry"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { NamedError } from "@opencode-ai/core/util/error"
import type { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { Event as IndexingEvent, Warning as IndexingWarningEvent } from "./indexing-event"
import { indexingWarningKey, type IndexingWarning } from "./indexing-warning"
import { indexingProfileLogFields } from "./indexing-profile"
import { IndexingWorker } from "./indexing-worker-client"
import { LanceDBRuntime } from "./lancedb" // kilocode_change
import { indexingWithKiloDefault, resolveKiloIndexingAuth, type KiloIndexingAuth } from "./indexing-auth" // kilocode_change
import { primaryWorktree } from "./primary-worktree"

const log = Log.create({ service: "kilocode-indexing" })
const auth = makeRuntime(Auth.Service, Auth.defaultLayer)
const missing = () => disabledIndexingStatus("Indexing plugin is not enabled for this workspace.")
const noWorkspace = () =>
  disabledIndexingStatus("Codebase indexing is disabled because no workspace folder is open in VS Code.")

export const IndexingModelError = NamedError.create("IndexingModelError", {
  model: Schema.String,
})

const baselineDirectory = Effect.fn("KiloIndexing.baselineDirectory")(function* (dir: string) {
  if (Instance.project.vcs !== "git") return undefined
  const checkout = path.resolve(Instance.worktree)
  const main = yield* primaryWorktree(checkout)
  if (!main || checkout === main) return undefined

  const scope = path.relative(checkout, path.resolve(dir))
  if (scope === ".." || scope.startsWith(`..${path.sep}`) || path.isAbsolute(scope)) return undefined

  const baseline = path.resolve(main, scope)
  if (baseline === path.resolve(dir)) return undefined
  return baseline
})

function failed(err: unknown): z.infer<typeof IndexingStatus> {
  const base = IndexingModelError.isInstance(err)
    ? `Invalid indexing.model "${err.data.model}"`
    : err instanceof Error
      ? err.message
      : String(err)
  const text = base.startsWith("Failed to initialize:") ? base : `Failed to initialize: ${base}`

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
  if (input.embedderProvider !== "kilo" || !input.enabled) return input

  const catalog = await fetchKiloEmbeddingModelCatalog({ baseURL: auth.baseUrl, token: auth.apiKey })

  if (input.modelId) {
    const id = catalog.aliases[input.modelId] ?? input.modelId
    const chosen = catalog.models.find((item) => item.id === id)
    if (catalog.models.length > 0 && !chosen) {
      throw new IndexingModelError({ model: input.modelId })
    }
    if (chosen) {
      return {
        ...input,
        modelId: chosen.id,
        modelDimension: chosen.dimension,
        searchMinScore: input.searchMinScore ?? chosen.scoreThreshold,
      }
    }
  }

  const fallback = catalog.aliases[catalog.defaultModel] ?? catalog.defaultModel
  const found = catalog.models.find((item) => item.id === fallback)
  if (!found) {
    if (input.modelId || input.modelDimension) {
      log.warn("ignoring unsupported Kilo embedding model configuration", { model: input.modelId })
    }
    return { ...input, modelId: undefined, modelDimension: undefined }
  }

  return {
    ...input,
    modelId: found.id,
    modelDimension: found.dimension,
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
      enabled: config?.enabled ?? global?.enabled ?? false,
    })
  }

  type Entry = {
    engine?: IndexingWorker.Driver
    initialized?: boolean
    current(): Status
    warnings(): IndexingWarning[]
    scope(workspace: WorkspaceV2.ID | undefined): void
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
  export const Warning = IndexingWarningEvent

  const cache = new Map<string, Cache>()

  const inert = async (current: () => Status): Promise<Entry> => {
    const publish = async () => {
      await Bus.publish(Instance.current, Event, { status: current() })
    }

    return {
      current,
      warnings: () => [],
      scope() {},
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
    const startup = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const baseline = yield* baselineDirectory(dir)
        const cfg = yield* Config.Service.use((svc) => svc.get())
        return { baseline, cfg }
      }),
    )
    const baseline = startup.baseline
    const cfg = startup.cfg
    if (process.env["KILO_DISABLE_CODEBASE_INDEXING"] === "vscode-no-workspace") {
      return track(hit, await inert(() => noWorkspace()))
    }
    if (!hasIndexingPlugin(cfg.plugin)) {
      return track(hit, await inert(() => missing()))
    }

    log.info("initializing project indexing", { workspacePath: dir, baselineDirectory: baseline })
    const root = path.join(Global.Path.state, "indexing")
    const auth = await kiloAuth(cfg)
    const globalConfig = await AppRuntime.runPromise(Config.Service.use((svc) => svc.getGlobal()))
    const global = globalConfig.indexing
    const merged = indexingWithKiloDefault({ ...global, ...cfg.indexing }, auth)
    let cfgInput: Awaited<ReturnType<typeof model>>
    try {
      cfgInput = await model(enrichKilo(input(merged, global), auth), auth)
    } catch (err) {
      log.warn("indexing model resolution failed", { err })
      return track(hit, await inert(() => failed(err)))
    }
    const workspaces = new Set<WorkspaceV2.ID | undefined>([WorkspaceContext.workspaceID])
    const box = { status: pending() }
    const warnings = new Map<string, IndexingWarning>()
    const delivery = {
      last: undefined as Status | undefined,
      task: Promise.resolve(),
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
      time: 0,
    }
    const current = () => box.status
    let disposed = false

    const same = (left: Status | undefined, right: Status) =>
      left?.state === right.state &&
      left.message === right.message &&
      left.processedFiles === right.processedFiles &&
      left.totalFiles === right.totalFiles &&
      left.percent === right.percent
    const report = Instance.bind((next = current()) => {
      delivery.task = delivery.task
        .then(async () => {
          if (disposed || same(delivery.last, next)) return
          await Bus.publish(Instance.current, Event, { status: next })
          delivery.last = next
        })
        .catch((err) => {
          log.error("failed to publish indexing status", { err })
        })
      return delivery.task
    })
    const clear = () => {
      if (!delivery.timer) return
      clearTimeout(delivery.timer)
      delivery.timer = undefined
    }
    const status = Instance.bind((next: Status) => {
      if (disposed) return
      const previous = current()
      box.status = next
      if (same(previous, next)) return
      const immediate = previous.state !== next.state || next.state !== "In Progress"
      if (immediate) {
        clear()
        delivery.time = Date.now()
        void report(next)
        return
      }
      if (delivery.timer) return
      const delay = Math.max(0, 250 - (Date.now() - delivery.time))
      if (delay === 0) {
        delivery.time = Date.now()
        void report(next)
        return
      }
      delivery.timer = setTimeout(
        Instance.bind(() => {
          delivery.timer = undefined
          delivery.time = Date.now()
          void report()
        }),
        delay,
      )
    })
    const telemetry = Instance.bind((event: IndexingTelemetryEvent) => {
      if (disposed) return
      trackTelemetry(event)
    })
    const warning = Instance.bind((item: IndexingWarning) => {
      if (disposed) return
      const key = indexingWarningKey(item)
      if (warnings.has(key)) return
      warnings.set(key, item)
      void Promise.all(
        [...workspaces].map((workspaceID) =>
          WorkspaceContext.provide({
            workspaceID,
            fn: () => Bus.publish(Instance.current, Warning, item),
          }),
        ),
      ).catch((err) => {
        log.error("failed to publish indexing warning", { err, workspacePath: dir })
      })
    })
    const output = Instance.bind((event: Parameters<IndexingWorker.Hooks["log"]>[0]) => {
      if (disposed) return
      if (event.profile) {
        log.info(event.message, indexingProfileLogFields(dir, event.profile))
        return
      }
      log[event.level](event.message, { source: "worker", workspacePath: dir })
    })
    const base: Entry = {
      current,
      warnings: () => [...warnings.values()],
      scope: (workspaceID) => workspaces.add(workspaceID),
      publish: () => report(),
      async dispose() {
        if (disposed) return
        disposed = true
        clear()
        base.initialized = false
        await base.engine?.dispose().catch((err) => {
          log.warn("failed to dispose project indexing worker", { err, workspacePath: dir })
        })
      },
    }
    const failure = Instance.bind((err: unknown) => {
      if (disposed) return
      base.initialized = false
      log.error("project indexing worker failed", { err, workspacePath: dir })
      status(failed(err))
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
        const engine = IndexingWorker.create(dir, root, { status, telemetry, warning, log: output, failure })
        base.engine = engine
        box.status = await engine.init(cfgInput, baseline)
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
      const next = failed(err)
      status(next)
      log.error("project indexing initialization failed", {
        err,
        workspacePath: dir,
      })
      await report(next)
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
    const entry = await hit().ready
    entry.scope(WorkspaceContext.workspaceID)
    return entry.current()
  }

  export async function models() {
    try {
      const cfg = await AppRuntime.runPromise(Config.Service.use((svc) => svc.getGlobal()))
      const auth = await kiloAuth(cfg)
      const catalog = await fetchKiloEmbeddingModelCatalog({ baseURL: auth.baseUrl, token: auth.apiKey })
      if (catalog.models.length > 0 || (!auth.baseUrl && !auth.apiKey)) return catalog
      const fallback = await fetchKiloEmbeddingModelCatalog()
      return fallback.models.length > 0 ? fallback : catalog
    } catch (err) {
      log.warn("falling back to public Kilo embedding model catalog", { err })
      return fetchKiloEmbeddingModelCatalog()
    }
  }

  export async function warnings(): Promise<IndexingWarning[]> {
    const entry = await hit().ready
    entry.scope(WorkspaceContext.workspaceID)
    return entry.warnings()
  }

  export function ready(): boolean {
    const entry = cache.get(Instance.directory)?.entry
    if (!entry?.initialized) return false
    return entry.current().state !== "Disabled"
  }

  export async function available(): Promise<boolean> {
    const entry = await hit().ready
    entry.scope(WorkspaceContext.workspaceID)
    if (!entry.initialized) return false
    return entry.current().state !== "Disabled"
  }

  export async function search(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
    const entry = await hit().promise
    entry.scope(WorkspaceContext.workspaceID)
    if (!entry.initialized || entry.current().state === "Disabled" || !entry.engine) return []
    return entry.engine.search(query, directoryPrefix)
  }
}
