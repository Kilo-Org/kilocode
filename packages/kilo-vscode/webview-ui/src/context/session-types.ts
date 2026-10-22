import type { Accessor } from "solid-js"
import type {
  AgentInfo,
  ContextUsage,
  FileAttachment,
  Message,
  ModelSelection,
  Part,
  PermissionRequest,
  QuestionRequest,
  SessionCloseReason,
  SessionInfo,
  SessionStatus,
  SessionStatusInfo,
  SkillInfo,
  SendMessageRequest,
  TodoItem,
  ToolPart,
} from "../types/messages"
import type { Activity } from "../utils/session-activity"
import type { Timing } from "./session-timing"
import type { MessageMutation } from "./session-utils"

export interface SessionContextValue {
  // Current session
  currentSessionID: Accessor<string | undefined>
  currentSession: Accessor<SessionInfo | undefined>
  setCurrentSessionID: (id: string | undefined) => void

  // All sessions (sorted most recent first)
  sessions: Accessor<SessionInfo[]>
  // Project whose session list is complete enough for absence-based tab cleanup.
  sessionsProject: Accessor<string | undefined>

  // Session status
  status: Accessor<SessionStatus>
  statusInfo: Accessor<SessionStatusInfo>
  closeReason: Accessor<SessionCloseReason | undefined>
  statusText: Accessor<string | undefined>
  busyTiming: Accessor<Timing | undefined>
  submitting: Accessor<boolean>
  isSubmitting: (id: string) => boolean
  loading: Accessor<boolean>
  loadingOlderMessages: Accessor<boolean>
  hasOlderMessages: Accessor<boolean>
  messageMutation: Accessor<MessageMutation | undefined>

  // Messages for current session
  messages: Accessor<Message[]>

  // Messages for current session with soft-reverted turns hidden
  visibleMessages: Accessor<Message[]>

  // User messages for current session (role === "user")
  userMessages: Accessor<Message[]>

  // All messages keyed by sessionID (includes child sessions)
  allMessages: () => Record<string, Message[]>

  // All parts keyed by messageID (includes child sessions)
  allParts: () => Record<string, Part[]>

  // All session statuses keyed by sessionID (for DataBridge)
  allStatusMap: () => Record<string, SessionStatusInfo>

  activityFor: (sessionID: string | undefined) => Activity
  acknowledge: (sessionID: string) => void
  inUseFor: (sessionID: string) => boolean

  // Parts for a specific message
  getParts: (messageID: string) => Part[]

  // Tool parts for a specific session, maintained incrementally for streaming views
  getSessionToolParts: (sessionID: string) => ToolPart[]
  getSessionToolCount: (sessionID: string) => number

  // Hidden after model changes so switching models can clear stale provider errors
  // without removing messages and their checkpoint restore actions.
  isErrorHidden: (messageID: string) => boolean

  // Move stashed parts into the reactive store for the given message IDs.
  hydrateParts: (messageIDs: string[]) => void

  // Todos for current session
  todos: Accessor<TodoItem[]>

  // Pending permission requests (unscoped — all tracked sessions)
  permissions: Accessor<PermissionRequest[]>
  respondingPermissions: Accessor<Set<string>>

  // Pending question requests (unscoped — all tracked sessions)
  questions: Accessor<QuestionRequest[]>
  questionErrors: Accessor<Set<string>>

  // Scoped permissions/questions — filtered to a session's family (self + subagents)
  scopedPermissions: (sessionID: string | undefined) => PermissionRequest[]
  scopedQuestions: (sessionID: string | undefined) => QuestionRequest[]

  // Model selection (per-scope picks over per-agent config)
  selected: (sessionID?: string) => ModelSelection | null
  modelForAgent: (agent: string) => ModelSelection | null
  selectModel: (providerID: string, modelID: string, sessionID?: string) => void
  trackScopes: (ids: Accessor<readonly string[]>) => () => void

  // Cost and context usage for the current session
  costBreakdown: Accessor<Array<{ label: string; cost: number }>>
  contextUsage: Accessor<ContextUsage | undefined>

  // Skills loaded from the CLI backend
  skills: Accessor<SkillInfo[]>
  refreshSkills: () => void

  // Agent/mode selection (per-session)
  agents: Accessor<AgentInfo[]>
  allAgents: Accessor<AgentInfo[]>
  selectedAgent: (sessionID?: string) => string
  submission: (sessionID?: string) => { model?: ModelSelection; variant?: string; agent?: string }
  selectAgent: (name: string, sessionID?: string) => void
  getSessionAgent: (sessionID: string) => string
  setSessionModel: (sessionID: string, providerID: string, modelID: string) => void
  setSessionAgent: (sessionID: string, name: string) => void
  setSessionVariant: (sessionID: string, providerID: string, modelID: string, value: string, agent?: string) => void

  // Thinking variant for the selected model
  variantList: (sessionID?: string) => string[]
  currentVariant: (sessionID?: string) => string | undefined
  variantForAgent: (agent: string, model: ModelSelection | null) => string | undefined
  variantPreference: (agent: string, model: ModelSelection | null) => string | undefined
  selectVariant: (value: string | undefined, sessionID?: string) => void

  // Model favorites
  recentModels: Accessor<ModelSelection[]>
  favoriteModels: Accessor<ModelSelection[]>
  toggleFavorite: (providerID: string, modelID: string) => void

  // Revert/undo state for the current session
  revert: Accessor<SessionInfo["revert"]>
  summary: Accessor<SessionInfo["summary"]>

  // Actions
  submit: (input: SendMessageRequest) => void
  sendMessage: (
    text: string,
    providerID?: string,
    modelID?: string,
    files?: FileAttachment[],
    draftID?: string,
    origin?: string | null,
    injectedTitle?: string,
  ) => boolean
  sendCommand: (
    command: string,
    args: string,
    providerID?: string,
    modelID?: string,
    files?: FileAttachment[],
    draftID?: string,
    origin?: string | null,
    overrides?: { agent?: string; model?: string; variant?: string; messageID?: string },
  ) => boolean
  abort: () => void
  compact: () => void
  respondToPermission: (
    permissionId: string,
    response: "once" | "always" | "reject",
    approvedAlways: string[],
    deniedAlways: string[],
    feedback?: string,
  ) => boolean
  replyToQuestion: (requestID: string, answers: string[][]) => void
  rejectQuestion: (requestID: string) => void
  closeQuestion: (requestID: string) => void
  createSession: () => void
  clearCurrentSession: () => void
  loadSessions: () => void
  loadMoreSessions: () => void
  sessionsHasMore: Accessor<boolean>
  /** Keep these sessions in the store when a full load lists only its first page. */
  keepSessions: (ids: Accessor<readonly string[]>) => () => void
  sessionsLoadingMore: Accessor<boolean>
  loadOlderMessages: () => boolean
  selectSession: (id: string, options?: { focus?: boolean; scrollToBottom?: boolean }) => void
  scrollBottomID: Accessor<string | undefined>
  consumeScrollBottom: (id: string) => boolean
  releaseSession: (id: string) => void
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  exportSessionTranscript: (id: string) => void
  forkSession: (sessionID: string, messageID: string) => void
  syncSession: (sessionID: string, parentSessionID?: string, scope?: "task" | "inspector") => void
  unsyncSession: (sessionID: string, scope?: "task" | "inspector") => void
  draftSessionID: Accessor<string | undefined>
  setDraftSessionID: (id: string | undefined) => void
  userClearedSession: Accessor<boolean>
}
