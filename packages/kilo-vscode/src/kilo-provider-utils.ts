import type { Session, Agent, Event, ProviderListResponse } from "@kilocode/sdk/v2/client"
import type { CloudSessionMessage } from "./services/cli-backend/types"

/** A single provider entry as returned by the /provider list endpoint. */
export type ProviderInfo = ProviderListResponse["all"][number]

/**
 * Extract a human-readable error message from an unknown error value.
 * Handles Error instances, strings, and SDK error objects (which are
 * plain JSON objects thrown by the SDK when throwOnError is true).
 *
 * SDK error shapes from the server:
 * - BadRequestError: { data: unknown, errors: [...], success: false }
 * - NotFoundError: { name: "NotFoundError", data: { message: "..." } }
 * - Plain string (raw text response)
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>
    // Direct .message field
    if (typeof obj.message === "string") return obj.message
    // Direct .error field (string)
    if (typeof obj.error === "string") return obj.error
    // SDK throwOnError shape: { error: { message: "..." } } or { error: { ... } }
    if (obj.error && typeof obj.error === "object") {
      const nested = obj.error as Record<string, unknown>
      if (typeof nested.message === "string") return nested.message
    }
    // NotFoundError shape: { data: { message: "..." } }
    if (obj.data && typeof obj.data === "object") {
      const data = obj.data as Record<string, unknown>
      if (typeof data.message === "string") return data.message
      // Hono validator shape: { data: ..., error: [...], success: false }
      if (Array.isArray(data.error) && data.error.length > 0) {
        const first = data.error[0]
        if (typeof first === "string") return first
        if (first && typeof first === "object" && typeof (first as Record<string, unknown>).message === "string") {
          return (first as Record<string, unknown>).message as string
        }
      }
    }
    // BadRequestError shape: { errors: [{ message: "..." }] }
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      const first = obj.errors[0]
      if (typeof first === "string") return first
      if (first && typeof first.message === "string") return first.message
    }
    // Last resort: try JSON.stringify for debuggability
    try {
      const json = JSON.stringify(error)
      if (json !== "{}" && json.length < 500) return json
    } catch (err) {
      console.warn("[Kilo New] getErrorMessage: JSON.stringify failed", err)
    }
  }
  return String(error)
}

export class MessageConfirmation {
  private readonly ids = new Map<string, { confirmed: boolean; waits: Set<() => void> }>()

  track(id?: string): () => void {
    if (!id) return () => {}
    const entry = this.ids.get(id) ?? { confirmed: false, waits: new Set<() => void>() }
    this.ids.set(id, entry)
    return () => {
      this.ids.delete(id)
    }
  }

  confirm(id: string): void {
    const entry = this.ids.get(id)
    if (!entry) return
    entry.confirmed = true
    for (const done of [...entry.waits]) {
      done()
    }
  }

  has(id?: string): boolean {
    if (!id) return false
    return this.ids.get(id)?.confirmed ?? false
  }

  wait(id?: string, timeout = 1_500): Promise<boolean> {
    if (!id) return Promise.resolve(false)
    const entry = this.ids.get(id)
    if (!entry) return Promise.resolve(false)
    if (entry.confirmed) return Promise.resolve(true)

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup()
        resolve(entry.confirmed)
      }, timeout)

      const cleanup = () => {
        clearTimeout(timer)
        entry.waits.delete(done)
      }

      const done = () => {
        cleanup()
        resolve(true)
      }

      entry.waits.add(done)
    })
  }
}

export async function runWithMessageConfirmation<T>(
  state: MessageConfirmation,
  id: string | undefined,
  label: string,
  run: () => Promise<T>,
): Promise<T | undefined> {
  const release = state.track(id)
  try {
    return await run()
  } catch (error) {
    if (await state.wait(id)) {
      console.warn(`[Kilo New] ${label} ended after server accepted it; ignoring transport error`, {
        error: getErrorMessage(error),
      })
      return undefined
    }
    throw error
  } finally {
    release()
  }
}

export function sessionToWebview(session: Session) {
  return {
    id: session.id,
    parentID: session.parentID ?? null,
    title: session.title,
    createdAt: new Date(session.time.created).toISOString(),
    updatedAt: new Date(session.time.updated).toISOString(),
    // Use null (not undefined) so the value survives postMessage JSON serialization.
    // Without this, unrevert responses lose the revert key entirely and the
    // SolidJS store merge never clears the existing revert state.
    revert: session.revert ?? null,
    summary: session.summary ?? null,
  }
}

export function indexProvidersById(all: ProviderInfo[]): Record<string, ProviderInfo> {
  const normalized: Record<string, ProviderInfo> = {}
  for (const provider of all) {
    normalized[provider.id] = provider
  }
  return normalized
}

export function filterVisibleAgents(agents: Agent[]): { visible: Agent[]; defaultAgent: string } {
  const visible = agents.filter((a) => a.mode !== "subagent" && !a.hidden)
  const defaultAgent = visible.length > 0 ? visible[0]!.name : "code"
  return { visible, defaultAgent }
}

/**
 * Shared interface for the subset of KiloProvider state needed by session-refresh helpers.
 * Extracted here so the logic can be tested without importing KiloProvider (and vscode).
 */
