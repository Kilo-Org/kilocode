import type {
  Session,
  Agent,
  Event,
  ProviderListResponse,
  SyncEventMessageUpdated,
  SyncEventMessageRemoved,
  SyncEventMessagePartUpdated,
  SyncEventMessagePartRemoved,
  SyncEventSessionCreated,
  SyncEventSessionUpdated,
  SyncEventSessionDeleted,
} from "@kilocode/sdk/v2/client"
import { prettifyError } from "zod/v4"
import type { CloudSessionMessage, IndexingStatus } from "./services/cli-backend/types"
import type { PartBatch, PartUpdate } from "./kilo-provider/session-stream-scheduler"
import type { PartRemove } from "./shared/stream-messages"
import * as path from "path"

export { SessionStreamScheduler } from "./kilo-provider/session-stream-scheduler"

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
/** Extract a message from the first element of an array of strings or `{ message }` objects. */
function firstMessage(arr: unknown): string | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined
  const first = arr[0]
  if (typeof first === "string") return first
  if (first && typeof first === "object") {
    const msg = (first as Record<string, unknown>).message
    if (typeof msg === "string") return msg
  }
  return undefined
}

/** Extract a message from SDK error `data` field shapes (NotFoundError, ConfigInvalidError, Hono validator). */
function messageFromData(data: Record<string, unknown>): string | undefined {
  if (typeof data.message === "string") return data.message
  // ConfigInvalidError: { path, issues: [{ message, path, code }] }
  const fromIssues = firstMessage(data.issues)
  if (fromIssues) return fromIssues
  // Hono validator: { data, error: [...], success: false }
  return firstMessage(data.error)
}

function safeStringify(value: unknown): string | undefined {
  try {
    const json = JSON.stringify(value)
    if (json !== "{}" && json.length < 500) return json
  } catch (err) {
    console.warn("[Kilo New] getErrorMessage: JSON.stringify failed", err)
  }
  return undefined
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (!error || typeof error !== "object") return String(error)

  const obj = error as Record<string, unknown>
  if (typeof obj.message === "string") return obj.message
  if (typeof obj.error === "string") return obj.error

  // SDK throwOnError shape: { error: { message: "..." } }
  if (obj.error && typeof obj.error === "object") {
    const nested = (obj.error as Record<string, unknown>).message
    if (typeof nested === "string") return nested
  }

  if (obj.data && typeof obj.data === "object") {
    const fromData = messageFromData(obj.data as Record<string, unknown>)
    if (fromData) return fromData
  }

  // BadRequestError: { errors: [...] }
  const fromErrors = firstMessage(obj.errors)
  if (fromErrors) return fromErrors

  return safeStringify(error) ?? String(error)
}

/**
 * Format a full human-readable breakdown of a config save failure, including
 * the file path and every Zod issue. Used as the expandable details next to
 * the short getErrorMessage() summary.
 *
 * Zod issues are formatted via zod's built-in `prettifyError` so the output
 * matches Zod's canonical format (array indices rendered as `foo[0].bar`, etc).
 *
 * Returns undefined when the error doesn't carry structured config data —
 * callers should omit the details section in that case.
 */
export function getConfigErrorDetails(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const data = (error as Record<string, unknown>).data
  if (!data || typeof data !== "object") return undefined
  const scoped = data as Record<string, unknown>
  const path = typeof scoped.path === "string" ? scoped.path : undefined
  const issues = Array.isArray(scoped.issues) ? scoped.issues : undefined
  if (!path && (!issues || issues.length === 0)) return undefined

  const out: string[] = []
  if (path) out.push(`File: ${path}`)
  if (issues && issues.length > 0) {
    if (out.length > 0) out.push("")
    // prettifyError accepts any object with an `issues` array; the cast is
    // safe because it only reads the issues field.
    out.push(prettifyError({ issues } as Parameters<typeof prettifyError>[0]))
  }
  return out.join("\n")
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

type SessionPatch = SyncEventSessionUpdated["data"]["info"]
export type WebviewSessionPatch = Partial<ReturnType<typeof sessionToWebview>> & { id: string }

function set<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | null | undefined): void {
  if (value === undefined || value === null) return
  target[key] = value
}

function update<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | null | undefined): void {
  if (value === undefined) return
  if (value === null) {
    Reflect.deleteProperty(target, key)
    return
  }
  target[key] = value
}

function share(session: Session, url: string | null | undefined): void {
  if (url === undefined) return
  if (url === null) {
    delete session.share
    return
  }
  session.share = { url }
}

