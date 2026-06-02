import type { ExportEvent, FeedbackCaptured, PermissionDecided, ToolExecuted } from "./events"
import { ulid } from "ulid"

export type SyncSubscriberDeps = {
  isEligibleSession: (sessionId: string) => boolean
  dispatch: (envelope: ExportEvent) => void
  agentVersion: string
  now: () => number
  syncSeq: (sessionId: string) => number
  getTurnId?: (sessionId: string) => string | undefined
  getRootSessionId?: (sessionId: string) => string | undefined
}

type SyncLike = { type: string; aggregateID?: string; seq?: number; data?: unknown; properties?: unknown }

export class SyncSubscriber {
  private permissions = new Map<string, { sessionId: string; toolName: string; started: number }>()

  constructor(private readonly deps: SyncSubscriberDeps) {}

  onSyncEvent(event: SyncLike): void {
    const data = record(event.data ?? event.properties)
    const sessionId = text(event.aggregateID) ?? text(data.sessionID)
    if (!sessionId) return
    if (!this.deps.isEligibleSession(sessionId)) return

    switch (event.type) {
      case "permission.asked":
        this.handlePermissionAsked(sessionId, data)
        return
      case "message.part.updated":
        this.handlePart(sessionId, data)
        return
      case "permission.replied":
        this.handlePermission(sessionId, data)
        return
      case "session.feedback":
        this.handleFeedback(sessionId, data)
        return
      default:
        return
    }
  }

  private handlePermissionAsked(sessionId: string, data: Record<string, unknown>): void {
    const id = text(data.id) ?? text(data.requestID) ?? text(data.requestId)
    if (!id) return
    this.permissions.set(id, {
      sessionId,
      toolName: text(data.permission) ?? text(record(data.metadata).tool) ?? "",
      started: this.deps.now(),
    })
  }

  private handlePart(sessionId: string, data: Record<string, unknown>): void {
    const part = record(data.part)
    const state = record(part.state)
    if (part.type !== "tool") return
    if (state.status !== "completed" && state.status !== "error") return

    const toolName = text(part.tool) ?? text(part.toolName) ?? ""
    const start = number(record(state.time).start) ?? this.deps.now()
    const end = number(record(state.time).end) ?? this.deps.now()
    const output = text(state.output)
    const input = state.input
    const meta = record(state.metadata)
    const shell = toolName === "bash" || toolName === "shell"
    const seq = this.deps.syncSeq(sessionId)
    const tool: ToolExecuted = {
      id: ulid(),
      schemaVersion: 1,
      type: "tool_executed",
      sessionId,
      rootSessionId: this.deps.getRootSessionId?.(sessionId) ?? sessionId,
      turnId: this.deps.getTurnId?.(sessionId),
      seq,
      eventSeq: seq,
      ts: this.deps.now(),
      agentVersion: this.deps.agentVersion,
      toolCallId: text(part.callID) ?? "",
      toolName,
      source: text(part.source) === "mcp" ? "mcp" : "builtin",
      mcpServer: text(part.mcpServer),
      inputChunkIds: [],
      outputChunkIds: [],
      toolInput: input,
      toolOutput: output,
      errorCode: text(state.error),
      exitCode: shell ? (number(meta.exit) ?? number(meta.exitCode) ?? 0) : undefined,
      signal: shell ? text(meta.signal) : undefined,
      durationMs: Math.max(0, end - start),
      retryCount: 0,
    }
    this.deps.dispatch(tool)
  }

  private handlePermission(sessionId: string, data: Record<string, unknown>): void {
    const request = text(data.requestID) ?? text(data.requestId)
    const asked = request ? this.permissions.get(request) : undefined
    if (request) this.permissions.delete(request)
    const reply = text(data.reply)
    const decision = reply === "always" ? "always_allow" : reply === "once" ? "allow" : "deny"
    const seq = this.deps.syncSeq(sessionId)
    const env: PermissionDecided = {
      id: ulid(),
      schemaVersion: 1,
      type: "permission_decided",
      sessionId,
      rootSessionId: this.deps.getRootSessionId?.(sessionId) ?? sessionId,
      turnId: this.deps.getTurnId?.(sessionId),
      seq,
      eventSeq: seq,
      ts: this.deps.now(),
      agentVersion: this.deps.agentVersion,
      toolName: text(data.permission) ?? asked?.toolName ?? "",
      decision,
      durationToDecideMs: Math.max(0, this.deps.now() - (asked?.started ?? this.deps.now())),
    }
    this.deps.dispatch(env)
  }

  private handleFeedback(sessionId: string, data: Record<string, unknown>): void {
    const rating = text(data.rating) === "down" ? "down" : "up"
    const seq = this.deps.syncSeq(sessionId)
    const env: FeedbackCaptured = {
      id: ulid(),
      schemaVersion: 1,
      type: "feedback_captured",
      sessionId,
      rootSessionId: this.deps.getRootSessionId?.(sessionId) ?? sessionId,
      turnId: this.deps.getTurnId?.(sessionId),
      seq,
      eventSeq: seq,
      ts: this.deps.now(),
      agentVersion: this.deps.agentVersion,
      messageId: text(data.messageID) ?? text(data.messageId) ?? "",
      rating,
      previousRating:
        text(data.previousRating) === "down" ? "down" : text(data.previousRating) === "up" ? "up" : undefined,
    }
    this.deps.dispatch(env)
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value
}

function number(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return value
}