export interface SessionRefreshContext {
  pendingSessionRefresh: boolean
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  listSessions: ((dir: string) => Promise<Session[]>) | null
  sessionDirectories: Map<string, string>
  workspaceDirectory: string
  postMessage(message: unknown): void
}

/**
 * Load sessions from the workspace and all registered worktree directories.
 * Sets pendingSessionRefresh when the HTTP client isn't ready yet.
 * Returns the resolved projectID (if any) so the caller can update its own state.
 */
export async function loadSessions(ctx: SessionRefreshContext): Promise<string | undefined> {
  const list = ctx.listSessions
  if (!list) {
    ctx.pendingSessionRefresh = true
    if (ctx.connectionState !== "connecting") {
      ctx.postMessage({ type: "error", message: "Not connected to CLI backend" })
    }
    return
  }

  ctx.pendingSessionRefresh = false

  const sessions = await list(ctx.workspaceDirectory)
  const projectID = sessions[0]?.projectID
  const worktreeDirs = new Set(ctx.sessionDirectories.values())
  const failed = new Set<string>()
  const extra = await Promise.all(
    [...worktreeDirs].map((dir) =>
      list(dir).catch((err: unknown) => {
        console.error(`[Kilo] Failed to list sessions for ${dir}:`, err)
        failed.add(dir)
        return [] as Session[]
      }),
    ),
  )
  const seen = new Set(sessions.map((s) => s.id))
  for (const batch of extra) {
    for (const s of batch) {
      if (seen.has(s.id)) continue
      sessions.push(s)
      seen.add(s.id)
    }
  }

  // Sessions whose worktree directories failed to list — the webview must
  // not delete these during reconciliation since the absence is transient.
  const preserve: string[] = []
  if (failed.size) {
    for (const [sid, dir] of ctx.sessionDirectories) {
      if (failed.has(dir)) preserve.push(sid)
    }
  }

  ctx.postMessage({
    type: "sessionsLoaded",
    sessions: sessions.map((s) => sessionToWebview(s)),
    ...(preserve.length ? { preserveSessionIds: preserve } : {}),
  })

  return projectID
}

/**
 * Flush a deferred session refresh when the HTTP client becomes available.
 */
export async function flushPendingSessionRefresh(ctx: SessionRefreshContext): Promise<string | undefined> {
  if (!ctx.pendingSessionRefresh) return

  if (!ctx.listSessions) {
    if (ctx.connectionState === "connecting") return
    ctx.postMessage({ type: "error", message: "Not connected to CLI backend" })
    return
  }

  return loadSessions(ctx)
}

export function buildSettingPath(key: string): { section: string; leaf: string } {
  const parts = key.split(".")
  const section = parts.slice(0, -1).join(".")
  const leaf = parts[parts.length - 1]!
  return { section, leaf }
}

export function resolveWorkspaceDirectory(input: {
  sessionID?: string
  sessionDirectories: Map<string, string>
  workspaceDirectory: string
}) {
  if (!input.sessionID) return input.workspaceDirectory

  const dir = input.sessionDirectories.get(input.sessionID)
  if (dir) return dir

  return input.workspaceDirectory
}

