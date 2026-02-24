import type { SessionInfo, AgentInfo, Provider, SSEEvent } from "./services/cli-backend/types"

export function sessionToWebview(session: SessionInfo) {
  return {
    id: session.id,
    title: session.title,
    createdAt: new Date(session.time.created).toISOString(),
    updatedAt: new Date(session.time.updated).toISOString(),
  }
}

export function normalizeProviders(all: Record<string, Provider>): Record<string, Provider> {
  const normalized: Record<string, Provider> = {}
  for (const provider of Object.values(all)) {
    normalized[provider.id] = provider
  }
  return normalized
}

export function filterVisibleAgents(agents: AgentInfo[]): { visible: AgentInfo[]; defaultAgent: string } {
  const visible = agents.filter((a) => a.mode !== "subagent" && !a.hidden)
  const defaultAgent = visible.length > 0 ? visible[0]!.name : "code"
  return { visible, defaultAgent }
}

export function buildSettingPath(key: string): { section: string; leaf: string } {
  const parts = key.split(".")
  const section = parts.slice(0, -1).join(".")
  const leaf = parts[parts.length - 1]!
  return { section, leaf }
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
        args: Record<string, unknown>
        message: string
        tool?: { messageID: string; callID: string }
      }
    }
  | { type: "todoUpdated"; sessionID: string; items: unknown[] }
  | { type: "questionRequest"; question: { id: string; sessionID: string; questions: unknown[]; tool?: unknown } }
  | { type: "questionResolved"; requestID: string }
  | { type: "sessionCreated"; session: ReturnType<typeof sessionToWebview> }
  | { type: "sessionUpdated"; session: ReturnType<typeof sessionToWebview> }
  | null

export function mapSSEEventToWebviewMessage(event: SSEEvent, sessionID: string | undefined): WebviewMessage {
  switch (event.type) {
    case "message.part.updated": {
      const part = event.properties.part as { messageID?: string; sessionID?: string }
      if (!sessionID) return null
      return {
        type: "partUpdated",
        sessionID,
        messageID: part.messageID || "",
        part: event.properties.part,
        delta: event.properties.delta ? { type: "text-delta", textDelta: event.properties.delta } : undefined,
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
          args: event.properties.metadata,
          message: `Permission required: ${event.properties.permission}`,
          tool: event.properties.tool,
        },
      }
    case "todo.updated":
      return {
        type: "todoUpdated",
        sessionID: event.properties.sessionID,
        items: event.properties.items,
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
