export * as IndexingRuntime from "./runtime"

import path from "path"
import { realpathSync } from "node:fs"
import type { IndexingConfig } from "@kilocode/kilo-indexing/config"
import { toIndexingConfigInput } from "@kilocode/kilo-indexing/config"
import type { VectorStoreSearchResult } from "@kilocode/kilo-indexing/engine"
import type { KiloEmbeddingModelCatalog } from "@kilocode/kilo-indexing/embedding-models"
import { disabledIndexingStatus, type IndexingStatus } from "@kilocode/kilo-indexing/status"
import { indexingWithKiloDefault, type KiloIndexingAuth } from "./indexing-auth"
import { indexingWarningKey, type IndexingWarning } from "./indexing-warning"
import { IndexingWorker } from "./indexing-worker-client"
import { allowed, message } from "./root"

export type Status = IndexingStatus
type Input = ReturnType<typeof toIndexingConfigInput>

/** What a runtime needs from its Location. The plugin supplies it; tests supply fakes. */
export interface Host {
  readonly directory: string
  /** The user's home directory, which is never indexed. */
  readonly home: string
  /** The index root: one LanceDB store per project below it. */
  readonly root: string
  /** The effective `indexing` config. */
  readonly config: () => Promise<IndexingConfig | undefined>
  /** The Kilo credentials for the `kilo` embedder. Read only when indexing is on, so a disabled Location waits for nothing. */
  readonly auth: () => Promise<KiloIndexingAuth>
  readonly catalog: (auth: KiloIndexingAuth) => Promise<KiloEmbeddingModelCatalog>
  readonly lancedb: (store: string | undefined) => Promise<void>
  /** The primary checkout of the directory's repository, or undefined outside Git. */
  readonly primary: (directory: string) => Promise<string | undefined>
  readonly publish: (status: Status) => Promise<void>
  readonly warning: (warning: IndexingWarning) => void
  readonly log: (level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => void
  readonly env?: Record<string, string | undefined>
}

export class IndexingModelError extends Error {
  constructor(readonly model: string) {
    super(`Invalid indexing.model "${model}"`)
  }
}

const noWorkspace = () =>
  disabledIndexingStatus("Codebase indexing is disabled because no workspace folder is open in VS Code.")
const unsafeRoot = () => disabledIndexingStatus(message)
const noConsent = () =>
  disabledIndexingStatus("Codebase indexing is disabled until you enable it for this project in Kilo Settings.")

function failed(err: unknown): Status {
  const base =
    err instanceof IndexingModelError ? err.message : err instanceof Error ? err.message : String(err)
  const text = base.startsWith("Failed to initialize:") ? base : `Failed to initialize: ${base}`

  return {
    state: "Error",
    message: text,
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
  }
}

function pending(): Status {
  return {
    state: "In Progress",
    message: "Indexing is initializing.",
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
  }
}

function enrichKilo(input: Input, auth: KiloIndexingAuth) {
  if (input.embedderProvider !== "kilo") return input

  return {
    ...input,
    kiloApiKey: input.kiloApiKey ?? auth.apiKey,
    kiloBaseUrl: input.kiloBaseUrl ?? auth.baseUrl,
    kiloOrganizationId: input.kiloOrganizationId ?? auth.organizationId,
  }
}

async function model(host: Host, input: Input, auth: KiloIndexingAuth): Promise<Input> {
  if (input.embedderProvider !== "kilo" || !input.enabled) return input

  const catalog = await host.catalog(auth)

  if (input.modelId) {
    const id = catalog.aliases[input.modelId] ?? input.modelId
    const chosen = catalog.models.find((item) => item.id === id)
    if (catalog.models.length > 0 && !chosen) {
      throw new IndexingModelError(input.modelId)
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
      host.log("warn", "ignoring unsupported Kilo embedding model configuration", { model: input.modelId })
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

/** The engine input of an effective `indexing` config. VS Code enables indexing through project consent instead. */
export function input(config?: IndexingConfig, platform?: string) {
  return toIndexingConfigInput({
    ...config,
    enabled: platform === "vscode" ? true : (config?.enabled ?? false),
  })
}

// Machine-local consent from VS Code, by project root. It lives for the server process, as the extension sends it
// again for each server it starts.
const consent = new Map<string, boolean>()
const live = new Set<Runtime>()

type Entry = {
  engine?: IndexingWorker.Driver
  initialized?: boolean
  current(): Status
  warnings(): IndexingWarning[]
  publish(): Promise<void>
  dispose(): Promise<void>
}

type Boot = {
  promise: Promise<Entry>
  ready: Promise<Entry>
  resolve(entry: Entry): void
  entry?: Entry
  disposed?: boolean
}

/** The codebase index of one Location: lifecycle, status delivery, consent and search. */
export class Runtime {
  private boot: Boot | undefined
  private project: string | undefined

  constructor(private readonly host: Host) {
    live.add(this)
  }

  private get env() {
    return this.host.env ?? process.env
  }

  private hit() {
    if (this.boot) return this.boot
    const gate = Promise.withResolvers<Entry>()
    const next = { ready: gate.promise, resolve: gate.resolve } as Boot
    next.promise = this.start(next)
      .then(async (entry) => {
        if (next.disposed) {
          await entry.dispose()
          return entry
        }
        next.entry = entry
        return entry
      })
      .catch((err) => {
        gate.reject(err)
        if (this.boot === next) this.boot = undefined
        throw err
      })
    this.boot = next
    return next
  }

  private async inert(current: () => Status): Promise<Entry> {
    return {
      current,
      warnings: () => [],
      publish: () => this.host.publish(current()),
      async dispose() {},
    }
  }

  private track(hit: Boot, entry: Entry) {
    if (!hit.entry) hit.resolve(entry)
    hit.entry = entry
    if (hit.disposed) void entry.dispose()
    return entry
  }

  private async baselineDirectory(dir: string) {
    const checkout = await this.checkout(dir)
    if (!checkout) return undefined
    const main = await this.host.primary(checkout)
    if (!main || checkout === main) return undefined

    const scope = path.relative(checkout, path.resolve(dir))
    if (scope === ".." || scope.startsWith(`..${path.sep}`) || path.isAbsolute(scope)) return undefined

    const baseline = path.resolve(main, scope)
    if (baseline === path.resolve(dir)) return undefined
    return baseline
  }

  // The top level of the checkout that contains `dir`, linked worktree or not.
  private async checkout(dir: string) {
    const proc = Bun.spawn(["git", "rev-parse", "--path-format=absolute", "--show-toplevel"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "ignore",
      windowsHide: true,
    })
    const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    return code === 0 ? path.resolve(text.replace(/\r?\n$/, "")) : undefined
  }

  private async start(hit: Boot): Promise<Entry> {
    const host = this.host
    const dir = host.directory
    if (this.env["KILO_DISABLE_CODEBASE_INDEXING"] === "vscode-no-workspace") {
      return this.track(hit, await this.inert(() => noWorkspace()))
    }
    try {
      if (!allowed(realpathSync.native(dir), host.home)) return this.track(hit, await this.inert(() => unsafeRoot()))
    } catch (err) {
      host.log("warn", "indexing directory resolution failed", { err, workspacePath: dir })
      return this.track(hit, await this.inert(() => failed(err)))
    }
    // A disabled Location answers from the config alone: no Git query, no account wait, no worker.
    const config = await host.config()
    if (!input(config, this.env["KILO_PLATFORM"]).enabled) {
      return this.track(hit, await this.inert(() => disabledIndexingStatus()))
    }

    const project = await this.resolveProject()
    if (this.env["KILO_PLATFORM"] === "vscode" && !consent.get(project)) {
      return this.track(hit, await this.inert(() => noConsent()))
    }
    const baseline = await this.baselineDirectory(dir).catch(() => undefined)

    host.log("info", "initializing project indexing", { workspacePath: dir, baselineDirectory: baseline })
    const auth = await host.auth()
    const merged = indexingWithKiloDefault(config, auth) ?? {}
    let cfgInput: Input
    try {
      cfgInput = await model(host, enrichKilo(input(merged, this.env["KILO_PLATFORM"]), auth), auth)
    } catch (err) {
      host.log("warn", "indexing model resolution failed", { err })
      return this.track(hit, await this.inert(() => failed(err)))
    }
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
    const report = (next = current()) => {
      delivery.task = delivery.task
        .then(async () => {
          if (disposed || same(delivery.last, next)) return
          await host.publish(next)
          delivery.last = next
        })
        .catch((err) => {
          host.log("error", "failed to publish indexing status", { err })
        })
      return delivery.task
    }
    const clear = () => {
      if (!delivery.timer) return
      clearTimeout(delivery.timer)
      delivery.timer = undefined
    }
    // Progress updates are coalesced to one event per 250 ms; a state change is delivered at once.
    const status = (next: Status) => {
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
      delivery.timer = setTimeout(() => {
        delivery.timer = undefined
        delivery.time = Date.now()
        void report()
      }, delay)
    }
    const warning = (item: IndexingWarning) => {
      if (disposed) return
      const key = indexingWarningKey(item)
      if (warnings.has(key)) return
      warnings.set(key, item)
      host.warning(item)
    }
    const output = (event: Parameters<IndexingWorker.Hooks["log"]>[0]) => {
      if (disposed) return
      host.log(event.level, event.message, { source: "worker", workspacePath: dir })
    }
    const base: Entry = {
      current,
      warnings: () => [...warnings.values()],
      publish: () => report(),
      async dispose() {
        if (disposed) return
        disposed = true
        clear()
        base.initialized = false
        await base.engine?.dispose().catch((err) => {
          host.log("warn", "failed to dispose project indexing worker", { err, workspacePath: dir })
        })
      },
    }
    const failure = (err: unknown) => {
      if (disposed) return
      base.initialized = false
      host.log("error", "project indexing worker failed", { err, workspacePath: dir })
      status(failed(err))
    }
    this.track(hit, base)
    await report()

    if (hit.disposed) return base

    // Telemetry events are not forwarded yet: the v2 telemetry sink belongs to the usage and telemetry epic.
    const telemetry = () => {}
    const err = await host
      .lancedb(cfgInput.vectorStoreProvider)
      .then(async () => {
        if (hit.disposed) return
        const engine = IndexingWorker.create(dir, host.root, { status, telemetry, warning, log: output, failure })
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
        host.log("warn", "failed to dispose failed project indexing worker", { err: disposeErr, workspacePath: dir })
      })
      base.engine = undefined
      const next = failed(err)
      status(next)
      host.log("error", "project indexing initialization failed", { err, workspacePath: dir })
      await report(next)
      return base
    }

    host.log("info", "project indexing initialized", { workspacePath: dir, state: current().state })
    await report()

    return base
  }

  /** Start indexing in the background; `current` and the status events report progress. */
  async init() {
    const current = this.hit()
    void current.promise.catch((err) => {
      this.host.log("error", "failed to initialize indexing", { err })
    })
    await current.ready
  }

  /** Stop the engine and start again from the current settings and consent. */
  async restart() {
    const previous = this.boot
    this.boot = undefined
    if (previous) {
      previous.disposed = true
      await previous.entry?.dispose()
    }
    await this.init()
    await (await this.hit().ready).publish()
  }

  async current(): Promise<Status> {
    const entry = await this.hit().ready
    return entry.current()
  }

  async warnings(): Promise<IndexingWarning[]> {
    const entry = await this.hit().ready
    return entry.warnings()
  }

  /** True when the engine started and indexing is not disabled. */
  ready(): boolean {
    const entry = this.boot?.entry
    if (!entry?.initialized) return false
    return entry.current().state !== "Disabled"
  }

  async search(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
    const entry = await this.hit().promise
    if (!entry.initialized || entry.current().state === "Disabled" || !entry.engine) return []
    return entry.engine.search(query, directoryPrefix)
  }

  /** VS Code supplies machine-local project consent before indexing can start. */
  async consent(enabled: boolean) {
    if (this.env["KILO_PLATFORM"] !== "vscode") return
    const project = await this.resolveProject()
    if (consent.get(project) === enabled) return
    consent.set(project, enabled)
    await Promise.all(
      [...live]
        .filter((runtime) => (runtime.project ?? runtime.host.directory) === project || runtime === this)
        .map((runtime) => runtime.restart()),
    )
  }

  /** The primary checkout that keys VS Code consent: a linked worktree shares the consent of its main checkout. */
  async resolveProject() {
    if (this.project) return this.project
    // Only a successful lookup is remembered: a transient Git failure must not pin consent to the fallback directory.
    const primary = await this.host.primary(this.host.directory).catch(() => undefined)
    if (primary) this.project = primary
    return primary ?? this.host.directory
  }

  /** True when VS Code has supplied consent for the project of this Location. */
  consented() {
    return consent.get(this.project ?? this.host.directory) === true
  }

  async dispose() {
    live.delete(this)
    const previous = this.boot
    this.boot = undefined
    if (!previous) return
    previous.disposed = true
    await previous.entry?.dispose()
  }
}

/** Test seam: forget consent between tests. */
export function resetConsent() {
  consent.clear()
}
