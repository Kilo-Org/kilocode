import * as vscode from "vscode"
import type { SSEPayload } from "../cli-backend/sdk-sse-adapter"
import type { KiloConnectionService } from "../cli-backend/connection-service"

type Sync = Extract<SSEPayload, { type: "sync" }>
type Question = Extract<SSEPayload, { type: "question.asked" | "question.replied" | "question.rejected" }>
type Permission = Extract<SSEPayload, { type: "permission.asked" | "permission.replied" }>
type PermissionAsked = Extract<Permission, { type: "permission.asked" }>
type Status = Extract<SSEPayload, { type: "session.status" }>
type Close = Extract<SSEPayload, { type: "session.turn.close" }>
type ErrorEvent = Extract<SSEPayload, { type: "session.error" }>

/**
 * Public, read-only task states exposed to other extensions.
 *
 * The mapping from internal session/turn events is intentional and explicit:
 *   - session.status busy/retry/offline -> "running" (the task is in flight)
 *   - session.turn.close reason "completed" (root turn) -> "done"
 *   - session.error + session.turn.close, or close reason "error" -> "error"
 *   - question.asked / permission.asked -> "needsInput"
 *   - question/permission replied -> "running"
 *   - session.turn.close reason "interrupted"/"superseded" -> "cancelled"
 *   - session.status idle is ignored: turn close is the authoritative outcome
 */
export type KiloTaskState = "running" | "done" | "error" | "needsInput" | "cancelled"

export interface KiloTaskStateChangeEvent {
  /** The Kilo session the task runs in. */
  taskId: string
  state: KiloTaskState
  previousState?: KiloTaskState
  /** Session title, when known from session metadata. Never a transcript. */
  title?: string
  /** Short, structural summary (permission or question label, error name). */
  message?: string
  /** ISO-8601 timestamp of the transition. */
  timestamp: string
}

/** Versioned, read-only API surface returned by this extension's `activate()`. */
export interface KiloExtensionApi {
  readonly apiVersion: 1
  onDidChangeTaskState: vscode.Event<KiloTaskStateChangeEvent>
  getCurrentTasks(): Promise<KiloTaskStateChangeEvent[]>
}

export interface TaskStateBridgeOptions {
  /**
   * Auto-approval hook for permission events. Returning `true` (or a promise
   * resolving to `true`) suppresses the "needsInput" event, mirroring how the
   * attention service decides whether a permission needs the user at all.
   */
  approve?: (event: PermissionAsked, directory?: string) => boolean | Promise<boolean>
  /** Diagnostic sink; defaults to console.log. Receives no user content. */
  log?: (message: string) => void
  /** Injectable clock for tests. */
  now?: () => Date
  /** Injectable emitter for tests; defaults to a vscode.EventEmitter. */
  emitter?: TaskStateEmitter
}

/** The subset of vscode.EventEmitter the bridge needs (injectable for tests). */
export interface TaskStateEmitter {
  event: vscode.Event<KiloTaskStateChangeEvent>
  fire(data: KiloTaskStateChangeEvent): void
  dispose(): void
}

/** Sessions older than this are evicted first (bounded bookkeeping). */
const MAX_TRACKED_SESSIONS = 2000

/**
 * Bridges authoritative Kilo backend task-state transitions to a versioned
 * public `vscode.Event`. Mirrors the semantics of the attention service
 * (the internal consumer that decides when a task needs the user), but is
 * purely additive: nothing changes unless another extension subscribes.
 */
export class TaskStateBridge implements vscode.Disposable {
  private readonly emitter: TaskStateEmitter
  private readonly states = new Map<string, KiloTaskState>()
  private readonly latest = new Map<string, KiloTaskStateChangeEvent>()
  private readonly titles = new Map<string, string>()
  private readonly active = new Set<string>()
  private readonly errored = new Set<string>()
  private readonly failed = new Set<string>()
  private readonly goals = new Set<string>()
  private readonly pendingQuestions = new Map<string, Set<string>>()
  private readonly pendingPermissions = new Map<string, Set<string>>()
  private readonly unsubscribeEvent: () => void
  private readonly unsubscribeState: () => void
  private readonly opts: TaskStateBridgeOptions
  private disposed = false