export function resolveContextDirectory(input: {
  currentSessionID?: string
  contextSessionID?: string
  sessionDirectories: Map<string, string>
  workspaceDirectory: string
}) {
  return resolveWorkspaceDirectory({
    sessionID: input.currentSessionID ?? input.contextSessionID,
    sessionDirectories: input.sessionDirectories,
    workspaceDirectory: input.workspaceDirectory,
  })
}

type PartUpdate = {
  type: "partUpdated"
  sessionID: string
  messageID: string
  part: unknown
  delta?: { type: "text-delta"; textDelta: string }
}

type PartBatch = {
  type: "partsUpdated"
  updates: PartUpdate[]
}

export type WebviewMessage =
  | PartUpdate
  | PartBatch
  | {
      type: "messageCreated"
      message: Record<string, unknown>
    }
  | { type: "sessionStatus"; sessionID: string; status: string; attempt?: number; message?: string; next?: number }
  | {
      type: "permissionRequest"
      permission: {
        id: string
        sessionID: string
        toolName: string
        patterns: string[]
        always: string[]
        args: Record<string, unknown>
        message: string
        tool?: { messageID: string; callID: string }
      }
    }
  | { type: "todoUpdated"; sessionID: string; items: unknown[] }
  | { type: "questionRequest"; question: { id: string; sessionID: string; questions: unknown[]; tool?: unknown } }
  | { type: "questionResolved"; requestID: string }
  | { type: "permissionResolved"; permissionID: string }
  | { type: "permissionError"; permissionID: string }
  | { type: "sessionCreated"; session: ReturnType<typeof sessionToWebview>; draftID?: string }
  | { type: "sessionUpdated"; session: ReturnType<typeof sessionToWebview> }
  | { type: "messageRemoved"; sessionID: string; messageID: string }
  | { type: "sessionError"; sessionID?: string; error?: unknown }
  | null

function partField(part: unknown, key: string): unknown {
  if (!part || typeof part !== "object") return undefined
  return (part as Record<string, unknown>)[key]
}

function appendPart(part: unknown, text: string): unknown {
  if (!part || typeof part !== "object") return part
  const item = part as Record<string, unknown>
  if ((item.type !== "text" && item.type !== "reasoning") || typeof item.text !== "string") return part
  return { ...item, text: item.text + text }
}

function partUpdateKey(msg: PartUpdate): string | undefined {
  const id = partField(msg.part, "id")
  const mid = msg.messageID || partField(msg.part, "messageID")
  if (typeof id !== "string" || !id) return undefined
  if (typeof mid !== "string" || !mid) return undefined
  return `${msg.sessionID}:${mid}:${id}`
}

function mergePartUpdate(prev: PartUpdate | undefined, msg: PartUpdate): PartUpdate {
  if (!prev) return msg
  const text = msg.delta?.textDelta
  if (!text) return msg.delta ? prev : msg
  if (!prev.delta) return { ...prev, part: appendPart(prev.part, text) }
  return {
    ...prev,
    part: appendPart(prev.part, text),
    delta: { type: "text-delta", textDelta: `${prev.delta.textDelta}${text}` },
  }
}

export type StreamSchedulerStats = {
  received: number
  emitted: number
  batches: number
  active: number
  background: number
}

export type StreamSchedulerOptions = {
  /** Flush cadence for the focused/active session. Defaults to 16ms. */
  activeMs?: number
  /** Base background cadence. Defaults to 150ms. */
  backgroundBaseMs?: number
  /**
   * Additional ms per background session above the first 2 (adaptive throttle).
   * 10 background sessions → base + 8 * step. Defaults to 20ms.
   */
  backgroundStepMs?: number
  /** Hard cap for the background cadence. Defaults to 400ms. */
  backgroundMaxMs?: number
}

