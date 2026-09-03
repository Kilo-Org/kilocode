import { realpath } from "node:fs/promises"
import type {
  EventKilocodeNotebookCancelled,
  EventKilocodeNotebookRequested,
  KiloClient,
  NotebookFailure,
  NotebookRequest,
  NotebookResult,
} from "@kilocode/sdk/v2/client"
import { FileIgnoreController } from "../autocomplete/shims/FileIgnoreController"
import type { ConnectionState, KiloConnectionService } from "../cli-backend/connection-service"
import type { SSEPayload } from "../cli-backend/sdk-sse-adapter"
import { NotebookAdapter } from "./adapter"
import { NotebookError } from "./path"

const RETAINED_REQUESTS = 1_000
const CODES = new Set<NotebookFailure["code"]>([
  "cancelled",
  "closed",
  "disconnected",
  "execution_failed",
  "invalid_cell",
  "invalid_path",
  "no_kernel",
  "not_found",
  "stale_revision",
  "timeout",
  "unsupported",
])

type NotebookAdapterLike = Pick<NotebookAdapter, "read" | "edit" | "execute">

export interface NotebookBridgeContext {
  adapter: NotebookAdapterLike
  refresh?(): Promise<void>
  dispose(): void
}

export interface NotebookBridgeOptions {
  create?: (directory: string) => Promise<NotebookBridgeContext>
  canonical?: (directory: string) => Promise<string>
}

interface NotebookConnection {
  onEvent(listener: (event: SSEPayload, directory?: string) => void): () => void
  onStateChange(listener: (state: ConnectionState, error?: Error) => void): () => void
  getClient(): KiloClient
  getKnownDirectories(): string[]
}

interface ActiveRequest {
  controller: AbortController
  cancelled: boolean
}

interface RequestOrigin {
  directory: string
  root: string
  sessionID: string
}

type NotebookOutcome = { result: NotebookResult } | { error: NotebookFailure }

async function createContext(directory: string): Promise<NotebookBridgeContext> {
  const controller = new FileIgnoreController(directory)
  await controller.initialize()
  return {
    adapter: new NotebookAdapter(controller),
    refresh: () => controller.initialize(),
    dispose: () => controller.dispose(),
  }
}

function failure(error: unknown): NotebookFailure {
  const detail = error instanceof Error ? error.message : String(error)
  const message = (detail || "Notebook operation failed without an error message").slice(0, 10_000)
  if (error instanceof NotebookError && CODES.has(error.code as NotebookFailure["code"])) {
    return {
      code: error.code as NotebookFailure["code"],
      message,
      ...(error.path !== undefined ? { path: error.path } : {}),
      ...(error.index !== undefined ? { index: error.index } : {}),
      ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}),
    }
  }
  return { code: "execution_failed", message }
}

export class NotebookBridge {
  private readonly contexts = new Map<string, Promise<NotebookBridgeContext>>()
  private readonly active = new Map<string, ActiveRequest>()
  private readonly admitting = new Set<string>()
  private readonly origins = new Map<string, RequestOrigin>()
  private readonly outcomes = new Map<string, NotebookOutcome>()
  private readonly settled = new Set<string>()
  private readonly unsubscribeEvent: () => void
  private readonly unsubscribeState: () => void
  private readonly create: (directory: string) => Promise<NotebookBridgeContext>
  private readonly canonical: (directory: string) => Promise<string>
  private disposed = false
  private revision = 0
  private backend: KiloClient | undefined