export function applySessionPatch(current: Session, patch: SessionPatch): Session {
  const next: Session = { ...current, time: { ...current.time } }

  set(next, "slug", patch.slug)
  set(next, "projectID", patch.projectID)
  set(next, "directory", patch.directory)
  set(next, "title", patch.title)
  set(next, "version", patch.version)
  update(next, "workspaceID", patch.workspaceID)
  update(next, "path", patch.path)
  update(next, "parentID", patch.parentID)
  update(next, "summary", patch.summary)
  update(next, "cost", patch.cost)
  update(next, "tokens", patch.tokens)
  share(next, patch.share?.url)
  update(next, "agent", patch.agent)
  update(next, "model", patch.model)
  update(next, "permission", patch.permission)
  update(next, "revert", patch.revert)
  set(next.time, "created", patch.time?.created)
  set(next.time, "updated", patch.time?.updated)
  update(next.time, "compacting", patch.time?.compacting)
  update(next.time, "archived", patch.time?.archived)

  return next
}

export function sessionPatchToWebview(sessionID: string, patch: SessionPatch): WebviewSessionPatch {
  return {
    id: sessionID,
    ...(patch.parentID !== undefined && { parentID: patch.parentID }),
    ...(patch.title !== undefined && patch.title !== null && { title: patch.title }),
    ...(patch.time?.created !== undefined &&
      patch.time.created !== null && { createdAt: new Date(patch.time.created).toISOString() }),
    ...(patch.time?.updated !== undefined &&
      patch.time.updated !== null && { updatedAt: new Date(patch.time.updated).toISOString() }),
    ...(patch.revert !== undefined && { revert: patch.revert }),
    ...(patch.summary !== undefined && { summary: patch.summary }),
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
  worktreeDirectories?: () => string[]
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
  const worktreeDirs = new Set([...(ctx.worktreeDirectories?.() ?? []), ...ctx.sessionDirectories.values()])
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
  forceWorkspaceRoot?: boolean
}) {
  if (input.forceWorkspaceRoot) return input.workspaceDirectory

  return resolveWorkspaceDirectory({
    sessionID: input.currentSessionID ?? input.contextSessionID,
    sessionDirectories: input.sessionDirectories,
    workspaceDirectory: input.workspaceDirectory,
  })
}

export function resolveNewSessionDirectory(input: {
  sessionID?: string
  currentSessionID?: string
  contextSessionID?: string
  agentManagerContext?: string
  contextDirectory?: string
  sessionDirectories: Map<string, string>
  workspaceDirectory: string
}) {
  if (input.sessionID) {
    return resolveWorkspaceDirectory({
      sessionID: input.sessionID,
      sessionDirectories: input.sessionDirectories,
      workspaceDirectory: input.workspaceDirectory,
    })
  }

  if (input.contextDirectory) return input.contextDirectory

  return resolveContextDirectory({
    currentSessionID: input.currentSessionID,
    contextSessionID: input.contextSessionID,
    sessionDirectories: input.sessionDirectories,
    workspaceDirectory: input.workspaceDirectory,
    forceWorkspaceRoot: input.agentManagerContext === "local",
  })
}

export function sameDirectory(a: string, b: string): boolean {
  if (!a || !b) return false

  const left = path.resolve(a)
  const right = path.resolve(b)
  if (path.relative(left, right) === "") return true

  if (process.platform !== "win32") return false
  return path.relative(left.toLowerCase(), right.toLowerCase()) === ""
}

type SyncEvent =
  | SyncEventMessageUpdated
  | SyncEventMessageRemoved
  | SyncEventMessagePartUpdated
  | SyncEventMessagePartRemoved
  | SyncEventSessionCreated
  | SyncEventSessionUpdated
  | SyncEventSessionDeleted

type StreamEvent = Event | SyncEvent

export type WebviewMessage =
  | PartUpdate
  | PartBatch
  | PartRemove
  | {
      type: "indexingStatusLoaded"
      status: IndexingStatus
    }
  | {
      type: "messageCreated"
      message: Record<string, unknown>
    }
  | { type: "sessionStatus"; sessionID: string; status: string; attempt?: number; message?: string; next?: number }
  | { type: "sessionTurnClosed"; sessionID: string; reason: "completed" | "error" | "interrupted" }
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
  | {
      type: "questionRequest"
      question: { id: string; sessionID: string; questions: unknown[]; blocking?: boolean; tool?: unknown }
    }
  | { type: "questionResolved"; requestID: string }
  | {
      type: "suggestionRequest"
      suggestion: {
        id: string
        sessionID: string
        text: string
        actions: unknown[]
        blocking?: boolean
        tool?: unknown
      }
    }
  | { type: "suggestionResolved"; requestID: string }
  | { type: "suggestionError"; requestID: string }
  | { type: "permissionResolved"; permissionID: string }
  | { type: "permissionError"; permissionID: string; stale?: boolean }
  | { type: "sessionCreated"; session: ReturnType<typeof sessionToWebview>; draftID?: string }
  | { type: "sessionUpdated"; session: WebviewSessionPatch }
  | { type: "sessionDeleted"; sessionID: string }
  | { type: "messageRemoved"; sessionID: string; messageID: string }
  | { type: "sessionError"; sessionID?: string; error?: unknown }
  | null