// Scheduler tuning — rationale:
//
// These defaults balance perceived streaming smoothness against renderer pressure.
// The scheduler sits between SSE (dozens to hundreds of deltas per second per session)
// and the webview message loop, which applies updates through Solid `batch()` and
// triggers DOM / style / layout work on the renderer main thread.
//
// - DEFAULT_ACTIVE_MS = 16
//   One 60Hz animation frame. The focused session should feel indistinguishable
//   from immediate streaming, so we coalesce within a single paint window but no
//   longer. Raising this to 32ms visibly stutters live text; lowering below ~8ms
//   stops coalescing meaningfully because SSE delta arrival is already ~10-20ms
//   apart at typical model rates.
//
// - DEFAULT_BG_BASE_MS = 150
//   Background (non-focused) sessions don't need frame-perfect updates — the user
//   can't see their content. 150ms keeps tab-status signals (spinner motion,
//   token counts via related events) feeling alive while collapsing most
//   per-token deltas into a single batched emission. Under 100ms the coalescing
//   win shrinks; over ~250ms users start perceiving lag when switching tabs
//   mid-stream (though `focus()` also immediately flushes, so this is mostly a
//   concern for users watching tab-level indicators).
//
// - DEFAULT_BG_STEP_MS = 20
//   Per-extra-background-session backoff beyond the first 2. Each additional
//   streaming agent adds ~20ms to the background interval so total background
//   message throughput stays roughly flat as the agent count grows. Without this,
//   10 concurrent agents would put the same ~7 msg/sec pressure per-session on
//   the renderer as 1 agent does (~70 msg/sec total background).
//
// - DEFAULT_BG_MAX_MS = 400
//   Ceiling for the adaptive backoff. Even with 20+ agents streaming we never
//   stall background emissions longer than 400ms, which keeps tab indicators
//   recognizably "live" and keeps the `drop()`-on-delete path timely. Above
//   ~500ms the UI starts feeling disconnected; below 300ms the many-agent
//   backoff stops providing meaningful throttling.
const DEFAULT_ACTIVE_MS = 16
const DEFAULT_BG_BASE_MS = 150
const DEFAULT_BG_STEP_MS = 20
const DEFAULT_BG_MAX_MS = 400

export class SessionStreamScheduler {
  private active: string | undefined
  private atimer: ReturnType<typeof setTimeout> | null = null
  private btimer: ReturnType<typeof setTimeout> | null = null
  private readonly queues = new Map<string, Map<string, PartUpdate>>()
  private readonly activeMs: number
  private readonly bgBase: number
  private readonly bgStep: number
  private readonly bgMax: number
  private readonly counters: StreamSchedulerStats = {
    received: 0,
    emitted: 0,
    batches: 0,
    active: 0,
    background: 0,
  }

  constructor(
    private readonly send: (msg: PartUpdate | PartBatch) => void,
    opts?: StreamSchedulerOptions,
  ) {
    this.activeMs = opts?.activeMs ?? DEFAULT_ACTIVE_MS
    this.bgBase = opts?.backgroundBaseMs ?? DEFAULT_BG_BASE_MS
    this.bgStep = opts?.backgroundStepMs ?? DEFAULT_BG_STEP_MS
    this.bgMax = opts?.backgroundMaxMs ?? DEFAULT_BG_MAX_MS
  }

  focus(sessionID?: string): void {
    if (this.active === sessionID) return
    const prev = this.active
    if (this.atimer) {
      clearTimeout(this.atimer)
      this.atimer = null
    }
    this.active = sessionID
    if (prev && this.queues.get(prev)?.size) this.scheduleBackground()
    if (sessionID) this.flush(sessionID)
  }

  push(msg: PartUpdate): void {
    this.counters.received++
    const key = partUpdateKey(msg)
    if (!key) {
      // Non-keyable updates can't be merged. Flush pending first to preserve order.
      this.flush(msg.sessionID)
      this.emitOne(msg)
      return
    }

    const queue = this.ensureQueue(msg.sessionID)
    const prev = queue.get(key)
    // A full-part replacement after buffered deltas would lose information; flush first.
    if (prev?.delta && !msg.delta) {
      this.flush(msg.sessionID)
      this.ensureQueue(msg.sessionID).set(key, msg)
    } else {
      queue.set(key, mergePartUpdate(prev, msg))
    }
    this.schedule(msg.sessionID)
  }

  flush(sessionID?: string): void {
    if (!sessionID) {
      this.clearTimers()
      this.emit(this.takeAll())
      return
    }

    if (this.active === sessionID && this.atimer) {
      clearTimeout(this.atimer)
      this.atimer = null
    }

    this.emit(this.take(sessionID))

    if (this.btimer && !this.hasBackground()) {
      clearTimeout(this.btimer)
      this.btimer = null
    }
  }

