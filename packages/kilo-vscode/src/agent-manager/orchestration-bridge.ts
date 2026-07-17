import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { ConnectionState } from "../services/cli-backend/connection-service"
import type { SSEPayload } from "../services/cli-backend/sdk-sse-adapter"
import { sameDirectory } from "../kilo-provider-utils"
import type { LocalStats, WorktreeStats } from "./GitStatsPoller"
import type { PRStatus } from "./types"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import {
  OrchestrationError,
  overview,
  prompt,
  sameManagedDirectory,
  type FailureCode,
  type Overview,
  type OverviewFilter,
} from "./orchestration-domain"

const RETAINED = 1_000

interface RequestBase {
  id: string
  sessionID: string
}

type Request =
  | (RequestBase & { operation: "overview"; filter?: OverviewFilter })
  | (RequestBase & { operation: "prompt"; targetSessionID: string; prompt: string })
  | (RequestBase & { operation: "stop"; targetSessionID: string })

type Result =
  | { operation: "overview"; overview: Overview }
  | { operation: "prompt"; sessionID: string; delivered: true }
  | { operation: "stop"; sessionID: string; stopped: true }

interface Failure {
  code: FailureCode | "cancelled" | "disconnected" | "timeout"
  message: string
}

interface Options {
  root(): string | undefined
  ready(): Promise<WorktreeStateManager | undefined>
  state(): WorktreeStateManager | undefined
  stats(refresh?: boolean): Promise<{ worktrees: WorktreeStats[]; local?: LocalStats }>
  prs(): Map<string, PRStatus>
  managed(sessionID: string): boolean
  close(sessionID: string): Promise<void>
  log(...args: unknown[]): void
}

interface Connection {
  onEvent(listener: (event: SSEPayload, directory?: string) => void): () => void
  onStateChange(listener: (state: ConnectionState, error?: Error) => void): () => void
  registerDirectoryProvider(provider: () => string[]): () => void
  getKnownDirectories(): string[]
  getClient(): KiloClient
}

interface Active {
  controller: AbortController
  cancelled: boolean
}

interface Origin {
  directory: string
  sessionID: string
}

type Outcome = { result: Result } | { error: Failure }

function failure(error: unknown): Failure {
  const message = (error instanceof Error ? error.message : String(error)) || "Agent Manager host operation failed"
  if (error instanceof OrchestrationError) return { code: error.code, message: message.slice(0, 10_000) }
  return { code: "host_error", message: message.slice(0, 10_000) }
}

export class AgentManagerOrchestrationBridge {
  private readonly active = new Map<string, Active>()
  private readonly admitting = new Set<string>()
  private readonly origins = new Map<string, Origin>()
  private readonly outcomes = new Map<string, Outcome>()
  private readonly settled = new Set<string>()
  private readonly titles = new Map<string, string>()
  private readonly unsubscribeEvent: () => void
  private readonly unsubscribeState: () => void
  private readonly unsubscribeDirectories: () => void
  private disposed = false
  private revision = 0
  private backend: KiloClient | undefined