type PartEvent =
  | Extract<Event, { type: "message.part.delta" }>
  | SyncEventMessagePartUpdated
  | SyncEventMessagePartRemoved

function mapPartEvent(event: PartEvent, sessionID: string | undefined): WebviewMessage {
  if (event.type === "sync") {
    if (event.name === "message.part.updated.1") {
      const part = event.data.part
      return {
        type: "partUpdated",
        sessionID: event.data.sessionID,
        messageID: part.messageID,
        part,
      }
    }
    return {
      type: "partRemoved",
      sessionID: event.data.sessionID,
      messageID: event.data.messageID,
      partID: event.data.partID,
    }
  }
  if (!sessionID) return null
  const props = event.properties
  return {
    type: "partUpdated",
    sessionID: props.sessionID,
    messageID: props.messageID,
    part: { id: props.partID, type: "text", messageID: props.messageID, text: props.delta },
    delta: { type: "text-delta", textDelta: props.delta },
  }
}

export function mapSSEEventToWebviewMessage(event: StreamEvent, sessionID: string | undefined): WebviewMessage {
  if (event.type === "sync") {
    switch (event.name) {
      case "message.updated.1": {
        const info = event.data.info
        return {
          type: "messageCreated",
          message: {
            ...info,
            createdAt: new Date(info.time.created).toISOString(),
          },
        }
      }
      case "message.removed.1":
        return {
          type: "messageRemoved",
          sessionID: event.data.sessionID,
          messageID: event.data.messageID,
        }
      case "message.part.updated.1":
      case "message.part.removed.1":
        return mapPartEvent(event, sessionID)
      case "session.created.1":
        return {
          type: "sessionCreated",
          session: sessionToWebview(event.data.info),
        }
      case "session.updated.1":
        return null
      case "session.deleted.1":
        return {
          type: "sessionDeleted",
          sessionID: event.data.sessionID,
        }
    }
  }
  if (event.type === "message.part.delta") return mapPartEvent(event, sessionID)
  switch (event.type) {
    case "session.status": {
      const info = event.properties.status
      const status = info.type
      const extra =
        info.type === "retry"
          ? { attempt: info.attempt, message: info.message, next: info.next }
          : info.type === "offline"
            ? { message: info.message }
            : {}
      return {
        type: "sessionStatus" as const,
        sessionID: event.properties.sessionID,
        status,
        ...extra,
      }
    }
    case "session.turn.close":
      return {
        type: "sessionTurnClosed",
        sessionID: event.properties.sessionID,
        reason: event.properties.reason,
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
          blocking: event.properties.blocking,
          tool: event.properties.tool,
        },
      }
    case "question.replied":
    case "question.rejected":
      return {
        type: "questionResolved",
        requestID: event.properties.requestID,
      }
    case "suggestion.shown":
      return {
        type: "suggestionRequest",
        suggestion: {
          id: event.properties.id,
          sessionID: event.properties.sessionID,
          text: event.properties.text,
          actions: event.properties.actions,
          blocking: event.properties.blocking,
          tool: event.properties.tool,
        },
      }
    case "suggestion.accepted":
    case "suggestion.dismissed":
      return {
        type: "suggestionResolved",
        requestID: event.properties.requestID,
      }
    case "session.error": {
      return {
        type: "sessionError",
        sessionID: event.properties.sessionID,
        error: event.properties.error,
      }
    }
    case "indexing.status":
      return {
        type: "indexingStatusLoaded",
        status: event.properties.status,
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
export function isEventFromForeignProject(event: StreamEvent, expectedProjectID: string | undefined): boolean {
  if (!expectedProjectID || event.type !== "sync") return false
  if (event.name === "session.created.1" || event.name === "session.deleted.1") {
    return event.data.info.projectID !== expectedProjectID
  }
  if (event.name !== "session.updated.1") return false
  const project = event.data.info.projectID
  return project !== undefined && project !== expectedProjectID
}
