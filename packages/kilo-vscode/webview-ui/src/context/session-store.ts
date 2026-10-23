import type {
  Message,
  ModelSelection,
  ModelUsageMap,
  Part,
  SessionCloseReason,
  SessionInfo,
  SessionModelUsage,
  TodoItem,
  ToolPart,
} from "../types/messages"

/** Store structure for messages and parts. */
export interface SessionStore {
  sessions: Record<string, SessionInfo>
  messages: Record<string, Message[]> // sessionID -> messages
  parts: Record<string, Part[]> // messageID -> parts
  toolParts: Record<string, ToolPart[]> // sessionID -> compact per-session tool index
  todos: Record<string, TodoItem[]> // sessionID -> todos
  sessionOverrides: Record<string, Record<string, ModelSelection>> // scope -> agent -> explicit model pick
  agentSelections: Record<string, string> // sessionID -> agent name
  variantSelections: Record<string, string> // session/agent scoped variant key -> variant name
  recentModels: ModelSelection[]
  favoriteModels: ModelSelection[]
  modelUsageHistory: ModelUsageMap
  modelUsage: Record<string, { requestID: string; data?: SessionModelUsage }>
}

export interface CloseState {
  reason: SessionCloseReason
  parentID?: string
  eventID?: string
  seen?: boolean
}