  constructor(connection: Pick<KiloConnectionService, "onEvent" | "onStateChange">, opts: TaskStateBridgeOptions = {}) {
    this.opts = opts
    this.emitter = opts.emitter ?? new vscode.EventEmitter<KiloTaskStateChangeEvent>()
    this.unsubscribeEvent = connection.onEvent((event, directory) => {
      try {
        this.handle(event, directory)
      } catch (error) {
        this.log(`task-state bridge handler failed: ${error instanceof Error ? error.name : "unknown error"}`)
      }
    })
    this.unsubscribeState = connection.onStateChange((state) => {
      if (state === "error" || state === "disconnected") this.reset()
    })
  }

  onDidChangeTaskState: vscode.Event<KiloTaskStateChangeEvent> = (listener, thisArgs, disposables) =>
    this.emitter.event(listener, thisArgs, disposables)

  getCurrentTasks(): Promise<KiloTaskStateChangeEvent[]> {
    return Promise.resolve([...this.latest.values()])
  }

  /** The frozen, read-only API object handed out through `activate()`. */
  get api(): KiloExtensionApi {
    return Object.freeze({
      apiVersion: 1,
      onDidChangeTaskState: this.onDidChangeTaskState,
      getCurrentTasks: () => this.getCurrentTasks(),
    })
  }

  dispose() {
    this.disposed = true
    this.unsubscribeEvent()
    this.unsubscribeState()
    this.emitter.dispose()
    this.reset()
  }

  private handle(event: SSEPayload, directory?: string) {
    if (this.disposed) return
    switch (event.type) {
      case "sync":
        return this.sync(event)
      case "question.asked":
      case "question.replied":
      case "question.rejected":
        return this.question(event, directory)
      case "permission.asked":
      case "permission.replied":
        return this.permission(event, directory)
      case "session.deleted":
        return this.forget(event.properties.sessionID)
      case "session.status":
        return this.status(event)
      case "session.turn.close":
        return this.close(event, directory)
      case "session.error":
        return this.error(event)
    }
  }

  private sync(event: Sync) {
    switch (event.name) {
      case "session.created.1":
      case "session.updated.1": {
        const info = event.data.info
        this.rememberTitle(event.data.sessionID, info.title)
        const goal = info.metadata?.["kilo.goal"]
        if (goal && typeof goal === "object" && "active" in goal && goal.active === true) {
          this.goals.add(event.data.sessionID)
        } else {
          this.goals.delete(event.data.sessionID)
        }
        return
      }
      case "session.deleted.1":
        return this.forget(event.data.sessionID)
      default:
        return
    }
  }

  private question(event: Question, directory?: string) {
    const sessionID = event.properties.sessionID
    if (event.type === "question.asked") {
      const pending = this.pending(sessionID, this.pendingQuestions)
      if (pending.has(event.properties.id)) return
      pending.add(event.properties.id)
      const header = event.properties.questions[0]?.header
      this.transition(sessionID, "needsInput", header ? `Kilo needs input: ${header}` : "Kilo needs input")
      return
    }
    if (this.pending(sessionID, this.pendingQuestions).delete(event.properties.requestID)) {
      this.resume(sessionID)
    }
  }

  private permission(event: Permission, directory?: string) {
    const sessionID = event.properties.sessionID
    if (event.type !== "permission.asked") {
      if (this.pending(sessionID, this.pendingPermissions).delete(event.properties.requestID)) {
        this.resume(sessionID)
      }
      return
    }
    const pending = this.pending(sessionID, this.pendingPermissions)
    if (pending.has(event.properties.id)) return
    pending.add(event.properties.id)
    const alert = () => {
      if (!pending.has(event.properties.id)) return
      this.transition(sessionID, "needsInput", `Kilo needs permission: ${event.properties.permission}`)
    }
    const approval = this.opts.approve?.(event, directory)
    if (approval === true) return
    if (approval === false || approval === undefined) return alert()
    void approval.then((handled) => {
      if (!handled) alert()
    }, alert)
  }

  private status(event: Status) {
    const sessionID = event.properties.sessionID
    switch (event.properties.status.type) {
      case "busy":
      case "retry":
      case "offline":
        this.active.add(sessionID)
        this.errored.delete(sessionID)
        this.failed.delete(sessionID)
        // A status replay must not lift a pending question or permission:
        // replies are the authoritative signal that input was provided.
        if (this.states.get(sessionID) !== "needsInput") {
          this.transition(sessionID, "running")
        }
        return
      case "idle":
        // Turn close (not idle) is the authoritative task outcome.
        return
      default:
        this.log(
          `ignoring unknown session status type: ${String((event.properties.status as { type?: unknown }).type)}`,
        )
    }
  }