  /** Drop any queued updates for a session (e.g. session deleted or untracked). */
  drop(sessionID: string): void {
    this.queues.delete(sessionID)
    if (this.btimer && !this.hasBackground()) {
      clearTimeout(this.btimer)
      this.btimer = null
    }
    if (this.active === sessionID) {
      this.active = undefined
      if (this.atimer) {
        clearTimeout(this.atimer)
        this.atimer = null
      }
    }
  }

  dispose(): void {
    this.clearTimers()
    this.queues.clear()
  }

  stats(): Readonly<StreamSchedulerStats> {
    return this.counters
  }

  private ensureQueue(sid: string): Map<string, PartUpdate> {
    const existing = this.queues.get(sid)
    if (existing) return existing
    const queue = new Map<string, PartUpdate>()
    this.queues.set(sid, queue)
    return queue
  }

  private schedule(sessionID: string): void {
    if (!this.queues.get(sessionID)?.size) return
    if (this.active === sessionID) {
      if (this.atimer) return
      this.atimer = setTimeout(() => this.flushActive(), this.activeMs)
      return
    }
    this.scheduleBackground()
  }

  private scheduleBackground(): void {
    if (this.btimer) return
    const count = this.backgroundCount()
    if (count === 0) return
    const extra = Math.max(0, count - 2) * this.bgStep
    const interval = Math.min(this.bgMax, this.bgBase + extra)
    this.btimer = setTimeout(() => this.flushBackground(), interval)
  }

  private flushActive(): void {
    this.atimer = null
    if (this.active) this.emit(this.take(this.active))
  }

  private flushBackground(): void {
    this.btimer = null
    this.emit(this.takeBackground())
  }

  private take(sessionID: string): PartUpdate[] {
    const queue = this.queues.get(sessionID)
    if (!queue) return []
    this.queues.delete(sessionID)
    return [...queue.values()]
  }

  private takeAll(): PartUpdate[] {
    const updates = [...this.queues.values()].flatMap((queue) => [...queue.values()])
    this.queues.clear()
    return updates
  }

  private takeBackground(): PartUpdate[] {
    const updates: PartUpdate[] = []
    for (const [sid, queue] of this.queues) {
      if (sid === this.active) continue
      updates.push(...queue.values())
      this.queues.delete(sid)
    }
    return updates
  }

  private backgroundCount(): number {
    let n = 0
    for (const [sid, queue] of this.queues) {
      if (sid !== this.active && queue.size > 0) n++
    }
    return n
  }

  private hasBackground(): boolean {
    return this.backgroundCount() > 0
  }

  private emit(updates: PartUpdate[]): void {
    if (updates.length === 0) return
    if (updates.length === 1) {
      this.emitOne(updates[0]!)
      return
    }
    this.counters.emitted += updates.length
    this.counters.batches++
    this.countLane(updates[0]!.sessionID)
    this.send({ type: "partsUpdated", updates })
  }

  private emitOne(msg: PartUpdate): void {
    this.counters.emitted++
    this.counters.batches++
    this.countLane(msg.sessionID)
    this.send(msg)
  }

  private countLane(sessionID: string): void {
    if (sessionID === this.active) this.counters.active++
    else this.counters.background++
  }

  private clearTimers(): void {
    if (this.atimer) clearTimeout(this.atimer)
    this.atimer = null
    if (this.btimer) clearTimeout(this.btimer)
    this.btimer = null
  }
}

