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
  const extra = await Promise.all(
    [...worktreeDirs].map((dir) =>
      list(dir).catch((err: unknown) => {
        console.error(`[Kilo] Failed to list sessions for ${dir}:`, err)
        return [] as Session[]
      }),
    ),
  )
  const seen = new Set(sessions.map((s) => s.id))
  for (const batch of extra) {
    for (const s of batch) {
      if (!seen.has(s.id) && (!projectID || s.projectID === projectID)) {
        sessions.push(s)
        seen.add(s.id)
      }
    }
  }

  ctx.postMessage({
    type: "sessionsLoaded",
    sessions: sessions.map((s) => sessionToWebview(s)),
  })

  return sessions[0]?.projectID
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

export type WebviewMessage =
  | {
      type: "partUpdated"
      sessionID: string
      messageID: string
      part: unknown
      delta?: { type: "text-delta"; textDelta: string }
    }
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
  | { type: "sessionCreated"; session: ReturnType<typeof sessionToWebview> }
  | { type: "sessionUpdated"; session: ReturnType<typeof sessionToWebview> }
  | { type: "messageRemoved"; sessionID: string; messageID: string }
  | { type: "sessionError"; sessionID?: string; error?: unknown }
  | null

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
      return {
        type: "sessionStatus",
        sessionID: event.properties.sessionID,
        status: info.type,
        ...(info.type === "retry" ? { attempt: info.attempt, message: info.message, next: info.next } : {}),
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