  private close(event: Close, directory?: string) {
    const sessionID = event.properties.sessionID
    if (!this.active.delete(sessionID)) return
    const root = event.properties.parentID === undefined
    const wasErrored = this.errored.delete(sessionID)
    const wasFailed = this.failed.delete(sessionID)
    if (wasErrored && wasFailed) {
      // Mirror the attention service: a failure was already observed while
      // the task ran; only the closing root turn proves it was not transient.
      // Aborted turns (MessageAbortedError) fall through to the reason
      // mapping below so an interrupted close surfaces as "cancelled".
      if (root) this.transition(sessionID, "error")
      return
    }
    if (!root) return // Child (subagent) session turns are steps, not user tasks.
    switch (event.properties.reason) {
      case "completed":
        if (!this.goals.has(sessionID)) this.transition(sessionID, "done")
        return
      case "error":
        this.transition(sessionID, "error")
        return
      case "interrupted":
      case "superseded":
        this.transition(sessionID, "cancelled")
        return
      default:
        this.log(`ignoring unknown turn close reason: ${String((event.properties as { reason?: unknown }).reason)}`)
    }
  }

  private error(event: ErrorEvent) {
    const sessionID = event.properties.sessionID
    if (!sessionID || !this.active.has(sessionID)) return
    this.errored.add(sessionID)
    // MessageAbortedError is a deliberate abort, not a task failure; the turn
    // will close as interrupted. Everything else is held until the turn
    // closes, so a retry that recovers never emits a false "error".
    if (event.properties.error?.name === "MessageAbortedError") return
    this.failed.add(sessionID)
  }

  private resume(sessionID: string) {
    if (this.pending(sessionID, this.pendingQuestions).size > 0) return
    if (this.pending(sessionID, this.pendingPermissions).size > 0) return
    if (this.states.get(sessionID) === "needsInput") this.transition(sessionID, "running")
  }

  private transition(sessionID: string, state: KiloTaskState, message?: string) {
    const previous = this.states.get(sessionID)
    if (previous === state) return // A repeated state is not a transition.
    this.states.set(sessionID, state)
    this.evictOldSessions()
    const title = this.titles.get(sessionID)
    const change: KiloTaskStateChangeEvent = Object.freeze({
      taskId: sessionID,
      state,
      ...(previous !== undefined ? { previousState: previous } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(message !== undefined ? { message } : {}),
      timestamp: (this.opts.now ?? (() => new Date()))().toISOString(),
    })
    this.latest.set(sessionID, change)
    try {
      this.emitter.fire(change)
    } catch (error) {
      // One consumer must never break the bridge or other consumers.
      this.log(`task-state listener failed: ${error instanceof Error ? error.name : "unknown error"}`)
    }
  }

  private pending(sessionID: string, map: Map<string, Set<string>>): Set<string> {
    let set = map.get(sessionID)
    if (!set) {
      set = new Set()
      map.set(sessionID, set)
    }
    return set
  }

  private rememberTitle(sessionID: string, title?: string) {
    if (!title) return
    this.titles.set(sessionID, title)
    this.evictOldSessions()
  }

  private forget(sessionID: string) {
    this.states.delete(sessionID)
    this.latest.delete(sessionID)
    this.titles.delete(sessionID)
    this.active.delete(sessionID)
    this.errored.delete(sessionID)
    this.failed.delete(sessionID)
    this.goals.delete(sessionID)
    this.pendingQuestions.delete(sessionID)
    this.pendingPermissions.delete(sessionID)
  }

  private evictOldSessions() {
    if (this.states.size <= MAX_TRACKED_SESSIONS) return
    for (const sessionID of this.states.keys()) {
      if (this.states.size <= MAX_TRACKED_SESSIONS) break
      if (this.active.has(sessionID)) continue // never evict in-flight tasks
      this.forget(sessionID)
    }
  }

  private reset() {
    this.states.clear()
    this.latest.clear()
    this.titles.clear()
    this.active.clear()
    this.errored.clear()
    this.failed.clear()
    this.goals.clear()
    this.pendingQuestions.clear()
    this.pendingPermissions.clear()
  }

  private log(message: string) {
    const sink = this.opts.log ?? ((line: string) => console.log(`[Kilo New] ${line}`))
    sink(message)
  }
}
