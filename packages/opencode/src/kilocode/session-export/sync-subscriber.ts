import type { ExportEvent, FeedbackCaptured, PermissionDecided, TerminalOutcome, ToolExecuted } from "./events"
import { ulid } from "./ulid"

export type SyncSubscriberDeps = {
  isEligibleSession: (sessionId: string) => boolean
  dispatch: (envelope: ExportEvent) => void
  agentVersion: string
  now: () => number
  syncSeq: () => number
}

type SyncLike = { type: string; aggregateID?: string; seq?: number; data?: unknown; properties?: unknown }

export class SyncSubscriber {
  constructor(private readonly deps: SyncSubscriberDeps) {}

  onSyncEvent(event: SyncLike): void {
    const data = record(event.data ?? event.properties)
    const sessionId = text(event.aggregateID) ?? text(data.sessionID)
    if (!sessionId) return
    if (!this.deps.isEligibleSession(sessionId)) return

    switch (event.type) {
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
    const tool: ToolExecuted = {
      id: ulid(),
      schemaVersion: 1,
      type: "tool_executed",
      sessionId,
      rootSessionId: sessionId,
      seq: this.deps.syncSeq(),
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
      durationMs: Math.max(0, end - start),
      retryCount: 0,
    }
    this.deps.dispatch(tool)

    if (toolName === "bash" || toolName === "shell") {
      const meta = record(state.metadata)
      const term: TerminalOutcome = {
        id: ulid(),
        schemaVersion: 1,
        type: "terminal_outcome",
        sessionId,
        rootSessionId: sessionId,
        seq: this.deps.syncSeq(),
        ts: this.deps.now(),
        agentVersion: this.deps.agentVersion,
        toolCallId: text(part.callID) ?? "",
        exitCode: number(meta.exit) ?? number(meta.exitCode) ?? 0,
        signal: text(meta.signal),
        durationMs: Math.max(0, end - start),
      }
      this.deps.dispatch(term)
    }
  }

  private handlePermission(sessionId: string, data: Record<string, unknown>): void {
    const reply = record(data.reply)
    const decision = text(reply.response) === "once" || text(reply.response) === "always" ? "allow" : "deny"
    const env: PermissionDecided = {
      id: ulid(),
      schemaVersion: 1,
      type: "permission_decided",
      sessionId,
      rootSessionId: sessionId,
      seq: this.deps.syncSeq(),
      ts: this.deps.now(),
      agentVersion: this.deps.agentVersion,
      toolName: text(data.permission) ?? "",
      decision,
      reason: text(reply.message),
      durationToDecideMs: 0,
    }
    this.deps.dispatch(env)
  }

  private handleFeedback(sessionId: string, data: Record<string, unknown>): void {
    const rating = text(data.rating) === "down" ? "down" : "up"
    const env: FeedbackCaptured = {
      id: ulid(),
      schemaVersion: 1,
      type: "feedback_captured",
      sessionId,
      rootSessionId: sessionId,
      seq: this.deps.syncSeq(),
      ts: this.deps.now(),
      agentVersion: this.deps.agentVersion,
      messageId: text(data.messageID) ?? text(data.messageId) ?? "",
      rating,
      previousRating: text(data.previousRating) === "down" ? "down" : text(data.previousRating) === "up" ? "up" : undefined,
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