export function mapSSEEventToWebviewMessage(event: Event, sessionID: string | undefined): WebviewMessage {
  switch (event.type) {
    case "message.part.updated": {
      const part = event.properties.part as { messageID?: string; sessionID?: string }
      if (!sessionID) return null
      return {
        type: "partUpdated",
        sessionID,
        messageID: part.messageID || "",
        part: event.properties.part,
      }
    }
    case "message.part.delta": {
      const props = event.properties
      if (!sessionID) return null
      return {
        type: "partUpdated",
        sessionID: props.sessionID,
        messageID: props.messageID,
        part: { id: props.partID, type: "text", messageID: props.messageID, text: props.delta },
        delta: { type: "text-delta", textDelta: props.delta },
      }
    }
    case "message.updated": {
      const info = event.properties.info
      return {
        type: "messageCreated",
        message: {
          ...info,
          createdAt: new Date(info.time.created).toISOString(),
        },
      }
    }
    case "message.removed": {
      const props = event.properties as { sessionID: string; messageID: string }
      return {
        type: "messageRemoved",
        sessionID: props.sessionID,
        messageID: props.messageID,
      }
    }
    case "session.status": {
      const info = event.properties.status
      // "offline" is not yet in the SDK SessionStatus type (pending SDK regeneration),
      // so we use string comparison to forward the message field for offline status.
      const status = info.type as string
      const extra =
        status === "retry"
          ? {
              attempt: (info as any).attempt as number,
              message: (info as any).message as string,
              next: (info as any).next as number,
            }
          : status === "offline"
            ? { message: (info as any).message as string }
            : {}
      return {
        type: "sessionStatus" as const,
        sessionID: event.properties.sessionID,
        status,
        ...extra,
      }
    }
    case "permission.asked":
      return {
        type: "permissionRequest",
        permission: {
          id: event.properties.id,
          sessionID: event.properties.sessionID,
          toolName: event.properties.permission,
          patterns: event.properties.patterns ?? [],
          always: event.properties.always ?? [],
          args: event.properties.metadata,
          message: `Permission required: ${event.properties.permission}`,
          tool: event.properties.tool,
        },
      }
    case "permission.replied":
      return {
        type: "permissionResolved",
        permissionID: event.properties.requestID,
      }
    case "todo.updated":
      return {
        type: "todoUpdated",
        sessionID: event.properties.sessionID,
        items: event.properties.todos,
      }
    case "question.asked":
      return {
        type: "questionRequest",
        question: {
          id: event.properties.id,
          sessionID: event.properties.sessionID,
          questions: event.properties.questions,
          tool: event.properties.tool,
        },
      }
    case "question.replied":
    case "question.rejected":
      return {
        type: "questionResolved",
        requestID: event.properties.requestID,
      }
    case "session.error": {
      return {
        type: "sessionError",
        sessionID: event.properties.sessionID,
        error: event.properties.error,
      }
    }
    case "session.created":
      return {
        type: "sessionCreated",
        session: sessionToWebview(event.properties.info),
      }
    case "session.updated":
      return {
        type: "sessionUpdated",
        session: sessionToWebview(event.properties.info),
      }
    default:
      return null
  }
}

export function mapCloudSessionMessageToWebviewMessage(message: CloudSessionMessage) {
  return {
    id: message.info.id,
    sessionID: message.info.sessionID,
    role: message.info.role as "user" | "assistant",
    parts: message.parts,
    createdAt: message.info.time?.created
      ? new Date(message.info.time.created).toISOString()
      : new Date().toISOString(),
    time: message.info.time,
    cost: message.info.cost,
    tokens: message.info.tokens,
  }
}

/**
 * Check whether an SSE event belongs to a different project and should be dropped.
 * Returns true when the event carries a projectID that does not match the expected one.
 * When expectedProjectID is undefined (not yet resolved), nothing is filtered.
 */
export function isEventFromForeignProject(event: Event, expectedProjectID: string | undefined): boolean {
  if (!expectedProjectID) return false
  if (event.type === "session.created" || event.type === "session.updated") {
    return event.properties.info.projectID !== expectedProjectID
  }
  return false
}

/**
 * Merge open-tab paths with backend file search results for the @ mention dropdown.
 *
 * Ordering: active file → other open tabs → backend results (all deduplicated).
 * When a query is present, open tabs are filtered to only include matches.
 * The `active` path (if provided) is placed first when it exists in `open`.
 */
export function mergeFileSearchResults(input: {
  query: string
  backend: string[]
  open: Set<string>
  active?: string
}): string[] {
  const query = input.query.trim().toLowerCase()
  const ok = (p: string) => !query || p.toLowerCase().includes(query)
  const tabs =
    input.active && input.open.has(input.active) && ok(input.active)
      ? [input.active, ...[...input.open].filter((p) => p !== input.active && ok(p))]
      : [...input.open].filter(ok)
  const seen = new Set(tabs)
  return [...tabs, ...input.backend.filter((p) => !seen.has(p))]
}