  constructor(
    private readonly connection: Connection,
    private readonly options: Options,
  ) {
    this.unsubscribeEvent = connection.onEvent((event, directory) => this.event(event, directory))
    this.unsubscribeState = connection.onStateChange((state) => {
      if (state !== "connected") return
      const backend = connection.getClient()
      if (this.backend && this.backend !== backend) this.reset()
      this.backend = backend
      const revision = ++this.revision
      void this.recover(revision).catch((error: unknown) => {
        this.options.log("Agent Manager request recovery failed:", error)
      })
    })
    this.unsubscribeDirectories = connection.registerDirectoryProvider(() => {
      const root = this.options.root()
      const dirs =
        this.options
          .state()
          ?.getWorktrees()
          .map((worktree) => worktree.path) ?? []
      return root ? [root, ...dirs] : dirs
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.revision += 1
    this.unsubscribeEvent()
    this.unsubscribeState()
    this.unsubscribeDirectories()
    for (const active of this.active.values()) {
      active.cancelled = true
      active.controller.abort()
    }
    this.active.clear()
    this.admitting.clear()
    this.origins.clear()
    this.outcomes.clear()
    this.settled.clear()
    this.titles.clear()
  }

  private reset(): void {
    for (const active of this.active.values()) {
      active.cancelled = true
      active.controller.abort()
    }
    this.active.clear()
    this.admitting.clear()
    this.origins.clear()
    this.outcomes.clear()
    this.settled.clear()
  }

  private event(event: SSEPayload, directory?: string): void {
    if (event.type === "session.updated" || event.type === "session.created") {
      this.titles.set(event.properties.sessionID, event.properties.info.title.trim() || event.properties.sessionID)
      return
    }
    if (event.type === "session.deleted") {
      this.titles.delete(event.properties.sessionID)
      return
    }
    if (event.type === "kilocode.agent_manager.requested") {
      this.request((event as unknown as { properties: Request }).properties, directory)
      return
    }
    if (event.type === "kilocode.agent_manager.cancelled") {
      const properties = (event as unknown as { properties: { requestID: string; sessionID: string } }).properties
      this.cancel(properties, directory)
    }
  }

  private request(request: Request, directory?: string): void {
    const origin = this.origins.get(request.id)
    if (origin) {
      if (origin.sessionID !== request.sessionID || (directory && !sameDirectory(origin.directory, directory))) return
      this.start(request, origin)
      return
    }
    if (!directory || this.disposed || this.admitting.has(request.id) || this.settled.has(request.id)) return
    this.admitting.add(request.id)
    void this.admit(request, directory).finally(() => this.admitting.delete(request.id))
  }

  private async admit(request: Request, directory: string): Promise<void> {
    const state = await this.options.ready()
    const root = this.options.root()
    if (this.disposed || this.settled.has(request.id)) return
    if (!state || !root) {
      const accepted = await this.reject(request.id, directory, {
        code: "workspace_unavailable",
        message: "Agent Manager requires an open workspace",
      })
      if (accepted) this.remember(this.settled, request.id)
      return
    }
    const managed = await Promise.all(
      [root, ...state.getWorktrees().map((worktree) => worktree.path)].map((path) =>
        sameManagedDirectory(directory, path),
      ),
    )
    if (!managed.some(Boolean)) {
      const accepted = await this.reject(request.id, directory, {
        code: "cross_workspace",
        message: "Agent Manager request directory does not belong to this workspace",
      })
      if (accepted) this.remember(this.settled, request.id)
      return
    }
    const origin = { directory, sessionID: request.sessionID }
    this.rememberOrigin(request.id, origin)
    this.start(request, origin)
  }

  private start(request: Request, origin: Origin): void {
    if (this.disposed || this.active.has(request.id) || this.settled.has(request.id)) return
    const active = { controller: new AbortController(), cancelled: false }
    this.active.set(request.id, active)
    void this.run(request, origin, active).catch((error: unknown) => {
      this.options.log(`Agent Manager request ${request.id} failed:`, error)
    })
  }

  private cancel(event: { requestID: string; sessionID: string }, directory?: string): void {
    const origin = this.origins.get(event.requestID)
    if (origin && (origin.sessionID !== event.sessionID || (directory && !sameDirectory(origin.directory, directory))))
      return
    this.remember(this.settled, event.requestID)
    const active = this.active.get(event.requestID)
    if (!active) return
    active.cancelled = true
    active.controller.abort()
  }

  private async run(request: Request, origin: Origin, active: Active): Promise<void> {
    try {
      const outcome = this.outcomes.get(request.id) ?? (await this.execute(request, active))
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

  private async execute(request: Request, active: Active): Promise<Outcome | undefined> {
    try {
      const state = await this.options.ready()
      const root = this.options.root()
      if (!state || !root)
        throw new OrchestrationError("workspace_unavailable", "Agent Manager requires an open workspace")
      if (this.disposed || active.cancelled) return
      const client = this.connection.getClient()
      if (request.operation === "overview") {
        const stats = await this.options.stats(true)
        if (this.disposed || active.cancelled) return
        const result = await overview({
          client,
          root,
          state,
          titles: this.titles,
          filter: request.filter,
          stats,
          prs: this.options.prs(),
        })
        return { result: { operation: "overview", overview: result } }
      }
      if (request.operation === "prompt") {
        await prompt({
          client,
          root,
          state,
          sessionID: request.targetSessionID,
          text: request.prompt,
          messageID: request.id,
          signal: active.controller.signal,
        })
        if (this.disposed || active.cancelled) return
        return { result: { operation: "prompt", sessionID: request.targetSessionID, delivered: true } }
      }
      if (!this.options.managed(request.targetSessionID)) {
        throw new OrchestrationError("unknown_session", "The session is not managed by this Agent Manager workspace")
      }
      await this.options.close(request.targetSessionID)
      if (this.disposed || active.cancelled) return
      return { result: { operation: "stop", sessionID: request.targetSessionID, stopped: true } }
    } catch (error) {
      if (this.disposed || active.cancelled) return
      return { error: failure(error) }
    }
  }

  private async reply(requestID: string, directory: string, result: Result): Promise<boolean> {
    try {
      const response = await this.connection.getClient().kilocode.agentManager.reply({ requestID, directory, result })
      if (!response.error) return true
      this.options.log(`Agent Manager reply ${requestID} failed:`, response.error)
    } catch (error) {
      this.options.log(`Agent Manager reply ${requestID} failed:`, error)
    }
    return false
  }

  private async reject(requestID: string, directory: string, error: Failure): Promise<boolean> {
    try {
      const response = await this.connection.getClient().kilocode.agentManager.reject({ requestID, directory, error })
      if (!response.error) return true
      this.options.log(`Agent Manager rejection ${requestID} failed:`, response.error)
    } catch (cause) {
      this.options.log(`Agent Manager rejection ${requestID} failed:`, cause)
    }
    return false
  }

  private async recover(revision: number): Promise<void> {
    await this.options.ready()
    const client = this.connection.getClient()
    await Promise.all(
      this.connection.getKnownDirectories().map(async (directory) => {
        const response = await client.kilocode.agentManager.list({ directory }).catch((error: unknown) => {
          this.options.log(`Could not list Agent Manager requests for ${directory}:`, error)
          return undefined
        })
        if (!response || this.disposed || revision !== this.revision) return
        if (response.error) {
          this.options.log(`Could not list Agent Manager requests for ${directory}:`, response.error)
          return
        }
        for (const request of response.data ?? []) this.request(request as Request, directory)
      }),
    )
  }

  private rememberOutcome(id: string, outcome: Outcome): void {
    this.outcomes.set(id, outcome)
    if (this.outcomes.size <= RETAINED) return
    const oldest = this.outcomes.keys().next().value
    if (oldest !== undefined) this.outcomes.delete(oldest)
  }

  private rememberOrigin(id: string, origin: Origin): void {
    this.origins.set(id, origin)
    if (this.origins.size <= RETAINED) return
    const oldest = this.origins.keys().next().value
    if (oldest !== undefined) this.origins.delete(oldest)
  }

  private remember(set: Set<string>, id: string): void {
    set.add(id)
    if (set.size <= RETAINED) return
    const oldest = set.keys().next().value
    if (oldest !== undefined) set.delete(oldest)
  }
}