  constructor(
    private readonly connection: NotebookConnection,
    options: NotebookBridgeOptions = {},
  ) {
    this.create = options.create ?? createContext
    this.canonical = options.canonical ?? realpath
    this.unsubscribeEvent = connection.onEvent((event, directory) => this.event(event, directory))
    this.unsubscribeState = connection.onStateChange((state) => {
      if (state !== "connected") return
      const backend = connection.getClient()
      if (this.backend && this.backend !== backend) this.reset()
      this.backend = backend
      const revision = ++this.revision
      void this.recover(revision).catch((error: unknown) => {
        console.error("[Kilo New] NotebookBridge: pending request recovery failed:", error)
      })
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.revision += 1
    this.unsubscribeEvent()
    this.unsubscribeState()
    for (const request of this.active.values()) {
      request.cancelled = true
      request.controller.abort()
    }
    this.active.clear()
    this.admitting.clear()
    for (const context of this.contexts.values()) {
      void context
        .then((value) => value.dispose())
        .catch((error: unknown) => console.error("[Kilo New] NotebookBridge: context disposal failed:", error))
    }
    this.contexts.clear()
    this.origins.clear()
    this.outcomes.clear()
    this.settled.clear()
  }

  private reset(): void {
    for (const request of this.active.values()) {
      request.cancelled = true
      request.controller.abort()
    }
    this.active.clear()
    this.admitting.clear()
    this.origins.clear()
    this.outcomes.clear()
    this.settled.clear()
  }

  private event(event: SSEPayload, directory?: string): void {
    if (event.type === "kilocode.notebook.requested") {
      this.request(event as EventKilocodeNotebookRequested, directory)
      return
    }
    if (event.type === "kilocode.notebook.cancelled") {
      this.cancel(event as EventKilocodeNotebookCancelled, directory)
    }
  }

  private request(event: EventKilocodeNotebookRequested, directory?: string): void {
    const request = event.properties
    const origin = this.origins.get(request.id)
    if (origin) {
      if (origin.sessionID !== request.sessionID || (directory && origin.directory !== directory)) return
      this.start(request, origin)
      return
    }
    if (!directory || this.disposed || this.admitting.has(request.id) || this.settled.has(request.id)) return
    this.admitting.add(request.id)
    void this.admit(request, directory).finally(() => this.admitting.delete(request.id))
  }

  private async admit(request: NotebookRequest, directory: string): Promise<void> {
    const root = await this.allowed(directory)
    if (this.disposed || this.settled.has(request.id)) return
    if (!root) {
      const accepted = await this.reject(request.id, directory, {
        code: "invalid_path",
        message: "Notebook request directory is not an active VS Code workspace",
      })
      if (accepted) this.remember(this.settled, request.id)
      return
    }
    const origin = { directory, root, sessionID: request.sessionID }
    this.rememberOrigin(request.id, origin)
    this.start(request, origin)
  }

  private start(request: NotebookRequest, origin: RequestOrigin): void {
    if (this.disposed || this.active.has(request.id) || this.settled.has(request.id)) return
    const active = { controller: new AbortController(), cancelled: false }
    this.active.set(request.id, active)
    void this.run(request, origin, active).catch((error: unknown) => {
      console.error(`[Kilo New] NotebookBridge: request ${request.id} failed:`, error)
    })
  }

  private cancel(event: EventKilocodeNotebookCancelled, directory?: string): void {
    const id = event.properties.requestID
    const origin = this.origins.get(id)
    if (origin && (origin.sessionID !== event.properties.sessionID || (directory && origin.directory !== directory)))
      return
    this.remember(this.settled, id)
    const active = this.active.get(id)
    if (!active) return
    active.cancelled = true
    active.controller.abort()
  }

  private async run(request: NotebookRequest, origin: RequestOrigin, active: ActiveRequest): Promise<void> {
    try {
      const outcome = this.outcomes.get(request.id) ?? (await this.execute(request, origin.root, active))
      if (!outcome || this.disposed || active.cancelled) return
      this.rememberOutcome(request.id, outcome)
      const accepted =
        "result" in outcome
          ? await this.reply(request.id, origin.directory, outcome.result)
          : await this.reject(request.id, origin.directory, outcome.error)
      if (accepted) {
        this.outcomes.delete(request.id)
        this.remember(this.settled, request.id)
      }
    } finally {
      if (this.active.get(request.id) === active) this.active.delete(request.id)
    }
  }

  private async execute(
    request: NotebookRequest,
    directory: string,
    active: ActiveRequest,
  ): Promise<NotebookOutcome | undefined> {
    try {
      const context = await this.context(directory)
      if (this.disposed || active.cancelled) return undefined
      await context.refresh?.()
      if (this.disposed || active.cancelled) return undefined
      const result = await this.dispatch(context.adapter, request, directory, active.controller.signal)
      return { result }
    } catch (error) {
      if (this.disposed || active.cancelled) return undefined
      return { error: failure(error) }
    }
  }

  private dispatch(
    adapter: NotebookAdapterLike,
    request: NotebookRequest,
    directory: string,
    signal: AbortSignal,
  ): Promise<NotebookResult> {
    if (request.operation === "read") {
      return adapter.read({ path: request.path, directory, includeOutputs: request.includeOutputs })
    }
    if (request.operation === "edit") {
      return adapter.edit({
        path: request.path,
        directory,
        ...(request.expectedRevision !== undefined ? { expectedRevision: request.expectedRevision } : {}),
        index: request.index,
        edit: request.edit,
      })
    }
    return adapter.execute({
      path: request.path,
      directory,
      expectedRevision: request.expectedRevision,
      index: request.index,
      signal,
    })
  }

  private async allowed(directory: string): Promise<string | undefined> {
    const root = await this.canonical(directory).catch(() => undefined)
    if (!root) return undefined
    const known = await Promise.all(
      this.connection.getKnownDirectories().map((dir) => this.canonical(dir).catch(() => undefined)),
    )
    return known.includes(root) ? root : undefined
  }

  private context(directory: string): Promise<NotebookBridgeContext> {
    const existing = this.contexts.get(directory)
    if (existing) return existing
    const context = this.create(directory).catch((error: unknown) => {
      this.contexts.delete(directory)
      throw error
    })
    this.contexts.set(directory, context)
    return context
  }

  private async reply(requestID: string, directory: string, result: NotebookResult): Promise<boolean> {
    try {
      const response = await this.connection.getClient().kilocode.notebook.reply({ requestID, directory, result })
      if (!response.error) return true
      console.error(`[Kilo New] NotebookBridge: reply ${requestID} failed:`, response.error)
      return false
    } catch (error) {
      console.error(`[Kilo New] NotebookBridge: reply ${requestID} failed:`, error)
      return false
    }
  }

  private async reject(requestID: string, directory: string, error: NotebookFailure): Promise<boolean> {
    try {
      const response = await this.connection.getClient().kilocode.notebook.reject({ requestID, directory, error })
      if (!response.error) return true
      console.error(`[Kilo New] NotebookBridge: rejection ${requestID} failed:`, response.error)
      return false
    } catch (cause) {
      console.error(`[Kilo New] NotebookBridge: rejection ${requestID} failed:`, cause)
      return false
    }
  }

  private async recover(revision: number): Promise<void> {
    const client = this.connection.getClient()
    for (const directory of this.connection.getKnownDirectories()) {
      try {
        const response = await client.kilocode.notebook.list({ directory })
        if (this.disposed || revision !== this.revision) return
        if (response.error) {
          console.error(`[Kilo New] NotebookBridge: could not list requests for ${directory}:`, response.error)
          continue
        }
        for (const request of response.data ?? []) {
          this.request({ id: request.id, type: "kilocode.notebook.requested", properties: request }, directory)
        }
      } catch (error) {
        console.error(`[Kilo New] NotebookBridge: could not list requests for ${directory}:`, error)
      }
    }
  }

  private rememberOutcome(id: string, outcome: NotebookOutcome): void {
    this.outcomes.set(id, outcome)
    if (this.outcomes.size <= RETAINED_REQUESTS) return
    const oldest = this.outcomes.keys().next().value
    if (oldest !== undefined) this.outcomes.delete(oldest)
  }

  private rememberOrigin(id: string, origin: RequestOrigin): void {
    this.origins.set(id, origin)
    if (this.origins.size <= RETAINED_REQUESTS) return
    const oldest = this.origins.keys().next().value
    if (oldest !== undefined) this.origins.delete(oldest)
  }

  private remember(set: Set<string>, id: string): void {
    set.add(id)
    if (set.size <= RETAINED_REQUESTS) return
    const oldest = set.keys().next().value
    if (oldest !== undefined) set.delete(oldest)
  }
}

export function createNotebookBridge(connection: KiloConnectionService): NotebookBridge {
  return new NotebookBridge(connection)
}
