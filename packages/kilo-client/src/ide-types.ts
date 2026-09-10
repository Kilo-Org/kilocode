// Existing Kilo UI view contracts, selected unchanged from Kilo d99662338e3ddbd2613ab41fc0369837a6eb4be9.
// Type-only compatibility boundary; no v1 SDK runtime or server routes are included.

export type Event =
  | EventModelsDevRefreshed1
  | EventIntegrationUpdated1
  | EventIntegrationConnectionUpdated1
  | EventCatalogUpdated1
  | EventSessionCreated1
  | EventSessionUpdated1
  | EventSessionDeleted1
  | EventMessageUpdated1
  | EventMessageRemoved1
  | EventMessagePartUpdated1
  | EventMessagePartRemoved1
  | EventSessionNextAgentSwitched1
  | EventSessionNextModelSwitched1
  | EventSessionNextMoved1
  | EventSessionNextPrompted1
  | EventSessionNextPromptAdmitted1
  | EventSessionNextContextUpdated1
  | EventSessionNextSynthetic1
  | EventSessionNextShellStarted1
  | EventSessionNextShellEnded1
  | EventSessionNextStepStarted1
  | EventSessionNextStepEnded1
  | EventSessionNextStepFailed1
  | EventSessionNextTextStarted1
  | EventSessionNextTextDelta1
  | EventSessionNextTextEnded1
  | EventSessionNextReasoningStarted1
  | EventSessionNextReasoningDelta1
  | EventSessionNextReasoningEnded1
  | EventSessionNextToolInputStarted1
  | EventSessionNextToolInputDelta1
  | EventSessionNextToolInputEnded1
  | EventSessionNextToolCalled1
  | EventSessionNextToolProgress1
  | EventSessionNextToolSuccess1
  | EventSessionNextToolFailed1
  | EventSessionNextRetried1
  | EventSessionNextCompactionStarted1
  | EventSessionNextCompactionDelta1
  | EventSessionNextCompactionEnded1
  | EventSessionNextRevertStaged1
  | EventSessionNextRevertCleared1
  | EventSessionNextRevertCommitted1
  | EventMessagePartDelta1
  | EventSessionDiff1
  | EventSessionError1
  | EventInstallationUpdated1
  | EventInstallationUpdateAvailable1
  | EventFileEdited1
  | EventReferenceUpdated1
  | EventPermissionV2Asked1
  | EventPermissionV2Replied1
  | EventPluginAdded1
  | EventProjectDirectoriesUpdated1
  | EventFileWatcherUpdated1
  | EventPtyCreated1
  | EventPtyUpdated1
  | EventPtyExited1
  | EventPtyDeleted1
  | EventQuestionV2Asked1
  | EventQuestionV2Replied1
  | EventQuestionV2Rejected1
  | EventTodoUpdated1
  | EventLspUpdated1
  | EventPermissionAsked1
  | EventPermissionReplied1
  | EventTuiPromptAppend1
  | EventTuiCommandExecute1
  | EventTuiToastShow1
  | EventTuiSessionSelect1
  | EventMcpToolsChanged1
  | EventMcpBrowserOpenFailed1
  | EventCommandExecuted1
  | EventProjectUpdated1
  | EventSessionStatus1
  | EventSessionIdle1
  | EventQuestionAsked1
  | EventQuestionReplied1
  | EventQuestionRejected1
  | EventSessionCompacted1
  | EventVcsBranchUpdated1
  | EventWorkspaceReady1
  | EventWorkspaceFailed1
  | EventWorkspaceStatus1
  | EventWorktreeReady1
  | EventWorktreeFailed1
  | EventServerConnected1
  | EventGlobalDisposed1
  | EventGlobalConfigUpdated1
  | EventServerInstanceDisposed
  | EventSessionTurnOpen
  | EventSessionTurnClose
  | EventSessionQueueChanged
  | EventSessionNetworkAsked
  | EventSessionNetworkReplied
  | EventSessionNetworkRejected
  | EventSessionNetworkRestored
  | EventBackgroundProcessUpdated
  | EventBackgroundProcessDeleted
  | EventInteractiveTerminalUpdated
  | EventInteractiveTerminalData
  | EventInteractiveTerminalDeleted
  | EventSandboxStatusChanged
  | EventLspClientDiagnostics
  | EventSuggestionShown
  | EventSuggestionAccepted
  | EventSuggestionDismissed
  | EventKilocodeAgentManagerStart
  | EventKilocodeAgentManagerRequested
  | EventKilocodeAgentManagerCancelled
  | EventKilocodeNotebookRequested
  | EventKilocodeNotebookCancelled
  | EventKiloSessionsRemoteStatusChanged
  | EventMemoryStatus1
  | EventMemoryUpdated1
  | EventMemoryError1
  | EventIndexingStatus
  | EventIndexingWarning
  | EventModelsDevRefreshed
  | EventIntegrationUpdated
  | EventIntegrationConnectionUpdated
  | EventCatalogUpdated
  | EventSessionCreated
  | EventSessionUpdated
  | EventSessionDeleted
  | EventMessageUpdated
  | EventMessageRemoved
  | EventMessagePartUpdated
  | EventMessagePartRemoved
  | EventSessionNextAgentSwitched
  | EventSessionNextModelSwitched
  | EventSessionNextMoved
  | EventSessionNextPrompted
  | EventSessionNextPromptAdmitted
  | EventSessionNextContextUpdated
  | EventSessionNextSynthetic
  | EventSessionNextShellStarted
  | EventSessionNextShellEnded
  | EventSessionNextStepStarted
  | EventSessionNextStepEnded
  | EventSessionNextStepFailed
  | EventSessionNextTextStarted
  | EventSessionNextTextDelta
  | EventSessionNextTextEnded
  | EventSessionNextReasoningStarted
  | EventSessionNextReasoningDelta
  | EventSessionNextReasoningEnded
  | EventSessionNextToolInputStarted
  | EventSessionNextToolInputDelta
  | EventSessionNextToolInputEnded
  | EventSessionNextToolCalled
  | EventSessionNextToolProgress
  | EventSessionNextToolSuccess
  | EventSessionNextToolFailed
  | EventSessionNextRetried
  | EventSessionNextCompactionStarted
  | EventSessionNextCompactionDelta
  | EventSessionNextCompactionEnded
  | EventSessionNextRevertStaged
  | EventSessionNextRevertCleared
  | EventSessionNextRevertCommitted
  | EventMessagePartDelta
  | EventSessionDiff
  | EventSessionError
  | EventInstallationUpdated
  | EventInstallationUpdateAvailable
  | EventFileEdited
  | EventReferenceUpdated
  | EventPermissionV2Asked
  | EventPermissionV2Replied
  | EventPluginAdded
  | EventProjectDirectoriesUpdated
  | EventFileWatcherUpdated
  | EventPtyCreated
  | EventPtyUpdated
  | EventPtyExited
  | EventPtyDeleted
  | EventQuestionV2Asked
  | EventQuestionV2Replied
  | EventQuestionV2Rejected
  | EventTodoUpdated
  | EventLspUpdated
  | EventPermissionAsked
  | EventPermissionReplied
  | EventTuiPromptAppend
  | EventTuiCommandExecute
  | EventTuiToastShow22
  | EventTuiSessionSelect
  | EventMcpToolsChanged
  | EventMcpBrowserOpenFailed
  | EventCommandExecuted
  | EventProjectUpdated
  | EventSessionStatus
  | EventSessionIdle
  | EventQuestionAsked
  | EventQuestionReplied
  | EventQuestionRejected
  | EventSessionCompacted
  | EventVcsBranchUpdated
  | EventWorkspaceReady
  | EventWorkspaceFailed
  | EventWorkspaceStatus
  | EventWorktreeReady
  | EventWorktreeFailed
  | EventServerConnected
  | EventGlobalDisposed
  | EventGlobalConfigUpdated

export type SessionNetworkWait = {
  id: string
  sessionID: string
  message: string
  restored: boolean
  time: {
    created: number
    restored?: number
  }
}

export type BackgroundProcessInfo = {
  id: string
  sessionID: string
  pid?: number
  command: string
  cwd: string
  description?: string
  ports: Array<number>
  status: "starting" | "running" | "ready" | "exited" | "failed" | "stopping" | "stopped"
  lifetime: "session" | "parent" | "persistent"
  ready: boolean
  exitCode?: number
  signal?: string
  output: string
  time: {
    started: number
    updated: number
    ended?: number
  }
}

export type InteractiveTerminalInfo = {
  id: string
  sessionID: string
  pid: number
  command: string
  cwd: string
  description?: string
  status: "running" | "closed"
  cols: number
  rows: number
  exitCode?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
  signal?: string
  closedBy?: "exit" | "user" | "abort"
  time: {
    started: number
    updated: number
    ended?: number
  }
}

export type SuggestionRequest = {
  id: string
  sessionID: string
  text: string
  actions: Array<{
    /**
     * Button or option label (1-5 words)
     */
    label: string
    description?: string
    /**
     * Synthetic user prompt to inject when this action is accepted
     */
    prompt: string
  }>
  blocking?: boolean
  tool?: {
    messageID: string
    callID: string
  }
}

export type AgentManagerRequestId = string

export type AgentManagerFilterState = "idle" | "busy" | "retry" | "offline" | "waiting"

export type AgentManagerOverviewFilter = {
  sectionIDs?: Array<string>
  states?: Array<AgentManagerFilterState>
}

export type AgentManagerOverviewRequest = {
  id: AgentManagerRequestId
  sessionID: string
  operation: "overview"
  filter?: AgentManagerOverviewFilter
}

export type AgentManagerPromptRequest = {
  id: AgentManagerRequestId
  sessionID: string
  operation: "prompt"
  targetSessionID: string
  prompt: string
}

export type AgentManagerStopRequest = {
  id: AgentManagerRequestId
  sessionID: string
  operation: "stop"
  targetSessionID: string
}

export type AgentManagerMoveRequest = {
  id: AgentManagerRequestId
  sessionID: string
  operation: "move"
  targetSessionID: string
  sectionID: string | null
}

export type AgentManagerRequest =
  | AgentManagerOverviewRequest
  | AgentManagerPromptRequest
  | AgentManagerStopRequest
  | AgentManagerMoveRequest

export type NotebookRequestId = string

export type NotebookReadRequest = {
  id: NotebookRequestId
  sessionID: string
  path: string
  operation: "read"
  includeOutputs: boolean
}

export type NotebookEditRequest = {
  id: NotebookRequestId
  sessionID: string
  path: string
  operation: "edit"
  /**
   * Opaque notebook content revision; pass it back unchanged and do not parse or increment it
   */
  expectedRevision?: string
  /**
   * Zero-based cell index
   */
  index: number
  edit:
    | {
        action: "insert"
        kind: "code" | "markdown"
        language?: string
        source: string
      }
    | {
        action: "replace"
        kind: "code" | "markdown"
        language?: string
        source: string
      }
    | {
        action: "delete"
      }
    | {
        action: "create"
      }
}

export type NotebookExecuteRequest = {
  id: NotebookRequestId
  sessionID: string
  path: string
  operation: "execute"
  /**
   * Opaque notebook content revision; pass it back unchanged and do not parse or increment it
   */
  expectedRevision: string
  /**
   * Zero-based cell index
   */
  index: number
}

export type NotebookRequest = NotebookReadRequest | NotebookEditRequest | NotebookExecuteRequest

export type IndexingStatusState = "Disabled" | "In Progress" | "Complete" | "Error" | "Standby"

export type IndexingStatus = {
  state: IndexingStatusState
  message: string
  processedFiles: number
  totalFiles: number
  percent: number
}

export type IndexingWarning = {
  code: "qdrant.version-incompatible" | "qdrant.version-unavailable"
  message: string
}

export type SnapshotFileDiff = {
  file?: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export type PermissionAction = "allow" | "deny" | "ask"

export type PermissionRule = {
  permission: string
  pattern: string
  action: PermissionAction
}

export type PermissionRuleset = Array<PermissionRule>

export type Session = {
  id: string
  slug: string
  projectID: string
  workspaceID?: string
  directory: string
  path?: string
  parentID?: string
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: Array<SnapshotFileDiff>
  }
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  share?: {
    url: string
  }
  title: string
  agent?: string
  model?: {
    id: string
    providerID: string
    variant?: string
  }
  version: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
  permission?: PermissionRuleset
  revert?: {
    messageID: string
    partID?: string
    snapshot?: string
    diff?: string
  }
}

export type OutputFormatText = {
  type: "text"
}

export type JsonSchema = {
  [key: string]: unknown
}

export type OutputFormatJsonSchema = {
  type: "json_schema"
  schema: JsonSchema
  retryCount?: number
}

export type OutputFormat = OutputFormatText | OutputFormatJsonSchema

export type UserMessage = {
  id: string
  sessionID: string
  role: "user"
  time: {
    created: number
  }
  format?: OutputFormat
  summary?: {
    title?: string
    body?: string
    diffs: Array<SnapshotFileDiff>
  }
  agent: string
  model: {
    providerID: string
    modelID: string
    variant?: string
  }
  system?: string
  tools?: {
    [key: string]: boolean
  }
  editorContext?: {
    directory?: string
    worktree?: string
    visibleFiles?: Array<string>
    openTabs?: Array<string>
    activeFile?: string
    shell?: string
  }
}

export type ProviderAuthError = {
  name: "ProviderAuthError"
  data: {
    providerID: string
    message: string
  }
}

export type UnknownError = {
  name: "UnknownError"
  data: {
    message: string
    ref?: string
  }
}

export type MessageOutputLengthError = {
  name: "MessageOutputLengthError"
  data: {
    [key: string]: unknown
  }
}

export type MessageAbortedError = {
  name: "MessageAbortedError"
  data: {
    message: string
  }
}

export type StructuredOutputError = {
  name: "StructuredOutputError"
  data: {
    message: string
    retries: number
  }
}

export type ContextOverflowError = {
  name: "ContextOverflowError"
  data: {
    message: string
    responseBody?: string
  }
}

export type ContentFilterError = {
  name: "ContentFilterError"
  data: {
    message: string
  }
}

export type ApiError = {
  name: "APIError"
  data: {
    message: string
    statusCode?: number
    isRetryable: boolean
    responseHeaders?: {
      [key: string]: string
    }
    responseBody?: string
    metadata?: {
      [key: string]: string
    }
  }
}

export type AssistantMessage = {
  id: string
  sessionID: string
  role: "assistant"
  time: {
    created: number
    completed?: number
  }
  error?:
    | ProviderAuthError
    | UnknownError
    | MessageOutputLengthError
    | MessageAbortedError
    | StructuredOutputError
    | ContextOverflowError
    | ContentFilterError
    | ApiError
  parentID: string
  modelID: string
  providerID: string
  mode: string
  agent: string
  path: {
    cwd: string
    root: string
  }
  summary?: boolean
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  structured?: unknown
  variant?: string
  finish?: string
}

export type Message = UserMessage | AssistantMessage

export type TextPart = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: {
    start: number
    end?: number
  }
  metadata?: {
    [key: string]: unknown
  }
}

export type SubtaskPart = {
  id: string
  sessionID: string
  messageID: string
  type: "subtask"
  prompt: string
  description: string
  agent: string
  model?: {
    providerID: string
    modelID: string
  }
  variant?: string
  command?: string
}

export type ReasoningPart = {
  id: string
  sessionID: string
  messageID: string
  type: "reasoning"
  text: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    start: number
    end?: number
  }
}

export type FilePartSourceText = {
  value: string
  start: number
  end: number
}

export type FileSource = {
  text: FilePartSourceText
  type: "file"
  path: string
}

export type Range = {
  start: {
    line: number
    character: number
  }
  end: {
    line: number
    character: number
  }
}

export type SymbolSource = {
  text: FilePartSourceText
  type: "symbol"
  path: string
  range: Range
  name: string
  kind: number
}

export type ResourceSource = {
  text: FilePartSourceText
  type: "resource"
  clientName: string
  uri: string
}

export type FilePartSource = FileSource | SymbolSource | ResourceSource

export type FilePart = {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: FilePartSource
}

export type ToolStatePending = {
  status: "pending"
  input: {
    [key: string]: unknown
  }
  raw: string
}

export type ToolStateRunning = {
  status: "running"
  input: {
    [key: string]: unknown
  }
  title?: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    start: number
  }
}

export type ToolStateCompleted = {
  status: "completed"
  input: {
    [key: string]: unknown
  }
  output: string
  title: string
  metadata: {
    [key: string]: unknown
  }
  time: {
    start: number
    end: number
    compacted?: number
  }
  attachments?: Array<FilePart>
}

export type ToolStateError = {
  status: "error"
  input: {
    [key: string]: unknown
  }
  error: string
  metadata?: {
    [key: string]: unknown
  }
  time: {
    start: number
    end: number
  }
}

export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError

export type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: ToolState
  metadata?: {
    [key: string]: unknown
  }
}

export type StepStartPart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-start"
  snapshot?: string
}

export type StepFinishPart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-finish"
  reason: string
  snapshot?: string
  model?: {
    providerID: string
    modelID: string
  }
  generationID?: string
  vercelID?: string
  metrics?: {
    prompt?: number
    generation?: number
    source: "provider" | "computed"
  }
  time?: {
    start: number
    end: number
    elapsed: number
  }
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
}

export type SnapshotPart = {
  id: string
  sessionID: string
  messageID: string
  type: "snapshot"
  snapshot: string
}

export type PatchPart = {
  id: string
  sessionID: string
  messageID: string
  type: "patch"
  hash: string
  files: Array<string>
}

export type AgentPart = {
  id: string
  sessionID: string
  messageID: string
  type: "agent"
  name: string
  source?: {
    value: string
    start: number
    end: number
  }
}

export type RetryPart = {
  id: string
  sessionID: string
  messageID: string
  type: "retry"
  attempt: number
  error: ApiError
  time: {
    created: number
  }
}

export type CompactionPart = {
  id: string
  sessionID: string
  messageID: string
  type: "compaction"
  auto: boolean
  overflow?: boolean
  tail_start_id?: string
}

export type Part =
  | TextPart
  | SubtaskPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart

export type Prompt = {
  text: string
  files?: Array<PromptFileAttachment>
  agents?: Array<PromptAgentAttachment>
}

export type Pty = {
  id: string
  title: string
  command: string
  args: Array<string>
  cwd: string
  status: "running" | "exited"
  pid: number
  exitCode?: number
  sessionID?: string | null
}

export type Todo = {
  /**
   * Brief description of the task
   */
  content: string
  /**
   * Current status of the task: pending, in_progress, completed, cancelled
   */
  status: string
  /**
   * Priority level of the task: high, medium, low
   */
  priority: string
}

export type EventTuiPromptAppend = {
  id: string
  type: "tui.prompt.append"
  properties: {
    text: string
  }
}

export type EventTuiCommandExecute = {
  id: string
  type: "tui.command.execute"
  properties: {
    command:
      | "session.list"
      | "session.new"
      | "session.share"
      | "session.interrupt"
      | "session.compact"
      | "session.page.up"
      | "session.page.down"
      | "session.line.up"
      | "session.line.down"
      | "session.half.page.up"
      | "session.half.page.down"
      | "session.first"
      | "session.last"
      | "prompt.clear"
      | "prompt.submit"
      | "agent.cycle"
      | string
  }
}

export type EventTuiToastShow = {
  id: string
  type: "tui.toast.show"
  properties: {
    title?: string
    message: string
    variant: "info" | "success" | "warning" | "error"
    duration?: number
  }
}

export type EventTuiSessionSelect = {
  id: string
  type: "tui.session.select"
  properties: {
    /**
     * Session ID to navigate to
     */
    sessionID: string
  }
}

export type SessionStatus =
  | {
      type: "idle"
    }
  | {
      type: "retry"
      attempt: number
      message: string
      action?: {
        reason: string
        provider: string
        title: string
        message: string
        label: string
        link?: string
      }
      next: number
    }
  | {
      type: "busy"
    }
  | {
      type: "offline"
      requestID: string
      message: string
    }

export type QuestionOption = {
  /**
   * Display text (1-5 words, concise)
   */
  label: string
  /**
   * Explanation of choice
   */
  description: string
  labelKey?: string
  descriptionKey?: string
  mode?: string
}

export type QuestionInfo = {
  /**
   * Complete question
   */
  question: string
  /**
   * Very short label (max 30 chars)
   */
  header: string
  /**
   * Available choices
   */
  options: Array<QuestionOption>
  multiple?: boolean
  questionKey?: string
  headerKey?: string
  custom?: boolean
}

export type QuestionTool = {
  messageID: string
  callID: string
}

export type QuestionAnswer = Array<string>

export type GlobalEvent = {
  directory: string
  project?: string
  workspace?: string
  payload:
    | EventServerInstanceDisposed
    | EventSessionTurnOpen
    | EventSessionTurnClose
    | EventSessionQueueChanged
    | EventSessionNetworkAsked
    | EventSessionNetworkReplied
    | EventSessionNetworkRejected
    | EventSessionNetworkRestored
    | EventBackgroundProcessUpdated
    | EventBackgroundProcessDeleted
    | EventInteractiveTerminalUpdated
    | EventInteractiveTerminalData
    | EventInteractiveTerminalDeleted
    | EventSandboxStatusChanged
    | EventLspClientDiagnostics
    | EventSuggestionShown
    | EventSuggestionAccepted
    | EventSuggestionDismissed
    | EventKilocodeAgentManagerStart
    | EventKilocodeAgentManagerRequested
    | EventKilocodeAgentManagerCancelled
    | EventKilocodeNotebookRequested
    | EventKilocodeNotebookCancelled
    | EventKiloSessionsRemoteStatusChanged
    | EventMemoryStatus
    | EventMemoryUpdated
    | EventMemoryError
    | EventIndexingStatus
    | EventIndexingWarning
    | EventModelsDevRefreshed
    | EventIntegrationUpdated
    | EventIntegrationConnectionUpdated
    | EventCatalogUpdated
    | EventSessionCreated
    | EventSessionUpdated
    | EventSessionDeleted
    | EventMessageUpdated
    | EventMessageRemoved
    | EventMessagePartUpdated
    | EventMessagePartRemoved
    | EventSessionNextAgentSwitched
    | EventSessionNextModelSwitched
    | EventSessionNextMoved
    | EventSessionNextPrompted
    | EventSessionNextPromptAdmitted
    | EventSessionNextContextUpdated
    | EventSessionNextSynthetic
    | EventSessionNextShellStarted
    | EventSessionNextShellEnded
    | EventSessionNextStepStarted
    | EventSessionNextStepEnded
    | EventSessionNextStepFailed
    | EventSessionNextTextStarted
    | EventSessionNextTextDelta
    | EventSessionNextTextEnded
    | EventSessionNextReasoningStarted
    | EventSessionNextReasoningDelta
    | EventSessionNextReasoningEnded
    | EventSessionNextToolInputStarted
    | EventSessionNextToolInputDelta
    | EventSessionNextToolInputEnded
    | EventSessionNextToolCalled
    | EventSessionNextToolProgress
    | EventSessionNextToolSuccess
    | EventSessionNextToolFailed
    | EventSessionNextRetried
    | EventSessionNextCompactionStarted
    | EventSessionNextCompactionDelta
    | EventSessionNextCompactionEnded
    | EventSessionNextRevertStaged
    | EventSessionNextRevertCleared
    | EventSessionNextRevertCommitted
    | EventMessagePartDelta
    | EventSessionDiff
    | EventSessionError
    | EventInstallationUpdated
    | EventInstallationUpdateAvailable
    | EventFileEdited
    | EventReferenceUpdated
    | EventPermissionV2Asked
    | EventPermissionV2Replied
    | EventPluginAdded
    | EventProjectDirectoriesUpdated
    | EventFileWatcherUpdated
    | EventPtyCreated
    | EventPtyUpdated
    | EventPtyExited
    | EventPtyDeleted
    | EventQuestionV2Asked
    | EventQuestionV2Replied
    | EventQuestionV2Rejected
    | EventTodoUpdated
    | EventLspUpdated
    | EventPermissionAsked
    | EventPermissionReplied
    | EventTuiPromptAppend
    | EventTuiCommandExecute
    | EventTuiToastShow
    | EventTuiSessionSelect
    | EventMcpToolsChanged
    | EventMcpBrowserOpenFailed
    | EventCommandExecuted
    | EventProjectUpdated
    | EventSessionStatus
    | EventSessionIdle
    | EventQuestionAsked
    | EventQuestionReplied
    | EventQuestionRejected
    | EventSessionCompacted
    | EventVcsBranchUpdated
    | EventWorkspaceReady
    | EventWorkspaceFailed
    | EventWorkspaceStatus
    | EventWorktreeReady
    | EventWorktreeFailed
    | EventServerConnected
    | EventGlobalDisposed
    | EventGlobalConfigUpdated
    | {
        id: string
        type: "models-dev.refreshed"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "integration.updated"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "integration.connection.updated"
        properties: {
          integrationID: string
        }
      }
    | {
        id: string
        type: "catalog.updated"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "session.created"
        properties: {
          sessionID: string
          info: Session
        }
      }
    | {
        id: string
        type: "session.updated"
        properties: {
          sessionID: string
          info: Session
        }
      }
    | {
        id: string
        type: "session.deleted"
        properties: {
          sessionID: string
          info: Session
        }
      }
    | {
        id: string
        type: "message.updated"
        properties: {
          sessionID: string
          info: Message
        }
      }
    | {
        id: string
        type: "message.removed"
        properties: {
          sessionID: string
          messageID: string
        }
      }
    | {
        id: string
        type: "message.part.updated"
        properties: {
          sessionID: string
          part: Part
          time: number
        }
      }
    | {
        id: string
        type: "message.part.removed"
        properties: {
          sessionID: string
          messageID: string
          partID: string
        }
      }
    | {
        id: string
        type: "session.next.agent.switched"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          agent: string
        }
      }
    | {
        id: string
        type: "session.next.model.switched"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          model: ModelRef
        }
      }
    | {
        id: string
        type: "session.next.moved"
        properties: {
          timestamp: number
          sessionID: string
          location: LocationRef
          subdirectory?: string
        }
      }
    | {
        id: string
        type: "session.next.prompted"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          prompt: Prompt
          delivery: "steer" | "queue"
        }
      }
    | {
        id: string
        type: "session.next.prompt.admitted"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          prompt: Prompt
          delivery: "steer" | "queue"
        }
      }
    | {
        id: string
        type: "session.next.context.updated"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          text: string
        }
      }
    | {
        id: string
        type: "session.next.synthetic"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          text: string
        }
      }
    | {
        id: string
        type: "session.next.shell.started"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          callID: string
          command: string
        }
      }
    | {
        id: string
        type: "session.next.shell.ended"
        properties: {
          timestamp: number
          sessionID: string
          callID: string
          output: string
        }
      }
    | {
        id: string
        type: "session.next.step.started"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          agent: string
          model: ModelRef
          snapshot?: string
        }
      }
    | {
        id: string
        type: "session.next.step.ended"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          finish: string
          cost: number
          tokens: {
            input: number
            output: number
            reasoning: number
            cache: {
              read: number
              write: number
            }
          }
          snapshot?: string
          files?: Array<string>
        }
      }
    | {
        id: string
        type: "session.next.step.failed"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          error: SessionErrorUnknown
        }
      }
    | {
        id: string
        type: "session.next.text.started"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          textID: string
        }
      }
    | {
        id: string
        type: "session.next.text.delta"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          textID: string
          delta: string
        }
      }
    | {
        id: string
        type: "session.next.text.ended"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          textID: string
          text: string
        }
      }
    | {
        id: string
        type: "session.next.reasoning.started"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          reasoningID: string
          providerMetadata?: LlmProviderMetadata
        }
      }
    | {
        id: string
        type: "session.next.reasoning.delta"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          reasoningID: string
          delta: string
        }
      }
    | {
        id: string
        type: "session.next.reasoning.ended"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          reasoningID: string
          text: string
          providerMetadata?: LlmProviderMetadata
        }
      }
    | {
        id: string
        type: "session.next.tool.input.started"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          name: string
        }
      }
    | {
        id: string
        type: "session.next.tool.input.delta"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          delta: string
        }
      }
    | {
        id: string
        type: "session.next.tool.input.ended"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          text: string
        }
      }
    | {
        id: string
        type: "session.next.tool.called"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          tool: string
          input: {
            [key: string]: unknown
          }
          provider: {
            executed: boolean
            metadata?: LlmProviderMetadata
          }
        }
      }
    | {
        id: string
        type: "session.next.tool.progress"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          structured: {
            [key: string]: unknown
          }
          content: Array<LlmToolContent>
        }
      }
    | {
        id: string
        type: "session.next.tool.success"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          structured: {
            [key: string]: unknown
          }
          content: Array<LlmToolContent>
          outputPaths?: Array<string>
          result?: unknown
          provider: {
            executed: boolean
            metadata?: LlmProviderMetadata
          }
        }
      }
    | {
        id: string
        type: "session.next.tool.failed"
        properties: {
          timestamp: number
          sessionID: string
          assistantMessageID: string
          callID: string
          error: SessionErrorUnknown
          result?: unknown
          provider: {
            executed: boolean
            metadata?: LlmProviderMetadata
          }
        }
      }
    | {
        id: string
        type: "session.next.retried"
        properties: {
          timestamp: number
          sessionID: string
          attempt: number
          error: SessionNextRetryError
        }
      }
    | {
        id: string
        type: "session.next.compaction.started"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          reason: "auto" | "manual"
        }
      }
    | {
        id: string
        type: "session.next.compaction.delta"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          text: string
        }
      }
    | {
        id: string
        type: "session.next.compaction.ended"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
          reason: "auto" | "manual"
          text: string
          recent: string
          include?: string
        }
      }
    | {
        id: string
        type: "session.next.revert.staged"
        properties: {
          timestamp: number
          sessionID: string
          revert: RevertState
        }
      }
    | {
        id: string
        type: "session.next.revert.cleared"
        properties: {
          timestamp: number
          sessionID: string
        }
      }
    | {
        id: string
        type: "session.next.revert.committed"
        properties: {
          timestamp: number
          sessionID: string
          messageID: string
        }
      }
    | {
        id: string
        type: "message.part.delta"
        properties: {
          sessionID: string
          messageID: string
          partID: string
          field: string
          delta: string
        }
      }
    | {
        id: string
        type: "session.diff"
        properties: {
          sessionID: string
          diff: Array<SnapshotFileDiff>
        }
      }
    | {
        id: string
        type: "session.error"
        properties: {
          sessionID?: string
          error?:
            | ProviderAuthError
            | UnknownError
            | MessageOutputLengthError
            | MessageAbortedError
            | StructuredOutputError
            | ContextOverflowError
            | ContentFilterError
            | ApiError
        }
      }
    | {
        id: string
        type: "installation.updated"
        properties: {
          version: string
        }
      }
    | {
        id: string
        type: "installation.update-available"
        properties: {
          version: string
        }
      }
    | {
        id: string
        type: "file.edited"
        properties: {
          file: string
        }
      }
    | {
        id: string
        type: "reference.updated"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "permission.v2.asked"
        properties: {
          id: string
          sessionID: string
          action: string
          resources: Array<string>
          save?: Array<string>
          metadata?: {
            [key: string]: unknown
          }
          source?: PermissionV2Source
        }
      }
    | {
        id: string
        type: "permission.v2.replied"
        properties: {
          sessionID: string
          requestID: string
          reply: PermissionV2Reply
        }
      }
    | {
        id: string
        type: "plugin.added"
        properties: {
          id: string
        }
      }
    | {
        id: string
        type: "project.directories.updated"
        properties: {
          projectID: string
        }
      }
    | {
        id: string
        type: "file.watcher.updated"
        properties: {
          file: string
          event: "add" | "change" | "unlink"
        }
      }
    | {
        id: string
        type: "pty.created"
        properties: {
          info: Pty
        }
      }
    | {
        id: string
        type: "pty.updated"
        properties: {
          info: Pty
        }
      }
    | {
        id: string
        type: "pty.exited"
        properties: {
          id: string
          exitCode: number
        }
      }
    | {
        id: string
        type: "pty.deleted"
        properties: {
          id: string
        }
      }
    | {
        id: string
        type: "question.v2.asked"
        properties: {
          id: string
          sessionID: string
          /**
           * Questions to ask
           */
          questions: Array<QuestionV2Info>
          tool?: QuestionV2Tool
        }
      }
    | {
        id: string
        type: "question.v2.replied"
        properties: {
          sessionID: string
          requestID: string
          answers: Array<QuestionV2Answer>
        }
      }
    | {
        id: string
        type: "question.v2.rejected"
        properties: {
          sessionID: string
          requestID: string
        }
      }
    | {
        id: string
        type: "todo.updated"
        properties: {
          sessionID: string
          todos: Array<Todo>
        }
      }
    | {
        id: string
        type: "lsp.updated"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "permission.asked"
        properties: {
          id: string
          sessionID: string
          permission: string
          patterns: Array<string>
          metadata: {
            [key: string]: unknown
          }
          always: Array<string>
          tool?: {
            messageID: string
            callID: string
          }
        }
      }
    | {
        id: string
        type: "permission.replied"
        properties: {
          sessionID: string
          requestID: string
          reply: "once" | "always" | "reject"
        }
      }
    | {
        id: string
        type: "tui.prompt.append"
        properties: {
          text: string
        }
      }
    | {
        id: string
        type: "tui.command.execute"
        properties: {
          command:
            | "session.list"
            | "session.new"
            | "session.share"
            | "session.interrupt"
            | "session.compact"
            | "session.page.up"
            | "session.page.down"
            | "session.line.up"
            | "session.line.down"
            | "session.half.page.up"
            | "session.half.page.down"
            | "session.first"
            | "session.last"
            | "prompt.clear"
            | "prompt.submit"
            | "agent.cycle"
            | string
        }
      }
    | {
        id: string
        type: "tui.toast.show"
        properties: {
          title?: string
          message: string
          variant: "info" | "success" | "warning" | "error"
          duration?: number
        }
      }
    | {
        id: string
        type: "tui.session.select"
        properties: {
          /**
           * Session ID to navigate to
           */
          sessionID: string
        }
      }
    | {
        id: string
        type: "mcp.tools.changed"
        properties: {
          server: string
        }
      }
    | {
        id: string
        type: "mcp.browser.open.failed"
        properties: {
          mcpName: string
          url: string
        }
      }
    | {
        id: string
        type: "command.executed"
        properties: {
          name: string
          sessionID: string
          arguments: string
          messageID: string
        }
      }
    | {
        id: string
        type: "project.updated"
        properties: {
          id: string
          worktree: string
          vcs?: ProjectVcs
          name?: string
          icon?: ProjectIcon
          commands?: ProjectCommands
          time: ProjectTime
          sandboxes: Array<string>
        }
      }
    | {
        id: string
        type: "session.status"
        properties: {
          sessionID: string
          status: SessionStatus
        }
      }
    | {
        id: string
        type: "session.idle"
        properties: {
          sessionID: string
        }
      }
    | {
        id: string
        type: "question.asked"
        properties: {
          id: string
          sessionID: string
          /**
           * Questions to ask
           */
          questions: Array<QuestionInfo>
          blocking?: boolean
          tool?: QuestionTool
        }
      }
    | {
        id: string
        type: "question.replied"
        properties: {
          sessionID: string
          requestID: string
          answers: Array<QuestionAnswer>
        }
      }
    | {
        id: string
        type: "question.rejected"
        properties: {
          sessionID: string
          requestID: string
        }
      }
    | {
        id: string
        type: "session.compacted"
        properties: {
          sessionID: string
        }
      }
    | {
        id: string
        type: "vcs.branch.updated"
        properties: {
          branch?: string
        }
      }
    | {
        id: string
        type: "workspace.ready"
        properties: {
          name: string
        }
      }
    | {
        id: string
        type: "workspace.failed"
        properties: {
          message: string
        }
      }
    | {
        id: string
        type: "workspace.status"
        properties: {
          workspaceID: string
          status: "connected" | "connecting" | "disconnected" | "error"
        }
      }
    | {
        id: string
        type: "worktree.ready"
        properties: {
          name: string
          branch?: string
        }
      }
    | {
        id: string
        type: "worktree.failed"
        properties: {
          message: string
        }
      }
    | {
        id: string
        type: "server.connected"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "global.disposed"
        properties: {
          [key: string]: unknown
        }
      }
    | {
        id: string
        type: "global.config.updated"
        properties: {
          [key: string]: unknown
        }
      }
    | SyncEventSessionCreated
    | SyncEventSessionUpdated
    | SyncEventSessionDeleted
    | SyncEventMessageUpdated
    | SyncEventMessageRemoved
    | SyncEventMessagePartUpdated
    | SyncEventMessagePartRemoved
    | SyncEventSessionNextAgentSwitched
    | SyncEventSessionNextModelSwitched
    | SyncEventSessionNextMoved
    | SyncEventSessionNextPrompted
    | SyncEventSessionNextPromptAdmitted
    | SyncEventSessionNextContextUpdated
    | SyncEventSessionNextSynthetic
    | SyncEventSessionNextShellStarted
    | SyncEventSessionNextShellEnded
    | SyncEventSessionNextStepStarted
    | SyncEventSessionNextStepEnded
    | SyncEventSessionNextStepFailed
    | SyncEventSessionNextTextStarted
    | SyncEventSessionNextTextEnded
    | SyncEventSessionNextReasoningStarted
    | SyncEventSessionNextReasoningEnded
    | SyncEventSessionNextToolInputStarted
    | SyncEventSessionNextToolInputEnded
    | SyncEventSessionNextToolCalled
    | SyncEventSessionNextToolProgress
    | SyncEventSessionNextToolSuccess
    | SyncEventSessionNextToolFailed
    | SyncEventSessionNextRetried
    | SyncEventSessionNextCompactionStarted
    | SyncEventSessionNextCompactionEnded
    | SyncEventSessionNextRevertStaged
    | SyncEventSessionNextRevertCleared
    | SyncEventSessionNextRevertCommitted
}

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR"

export type ServerConfig = {
  port?: number
  hostname?: string
  mdns?: boolean
  mdnsDomain?: string
  cors?: Array<string>
}

export type IndexingConfig = {
  enabled?: boolean
  provider?:
    | "kilo"
    | "openai"
    | "ollama"
    | "openai-compatible"
    | "gemini"
    | "mistral"
    | "vercel-ai-gateway"
    | "bedrock"
    | "openrouter"
    | "voyage"
  model?: string | null
  dimension?: number | null
  vectorStore?: "lancedb" | "qdrant"
  kilo?: {
    apiKey?: string
    baseUrl?: string
    organizationId?: string
  }
  openai?: {
    apiKey?: string
  }
  ollama?: {
    baseUrl?: string
  }
  "openai-compatible"?: {
    baseUrl?: string
    apiKey?: string
  }
  gemini?: {
    apiKey?: string
  }
  mistral?: {
    apiKey?: string
  }
  "vercel-ai-gateway"?: {
    apiKey?: string
  }
  bedrock?: {
    region?: string
    profile?: string
  }
  openrouter?: {
    apiKey?: string
    specificProvider?: string
  }
  voyage?: {
    apiKey?: string
  }
  qdrant?: {
    url?: string
    apiKey?: string
  }
  lancedb?: {
    directory?: string
  }
  searchMinScore?: number
  searchMaxResults?: number
  embeddingBatchSize?: number
  scannerMaxBatchRetries?: number
  fileExtensions?: Array<string>
}

export type PermissionActionConfig = "ask" | "allow" | "deny"

export type PermissionObjectConfig = {
  [key: string]: PermissionActionConfig
}

export type PermissionRuleConfig = PermissionActionConfig | PermissionObjectConfig

export type PermissionConfig =
  | PermissionActionConfig
  | {
      read?: PermissionRuleConfig
      edit?: PermissionRuleConfig
      glob?: PermissionRuleConfig
      grep?: PermissionRuleConfig
      list?: PermissionRuleConfig
      bash?: PermissionRuleConfig
      task?: PermissionRuleConfig
      external_directory?: PermissionRuleConfig
      markdown_source?: PermissionRuleConfig
      todowrite?: PermissionActionConfig
      question?: PermissionActionConfig
      webfetch?: PermissionActionConfig
      websearch?: PermissionActionConfig
      lsp?: PermissionRuleConfig
      doom_loop?: PermissionActionConfig
      skill?: PermissionRuleConfig
      agent_manager?: PermissionRuleConfig
      notebook_read?: PermissionRuleConfig
      notebook_edit?: PermissionRuleConfig
      notebook_execute?: PermissionRuleConfig
      [key: string]: PermissionRuleConfig | PermissionActionConfig | undefined
    }

export type AgentConfig = {
  model?: string
  variant?: string
  temperature?: number
  top_p?: number
  prompt?: string
  tools?: {
    [key: string]: boolean
  }
  disable?: boolean
  description?: string
  mode?: "subagent" | "primary" | "all"
  displayName?: string
  source?: string
  hidden?: boolean
  options?: {
    [key: string]: unknown
  }
  /**
   * Hex color code (e.g., #FF5733) or theme color (e.g., primary)
   */
  color?: string | "primary" | "secondary" | "accent" | "success" | "warning" | "error" | "info"
  steps?: number
  maxSteps?: number
  permission?: PermissionConfig
  requirements?: {
    skills?: Array<string>
    mcps?: Array<string>
    vscode_extensions?: Array<{
      name: string
      id: string
    }>
  }
  [key: string]:
    | unknown
    | string
    | number
    | {
        [key: string]: boolean
      }
    | boolean
    | "subagent"
    | "primary"
    | "all"
    | {
        [key: string]: unknown
      }
    | string
    | "primary"
    | "secondary"
    | "accent"
    | "success"
    | "warning"
    | "error"
    | "info"
    | number
    | PermissionConfig
    | {
        skills?: Array<string>
        mcps?: Array<string>
        vscode_extensions?: Array<{
          name: string
          id: string
        }>
      }
    | undefined
}

export type ProviderConfig = {
  api?: string
  name?: string
  env?: Array<string>
  id?: string
  npm?: string
  whitelist?: Array<string>
  blacklist?: Array<string>
  options?: {
    apiKey?: string
    baseURL?: string
    enterpriseUrl?: string
    setCacheKey?: boolean
    /**
     * Timeout in milliseconds for full requests to this provider. Set to false to disable timeout.
     */
    timeout?: number | false
    /**
     * Timeout in milliseconds to wait for response headers. Provider integrations may set defaults. Set to false to disable timeout.
     */
    headerTimeout?: number | false
    chunkTimeout?: number
    [key: string]: unknown | string | boolean | number | false | number | false | number | undefined
  }
  models?: {
    [key: string]: {
      id?: string
      name?: string
      family?: string
      prompt?: "codex" | "gemini" | "beast" | "anthropic" | "trinity" | "anthropic_without_todo" | "ling" | "gpt55"
      isFree?: boolean
      ai_sdk_provider?: "alibaba" | "anthropic" | "mistral" | "openai" | "openai-compatible" | "openrouter"
      release_date?: string
      attachment?: boolean
      reasoning?: boolean
      temperature?: boolean
      tool_call?: boolean
      interleaved?:
        | true
        | {
            field: "reasoning" | "reasoning_content" | "reasoning_details"
          }
      cost?: {
        input: number
        output: number
        cache_read?: number
        cache_write?: number
        context_over_200k?: {
          input: number
          output: number
          cache_read?: number
          cache_write?: number
        }
      }
      limit?: {
        context: number
        input?: number
        output: number
      }
      modalities?: {
        input?: Array<"text" | "audio" | "image" | "video" | "pdf">
        output?: Array<"text" | "audio" | "image" | "video" | "pdf">
      }
      experimental?: boolean
      status?: "alpha" | "beta" | "deprecated" | "active"
      provider?: {
        npm?: string
        api?: string
      }
      options?: {
        [key: string]: unknown
      }
      headers?: {
        [key: string]: string
      }
      /**
       * Variant-specific configuration
       */
      variants?: {
        [key: string]: {
          disabled?: boolean
          [key: string]: unknown | boolean | undefined
        }
      }
    }
  }
}

export type McpLocalConfig = {
  type: "local"
  command: Array<string>
  environment?: {
    [key: string]: string
  }
  env?: {
    [key: string]: string
  }
  enabled?: boolean
  timeout?: number
}

export type McpOAuthConfig = {
  clientId?: string
  clientSecret?: string
  scope?: string
  callbackPort?: number
  redirectUri?: string
}

export type McpRemoteConfig = {
  /**
   * Type of MCP server connection
   */
  type: "remote"
  /**
   * URL of the remote MCP server
   */
  url: string
  enabled?: boolean
  headers?: {
    [key: string]: string
  }
  /**
   * OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.
   */
  oauth?: McpOAuthConfig | false
  timeout?: number
}

export type LayoutConfig = "auto" | "stretch"

export type ImageAttachmentConfig = {
  auto_resize?: boolean
  max_width?: number
  max_height?: number
  max_base64_bytes?: number
}

export type AttachmentConfig = {
  image?: ImageAttachmentConfig
}

export type Config = {
  $schema?: string
  shell?: string
  logLevel?: LogLevel
  server?: ServerConfig
  command?: {
    [key: string]: {
      template?: string
      description?: string
      agent?: string
      model?: string
      variant?: string
      subtask?: boolean
    }
  }
  skills?: {
    paths?: Array<string>
    urls?: Array<string>
  }
  references?: {
    [key: string]: string | ConfigV2ReferenceGit | ConfigV2ReferenceLocal
  }
  reference?: {
    [key: string]: string | ConfigV2ReferenceGit | ConfigV2ReferenceLocal
  }
  watcher?: {
    ignore?: Array<string>
  }
  snapshot?: boolean
  plugin?: Array<
    | string
    | [
        string,
        {
          [key: string]: unknown
        },
      ]
  >
  share?: "manual" | "auto" | "disabled"
  autoshare?: boolean
  /**
   * Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications
   */
  autoupdate?: boolean | "notify"
  disabled_providers?: Array<string>
  enabled_providers?: Array<string>
  remote_control?: boolean
  auto_collapse_reasoning?: boolean
  indexing?: IndexingConfig
  console?: {
    /**
     * Width of the Kilo Console project context sidebar in pixels
     */
    context_sidebar_width?: number
    diff_style?: "unified" | "split"
  }
  terminal_command_display?: "expanded" | "collapsed"
  code_edit_display?: "expanded" | "collapsed"
  hide_prompt_training_models?: boolean
  privacy_mode?: boolean
  /**
   * Sandbox configuration for agent tools
   */
  sandbox?: {
    /**
     * Enable sandbox confinement for new sessions (default: false)
     */
    enabled?: boolean
    /**
     * Control outbound network access from sandboxed tools (default: deny)
     */
    network?: "allow" | "deny"
    /**
     * Additional filesystem paths that sandboxed tools may write to
     */
    writable_paths?: Array<string>
    /**
     * Exact network destinations sandboxed tools may access while network restriction is enabled
     */
    allowed_hosts?: Array<string>
  }
  model?: string
  small_model?: string
  subagent_model?: string
  subagent_variant?: string
  subagent_variant_overrides?: {
    [key: string]: string
  }
  default_agent?: string
  username?: string
  mode?: {
    build?: AgentConfig
    plan?: AgentConfig
    [key: string]: AgentConfig | undefined
  }
  agent?: {
    plan?: AgentConfig
    build?: AgentConfig
    debug?: AgentConfig
    orchestrator?: AgentConfig
    ask?: AgentConfig
    general?: AgentConfig
    explore?: AgentConfig
    scout?: AgentConfig
    title?: AgentConfig
    summary?: AgentConfig
    compaction?: AgentConfig
    [key: string]: AgentConfig | undefined
  }
  provider?: {
    [key: string]: ProviderConfig | null
  }
  mcp?: {
    [key: string]:
      | McpLocalConfig
      | McpRemoteConfig
      | {
          enabled: boolean
        }
  }
  /**
   * Enable or configure formatters. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.
   */
  formatter?:
    | boolean
    | {
        [key: string]: {
          disabled?: boolean
          command?: Array<string>
          environment?: {
            [key: string]: string
          }
          extensions?: Array<string>
        }
      }
  /**
   * Enable or configure LSP servers. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.
   */
  lsp?:
    | boolean
    | {
        [key: string]:
          | {
              disabled: true
            }
          | {
              command: Array<string>
              extensions?: Array<string>
              disabled?: boolean
              env?: {
                [key: string]: string
              }
              initialization?: {
                [key: string]: unknown
              }
            }
      }
  instructions?: Array<string>
  layout?: LayoutConfig
  permission?: PermissionConfig
  tools?: {
    [key: string]: boolean
  }
  web_search?: boolean
  attachment?: AttachmentConfig
  enterprise?: {
    url?: string
  }
  commit_message?: {
    prompt?: string
  }
  tool_output?: {
    max_lines?: number
    max_bytes?: number
  }
  compaction?: {
    auto?: boolean
    /**
     * Percentage of the model input/context window that triggers automatic compaction. The reserved safety buffer still applies if it would compact sooner.
     */
    threshold_percent?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
    prune?: boolean
    tail_turns?: number
    preserve_recent_tokens?: number
    reserved?: number
  }
  experimental?: {
    disable_paste_summary?: boolean
    batch_tool?: boolean
    codebase_search?: boolean
    image_generation?: boolean
    image_generation_model?: string
    agent_requirements?: boolean
    native_notebook_tools?: boolean
    speech_to_text_model?: string
    openTelemetry?: boolean
    primary_tools?: Array<string>
    continue_loop_on_deny?: boolean
    sandbox?: boolean
    sandbox_restrict_network?: boolean
    sandbox_writable_paths?: Array<string>
    swe_pruner?: boolean
    swe_pruner_model?: string
    mcp_timeout?: number
    policies?: Array<ConfigV2ExperimentalPolicy>
  }
}

export type Model = {
  id: string
  providerID: string
  api: {
    id: string
    url: string
    npm: string
  }
  name: string
  family?: string
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolcall: boolean
    input: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    output: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    interleaved:
      | boolean
      | {
          field: "reasoning" | "reasoning_content" | "reasoning_details"
        }
  }
  cost: {
    available?: boolean
    input: number
    output: number
    cache: {
      read: number
      write: number
    }
    tiers?: Array<{
      input: number
      output: number
      cache: {
        read: number
        write: number
      }
      tier: {
        type: "context"
        size: number
      }
    }>
    experimentalOver200K?: {
      input: number
      output: number
      cache: {
        read: number
        write: number
      }
    }
  }
  limit: {
    context: number
    input?: number
    output: number
  }
  status: "alpha" | "beta" | "deprecated" | "active"
  options: {
    [key: string]: unknown
  }
  headers: {
    [key: string]: string
  }
  release_date: string
  variants?: {
    [key: string]: {
      [key: string]: unknown
    }
  }
  recommendedIndex?: number
  prompt?: "codex" | "gemini" | "beast" | "anthropic" | "trinity" | "anthropic_without_todo" | "ling" | "gpt55"
  isFree?: boolean
  mayTrainOnYourPrompts?: boolean
  hasUserByokAvailable?: boolean
  terminalBench?: {
    overallScore: number
    avgAttemptCostUsd: number
  }
  autoRouting?: {
    models: Array<string>
  }
  ai_sdk_provider?: "alibaba" | "anthropic" | "mistral" | "openai" | "openai-compatible" | "openrouter"
}

export type Provider = {
  id: string
  name: string
  description?: string
  source: "env" | "config" | "custom" | "api"
  env: Array<string>
  key?: string
  metadata?: {
    noteKey?: string
    icon?: string
    priority?: number
  }
  options: {
    [key: string]: unknown
  }
  models: {
    [key: string]: Model
  }
}

export type VcsFileDiff = {
  file: string
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export type Agent = {
  name: string
  displayName?: string
  source?: string
  description?: string
  deprecated?: boolean
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  permission: PermissionRuleset
  model?: {
    modelID: string
    providerID: string
  }
  variant?: string
  prompt?: string
  options: {
    [key: string]: unknown
  }
  requirements?: {
    skills?: Array<string>
    mcps?: Array<string>
    vscode_extensions?: Array<{
      name: string
      id: string
    }>
  }
  steps?: number
}

export type McpStatusConnected = {
  status: "connected"
}

export type McpStatusDisabled = {
  status: "disabled"
}

export type McpStatusFailed = {
  status: "failed"
  error: string
}

export type McpStatusNeedsAuth = {
  status: "needs_auth"
}

export type McpStatusNeedsClientRegistration = {
  status: "needs_client_registration"
  error: string
}

export type McpStatus =
  | { status: "pending" }
  | McpStatusConnected
  | McpStatusDisabled
  | McpStatusFailed
  | McpStatusNeedsAuth
  | McpStatusNeedsClientRegistration

export type QuestionRequest = {
  id: string
  sessionID: string
  /**
   * Questions to ask
   */
  questions: Array<QuestionInfo>
  blocking?: boolean
  tool?: QuestionTool
}

export type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: Array<string>
  metadata: {
    [key: string]: unknown
  }
  always: Array<string>
  tool?: {
    messageID: string
    callID: string
  }
}

export type ProviderAuthMethod = {
  type: "oauth" | "api"
  label: string
  prompts?: Array<
    | {
        type: "text"
        key: string
        message: string
        placeholder?: string
        when?: {
          key: string
          op: "eq" | "neq"
          value: string
        }
      }
    | {
        type: "select"
        key: string
        message: string
        options: Array<{
          label: string
          value: string
          hint?: string
        }>
        when?: {
          key: string
          op: "eq" | "neq"
          value: string
        }
      }
  >
}

export type ProviderAuthAuthorization = {
  url: string
  method: "auto" | "code"
  instructions: string
}

export type TextPartInput = {
  id?: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: {
    start: number
    end?: number
  }
  metadata?: {
    [key: string]: unknown
  }
}

export type FilePartInput = {
  id?: string
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: FilePartSource
}

export type NotebookOutput = {
  mime: string
  text?: string
  name?: string
  message?: string
  stack?: string
  omitted?: boolean
  truncated?: boolean
}

export type NotebookCell = {
  /**
   * Zero-based cell index
   */
  index: number
  kind: "code" | "markdown"
  language: string
  source: string
  execution?: {
    order?: number
    success?: boolean
    started?: number
    ended?: number
  }
  outputs?: Array<NotebookOutput>
}

export type NotebookReadResult = {
  operation: "read"
  path: string
  requestPath: string
  /**
   * Opaque notebook content revision; pass it back unchanged and do not parse or increment it
   */
  revision: string
  cells: Array<NotebookCell>
  truncated?: boolean
}

export type NotebookEditResult = {
  operation: "edit"
  path: string
  requestPath: string
  /**
   * Opaque notebook content revision; pass it back unchanged and do not parse or increment it
   */
  revision: string
  /**
   * Zero-based cell index
   */
  index: number
  action: "insert" | "replace" | "delete" | "create"
  cell?: NotebookCell
}

export type NotebookExecuteResult = {
  operation: "execute"
  path: string
  requestPath: string
  /**
   * Opaque notebook content revision; pass it back unchanged and do not parse or increment it
   */
  revision: string
  /**
   * Zero-based cell index
   */
  index: number
  status: "success" | "error"
  outputs: Array<NotebookOutput>
  truncated?: boolean
}

export type NotebookResult = NotebookReadResult | NotebookEditResult | NotebookExecuteResult

export type NotebookFailure = {
  code:
    | "already_exists"
    | "cancelled"
    | "closed"
    | "disconnected"
    | "execution_failed"
    | "invalid_cell"
    | "invalid_path"
    | "no_kernel"
    | "not_found"
    | "stale_revision"
    | "timeout"
    | "unsupported"
  message: string
  path?: string
  /**
   * Zero-based cell index
   */
  index?: number
  /**
   * Opaque notebook content revision; pass it back unchanged and do not parse or increment it
   */
  currentRevision?: string
}

export type AnacondaDesktopStatus =
  | {
      type: "unsupported-platform"
      platform: string
    }
  | {
      type: "not-installed"
      downloadURL: string
    }
  | {
      type: "not-running"
    }
  | {
      type: "invalid-config"
      reason: "missing" | "malformed" | "missing-key" | "invalid-port"
    }
  | {
      type: "signed-out"
    }
  | {
      type: "management-unauthorized"
    }
  | {
      type: "management-unavailable"
      reason: "timeout" | "unexpected-response"
    }
  | {
      type: "no-downloaded-model"
    }
  | {
      type: "no-running-server"
      downloadedModels: number
    }
  | {
      type: "inference-unhealthy"
      serverID: string
    }
  | {
      type: "ready"
      serverID: string
      serverName?: string
      models: Array<{
        id: string
        name: string
      }>
      context: number
      toolcall: "supported" | "unsupported" | "unknown"
    }

export type EventServerInstanceDisposed = {
  id: string
  type: "server.instance.disposed"
  properties: {
    directory: string
  }
}

export type EventSessionTurnOpen = {
  id: string
  type: "session.turn.open"
  properties: {
    sessionID: string
  }
}

export type EventSessionTurnClose = {
  id: string
  type: "session.turn.close"
  properties: {
    sessionID: string
    parentID?: string
    reason: "completed" | "error" | "interrupted" | "superseded"
  }
}

export type EventSessionQueueChanged = {
  id: string
  type: "session.queue.changed"
  properties: {
    sessionID: string
    queued: Array<string>
  }
}

export type EventSessionNetworkAsked = {
  id: string
  type: "session.network.asked"
  properties: SessionNetworkWait
}

export type EventSessionNetworkReplied = {
  id: string
  type: "session.network.replied"
  properties: {
    sessionID: string
    requestID: string
  }
}

export type EventSessionNetworkRejected = {
  id: string
  type: "session.network.rejected"
  properties: {
    sessionID: string
    requestID: string
  }
}

export type EventSessionNetworkRestored = {
  id: string
  type: "session.network.restored"
  properties: {
    sessionID: string
    requestID: string
    time: number
  }
}

export type EventBackgroundProcessUpdated = {
  id: string
  type: "background_process.updated"
  properties: {
    info: BackgroundProcessInfo
    scope: string
  }
}

export type EventBackgroundProcessDeleted = {
  id: string
  type: "background_process.deleted"
  properties: {
    sessionID: string
    processID: string
    scope: string
  }
}

export type EventInteractiveTerminalUpdated = {
  id: string
  type: "interactive_terminal.updated"
  properties: {
    info: InteractiveTerminalInfo
  }
}

export type EventInteractiveTerminalData = {
  id: string
  type: "interactive_terminal.data"
  properties: {
    terminalID: string
    sessionID: string
    data: string
    cursor: number
  }
}

export type EventInteractiveTerminalDeleted = {
  id: string
  type: "interactive_terminal.deleted"
  properties: {
    terminalID: string
    sessionID: string
  }
}

export type EventSandboxStatusChanged = {
  id: string
  type: "sandbox.status.changed"
  properties: {
    sessionID: string
    directory: string
    enabled: boolean
    available: boolean
    reason?: string
    version: number
  }
}

export type EventLspClientDiagnostics = {
  id: string
  type: "lsp.client.diagnostics"
  properties: {
    serverID: string
    path: string
  }
}

export type EventSuggestionShown = {
  id: string
  type: "suggestion.shown"
  properties: SuggestionRequest
}

export type EventSuggestionAccepted = {
  id: string
  type: "suggestion.accepted"
  properties: {
    sessionID: string
    requestID: string
    index: number
    action: {
      /**
       * Button or option label (1-5 words)
       */
      label: string
      description?: string
      /**
       * Synthetic user prompt to inject when this action is accepted
       */
      prompt: string
    }
  }
}

export type EventSuggestionDismissed = {
  id: string
  type: "suggestion.dismissed"
  properties: {
    sessionID: string
    requestID: string
  }
}

export type EventKilocodeAgentManagerStart = {
  id: string
  type: "kilocode.agent_manager.start"
  properties: {
    requestID: string
    sessionID: string
    sandboxInheritanceToken?: string
    mode: "worktree" | "local"
    versions?: boolean
    tasks: Array<{
      prompt?: string
      name?: string
      branchName?: string
      model?: {
        providerID: string
        modelID: string
      }
      variant?: string
    }>
  }
}

export type EventKilocodeAgentManagerRequested = {
  id: string
  type: "kilocode.agent_manager.requested"
  properties: AgentManagerRequest
}

export type EventKilocodeAgentManagerCancelled = {
  id: string
  type: "kilocode.agent_manager.cancelled"
  properties: {
    requestID: AgentManagerRequestId
    sessionID: string
    reason: "cancelled" | "disposed" | "timeout"
  }
}

export type EventKilocodeNotebookRequested = {
  id: string
  type: "kilocode.notebook.requested"
  properties: NotebookRequest
}

export type EventKilocodeNotebookCancelled = {
  id: string
  type: "kilocode.notebook.cancelled"
  properties: {
    requestID: NotebookRequestId
    sessionID: string
    reason: "cancelled" | "disposed" | "timeout"
  }
}

export type EventKiloSessionsRemoteStatusChanged = {
  id: string
  type: "kilo-sessions.remote-status-changed"
  properties: {
    enabled: boolean
    connected: boolean
  }
}

export type EventMemoryStatus = {
  id: string
  type: "memory.status"
  properties: {
    directory: string
    sessionID?: string
    enabled: boolean
    state: "idle" | "checking" | "injecting" | "updating" | "skipped" | "error"
    reason?: string
    project: {
      bytes: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      estimatedTokens: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      truncated: boolean
      updatedAt?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
    }
    consolidation?: {
      trigger: "explicit" | "turn-close" | "rebuild"
      operationCount: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      cost: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      tokens: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
    }
    detail?: {
      type: "saved" | "skipped" | "recalled"
      message: string
      reason?: string
      duplicateOf?: string
      tokens?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      operationCount?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      added?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      removed?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      skippedCount?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      sources?: Array<string>
      files?: Array<string>
    }
  }
}

export type EventMemoryUpdated = {
  id: string
  type: "memory.updated"
  properties: {
    directory: string
    sessionID?: string
    enabled: boolean
    state: "idle" | "checking" | "injecting" | "updating" | "skipped" | "error"
    reason?: string
    project: {
      bytes: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      estimatedTokens: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      truncated: boolean
      updatedAt?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
    }
    consolidation?: {
      trigger: "explicit" | "turn-close" | "rebuild"
      operationCount: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      cost: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      tokens: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
    }
    detail?: {
      type: "saved" | "skipped" | "recalled"
      message: string
      reason?: string
      duplicateOf?: string
      tokens?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      operationCount?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      added?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      removed?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      skippedCount?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      sources?: Array<string>
      files?: Array<string>
    }
  }
}

export type EventMemoryError = {
  id: string
  type: "memory.error"
  properties: {
    directory: string
    sessionID?: string
    enabled: boolean
    state: "idle" | "checking" | "injecting" | "updating" | "skipped" | "error"
    reason?: string
    project: {
      bytes: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      estimatedTokens: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      truncated: boolean
      updatedAt?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
    }
    consolidation?: {
      trigger: "explicit" | "turn-close" | "rebuild"
      operationCount: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      cost: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      tokens: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
    }
    detail?: {
      type: "saved" | "skipped" | "recalled"
      message: string
      reason?: string
      duplicateOf?: string
      tokens?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      operationCount?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      added?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      removed?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      skippedCount?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN"
      sources?: Array<string>
      files?: Array<string>
    }
  }
}

export type EventIndexingStatus = {
  id: string
  type: "indexing.status"
  properties: {
    status: IndexingStatus
  }
}

export type EventIndexingWarning = {
  id: string
  type: "indexing.warning"
  properties: IndexingWarning
}

export type EventModelsDevRefreshed = {
  id: string
  type: "models-dev.refreshed"
  properties: {
    [key: string]: unknown
  }
}

export type EventIntegrationUpdated = {
  id: string
  type: "integration.updated"
  properties: {
    [key: string]: unknown
  }
}

export type EventIntegrationConnectionUpdated = {
  id: string
  type: "integration.connection.updated"
  properties: {
    integrationID: string
  }
}

export type EventCatalogUpdated = {
  id: string
  type: "catalog.updated"
  properties: {
    [key: string]: unknown
  }
}

export type EventSessionCreated = {
  id: string
  type: "session.created"
  properties: {
    sessionID: string
    info: Session
  }
}

export type EventSessionUpdated = {
  id: string
  type: "session.updated"
  properties: {
    sessionID: string
    info: Session
  }
}

export type EventSessionDeleted = {
  id: string
  type: "session.deleted"
  properties: {
    sessionID: string
    info: Session
  }
}

export type EventMessageUpdated = {
  id: string
  type: "message.updated"
  properties: {
    sessionID: string
    info: Message
  }
}

export type EventMessageRemoved = {
  id: string
  type: "message.removed"
  properties: {
    sessionID: string
    messageID: string
  }
}

export type EventMessagePartUpdated = {
  id: string
  type: "message.part.updated"
  properties: {
    sessionID: string
    part: Part
    time: number
  }
}

export type EventMessagePartRemoved = {
  id: string
  type: "message.part.removed"
  properties: {
    sessionID: string
    messageID: string
    partID: string
  }
}

export type EventSessionNextAgentSwitched = {
  id: string
  type: "session.next.agent.switched"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    agent: string
  }
}

export type ModelRef = {
  id: string
  providerID: string
  variant?: string
}

export type EventSessionNextModelSwitched = {
  id: string
  type: "session.next.model.switched"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    model: ModelRef
  }
}

export type LocationRef = {
  directory: string
  workspaceID?: string
}

export type EventSessionNextMoved = {
  id: string
  type: "session.next.moved"
  properties: {
    timestamp: number
    sessionID: string
    location: LocationRef
    subdirectory?: string
  }
}

export type PromptSource = {
  start: number
  end: number
  text: string
}

export type PromptFileAttachment = {
  uri: string
  mime: string
  name?: string
  description?: string
  source?: PromptSource
}

export type PromptAgentAttachment = {
  name: string
  source?: PromptSource
}

export type EventSessionNextPrompted = {
  id: string
  type: "session.next.prompted"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    prompt: Prompt
    delivery: "steer" | "queue"
  }
}

export type EventSessionNextPromptAdmitted = {
  id: string
  type: "session.next.prompt.admitted"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    prompt: Prompt
    delivery: "steer" | "queue"
  }
}

export type EventSessionNextContextUpdated = {
  id: string
  type: "session.next.context.updated"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    text: string
  }
}

export type EventSessionNextSynthetic = {
  id: string
  type: "session.next.synthetic"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    text: string
  }
}

export type EventSessionNextShellStarted = {
  id: string
  type: "session.next.shell.started"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    callID: string
    command: string
  }
}

export type EventSessionNextShellEnded = {
  id: string
  type: "session.next.shell.ended"
  properties: {
    timestamp: number
    sessionID: string
    callID: string
    output: string
  }
}

export type EventSessionNextStepStarted = {
  id: string
  type: "session.next.step.started"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    agent: string
    model: ModelRef
    snapshot?: string
  }
}

export type EventSessionNextStepEnded = {
  id: string
  type: "session.next.step.ended"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    finish: string
    cost: number
    tokens: {
      input: number
      output: number
      reasoning: number
      cache: {
        read: number
        write: number
      }
    }
    snapshot?: string
    files?: Array<string>
  }
}

export type SessionErrorUnknown = {
  type: "unknown"
  message: string
}

export type EventSessionNextStepFailed = {
  id: string
  type: "session.next.step.failed"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    error: SessionErrorUnknown
  }
}

export type EventSessionNextTextStarted = {
  id: string
  type: "session.next.text.started"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    textID: string
  }
}

export type EventSessionNextTextDelta = {
  id: string
  type: "session.next.text.delta"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    textID: string
    delta: string
  }
}

export type EventSessionNextTextEnded = {
  id: string
  type: "session.next.text.ended"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    textID: string
    text: string
  }
}

export type LlmProviderMetadata = {
  [key: string]: {
    [key: string]: unknown
  }
}

export type EventSessionNextReasoningStarted = {
  id: string
  type: "session.next.reasoning.started"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    reasoningID: string
    providerMetadata?: LlmProviderMetadata
  }
}

export type EventSessionNextReasoningDelta = {
  id: string
  type: "session.next.reasoning.delta"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    reasoningID: string
    delta: string
  }
}

export type EventSessionNextReasoningEnded = {
  id: string
  type: "session.next.reasoning.ended"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    reasoningID: string
    text: string
    providerMetadata?: LlmProviderMetadata
  }
}

export type EventSessionNextToolInputStarted = {
  id: string
  type: "session.next.tool.input.started"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    name: string
  }
}

export type EventSessionNextToolInputDelta = {
  id: string
  type: "session.next.tool.input.delta"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    delta: string
  }
}

export type EventSessionNextToolInputEnded = {
  id: string
  type: "session.next.tool.input.ended"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    text: string
  }
}

export type EventSessionNextToolCalled = {
  id: string
  type: "session.next.tool.called"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    tool: string
    input: {
      [key: string]: unknown
    }
    provider: {
      executed: boolean
      metadata?: LlmProviderMetadata
    }
  }
}

export type ToolTextContent = {
  type: "text"
  text: string
}

export type ToolFileContent = {
  type: "file"
  uri: string
  mime: string
  name?: string
}

export type LlmToolContent = ToolTextContent | ToolFileContent

export type EventSessionNextToolProgress = {
  id: string
  type: "session.next.tool.progress"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    structured: {
      [key: string]: unknown
    }
    content: Array<LlmToolContent>
  }
}

export type EventSessionNextToolSuccess = {
  id: string
  type: "session.next.tool.success"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    structured: {
      [key: string]: unknown
    }
    content: Array<LlmToolContent>
    outputPaths?: Array<string>
    result?: unknown
    provider: {
      executed: boolean
      metadata?: LlmProviderMetadata
    }
  }
}

export type EventSessionNextToolFailed = {
  id: string
  type: "session.next.tool.failed"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    error: SessionErrorUnknown
    result?: unknown
    provider: {
      executed: boolean
      metadata?: LlmProviderMetadata
    }
  }
}

export type SessionNextRetryError = {
  message: string
  statusCode?: number
  isRetryable: boolean
  responseHeaders?: {
    [key: string]: string
  }
  responseBody?: string
  metadata?: {
    [key: string]: string
  }
}

export type EventSessionNextRetried = {
  id: string
  type: "session.next.retried"
  properties: {
    timestamp: number
    sessionID: string
    attempt: number
    error: SessionNextRetryError
  }
}

export type EventSessionNextCompactionStarted = {
  id: string
  type: "session.next.compaction.started"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    reason: "auto" | "manual"
  }
}

export type EventSessionNextCompactionDelta = {
  id: string
  type: "session.next.compaction.delta"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    text: string
  }
}

export type EventSessionNextCompactionEnded = {
  id: string
  type: "session.next.compaction.ended"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    reason: "auto" | "manual"
    text: string
    recent: string
    include?: string
  }
}

export type FileDiff = {
  path: string
  status: "added" | "modified" | "deleted"
  additions: number
  deletions: number
  patch: string
}

export type RevertState = {
  messageID: string
  partID?: string
  snapshot?: string
  diff?: string
  files?: Array<FileDiff>
}

export type EventSessionNextRevertStaged = {
  id: string
  type: "session.next.revert.staged"
  properties: {
    timestamp: number
    sessionID: string
    revert: RevertState
  }
}

export type EventSessionNextRevertCleared = {
  id: string
  type: "session.next.revert.cleared"
  properties: {
    timestamp: number
    sessionID: string
  }
}

export type EventSessionNextRevertCommitted = {
  id: string
  type: "session.next.revert.committed"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
  }
}

export type EventMessagePartDelta = {
  id: string
  type: "message.part.delta"
  properties: {
    sessionID: string
    messageID: string
    partID: string
    field: string
    delta: string
  }
}

export type EventSessionDiff = {
  id: string
  type: "session.diff"
  properties: {
    sessionID: string
    diff: Array<SnapshotFileDiff>
  }
}

export type EventSessionError = {
  id: string
  type: "session.error"
  properties: {
    sessionID?: string
    error?:
      | ProviderAuthError
      | UnknownError
      | MessageOutputLengthError
      | MessageAbortedError
      | StructuredOutputError
      | ContextOverflowError
      | ContentFilterError
      | ApiError
  }
}

export type EventInstallationUpdated = {
  id: string
  type: "installation.updated"
  properties: {
    version: string
  }
}

export type EventInstallationUpdateAvailable = {
  id: string
  type: "installation.update-available"
  properties: {
    version: string
  }
}

export type EventFileEdited = {
  id: string
  type: "file.edited"
  properties: {
    file: string
  }
}

export type EventReferenceUpdated = {
  id: string
  type: "reference.updated"
  properties: {
    [key: string]: unknown
  }
}

export type PermissionV2Source = {
  type: "tool"
  messageID: string
  callID: string
}

export type EventPermissionV2Asked = {
  id: string
  type: "permission.v2.asked"
  properties: {
    id: string
    sessionID: string
    action: string
    resources: Array<string>
    save?: Array<string>
    metadata?: {
      [key: string]: unknown
    }
    source?: PermissionV2Source
  }
}

export type PermissionV2Reply = "once" | "always" | "reject"

export type EventPermissionV2Replied = {
  id: string
  type: "permission.v2.replied"
  properties: {
    sessionID: string
    requestID: string
    reply: PermissionV2Reply
  }
}

export type EventPluginAdded = {
  id: string
  type: "plugin.added"
  properties: {
    id: string
  }
}

export type EventProjectDirectoriesUpdated = {
  id: string
  type: "project.directories.updated"
  properties: {
    projectID: string
  }
}

export type EventFileWatcherUpdated = {
  id: string
  type: "file.watcher.updated"
  properties: {
    file: string
    event: "add" | "change" | "unlink"
  }
}

export type EventPtyCreated = {
  id: string
  type: "pty.created"
  properties: {
    info: Pty
  }
}

export type EventPtyUpdated = {
  id: string
  type: "pty.updated"
  properties: {
    info: Pty
  }
}

export type EventPtyExited = {
  id: string
  type: "pty.exited"
  properties: {
    id: string
    exitCode: number
  }
}

export type EventPtyDeleted = {
  id: string
  type: "pty.deleted"
  properties: {
    id: string
  }
}

export type QuestionV2Option = {
  /**
   * Display text (1-5 words, concise)
   */
  label: string
  /**
   * Explanation of choice
   */
  description: string
}

export type QuestionV2Info = {
  /**
   * Complete question
   */
  question: string
  /**
   * Very short label (max 30 chars)
   */
  header: string
  /**
   * Available choices
   */
  options: Array<QuestionV2Option>
  multiple?: boolean
  custom?: boolean
}

export type QuestionV2Tool = {
  messageID: string
  callID: string
}

export type EventQuestionV2Asked = {
  id: string
  type: "question.v2.asked"
  properties: {
    id: string
    sessionID: string
    /**
     * Questions to ask
     */
    questions: Array<QuestionV2Info>
    tool?: QuestionV2Tool
  }
}

export type QuestionV2Answer = Array<string>

export type EventQuestionV2Replied = {
  id: string
  type: "question.v2.replied"
  properties: {
    sessionID: string
    requestID: string
    answers: Array<QuestionV2Answer>
  }
}

export type EventQuestionV2Rejected = {
  id: string
  type: "question.v2.rejected"
  properties: {
    sessionID: string
    requestID: string
  }
}

export type EventTodoUpdated = {
  id: string
  type: "todo.updated"
  properties: {
    sessionID: string
    todos: Array<Todo>
  }
}

export type EventLspUpdated = {
  id: string
  type: "lsp.updated"
  properties: {
    [key: string]: unknown
  }
}

export type EventPermissionAsked = {
  id: string
  type: "permission.asked"
  properties: {
    id: string
    sessionID: string
    permission: string
    patterns: Array<string>
    metadata: {
      [key: string]: unknown
    }
    always: Array<string>
    tool?: {
      messageID: string
      callID: string
    }
  }
}

export type EventPermissionReplied = {
  id: string
  type: "permission.replied"
  properties: {
    sessionID: string
    requestID: string
    reply: "once" | "always" | "reject"
  }
}

export type EventMcpToolsChanged = {
  id: string
  type: "mcp.tools.changed"
  properties: {
    server: string
  }
}

export type EventMcpBrowserOpenFailed = {
  id: string
  type: "mcp.browser.open.failed"
  properties: {
    mcpName: string
    url: string
  }
}

export type EventCommandExecuted = {
  id: string
  type: "command.executed"
  properties: {
    name: string
    sessionID: string
    arguments: string
    messageID: string
  }
}

export type ProjectVcs = "git"

export type ProjectIcon = {
  url?: string
  override?: string
  color?: string
}

export type ProjectCommands = {
  /**
   * Startup script to run when creating a new workspace (worktree)
   */
  start?: string
}

export type ProjectTime = {
  created: number
  updated: number
  initialized?: number
}

export type EventProjectUpdated = {
  id: string
  type: "project.updated"
  properties: {
    id: string
    worktree: string
    vcs?: ProjectVcs
    name?: string
    icon?: ProjectIcon
    commands?: ProjectCommands
    time: ProjectTime
    sandboxes: Array<string>
  }
}

export type EventSessionStatus = {
  id: string
  type: "session.status"
  properties: {
    sessionID: string
    status: SessionStatus
  }
}

export type EventSessionIdle = {
  id: string
  type: "session.idle"
  properties: {
    sessionID: string
  }
}

export type EventQuestionAsked = {
  id: string
  type: "question.asked"
  properties: {
    id: string
    sessionID: string
    /**
     * Questions to ask
     */
    questions: Array<QuestionInfo>
    blocking?: boolean
    tool?: QuestionTool
  }
}

export type EventQuestionReplied = {
  id: string
  type: "question.replied"
  properties: {
    sessionID: string
    requestID: string
    answers: Array<QuestionAnswer>
  }
}

export type EventQuestionRejected = {
  id: string
  type: "question.rejected"
  properties: {
    sessionID: string
    requestID: string
  }
}

export type EventSessionCompacted = {
  id: string
  type: "session.compacted"
  properties: {
    sessionID: string
  }
}

export type EventVcsBranchUpdated = {
  id: string
  type: "vcs.branch.updated"
  properties: {
    branch?: string
  }
}

export type EventWorkspaceReady = {
  id: string
  type: "workspace.ready"
  properties: {
    name: string
  }
}

export type EventWorkspaceFailed = {
  id: string
  type: "workspace.failed"
  properties: {
    message: string
  }
}

export type EventWorkspaceStatus = {
  id: string
  type: "workspace.status"
  properties: {
    workspaceID: string
    status: "connected" | "connecting" | "disconnected" | "error"
  }
}

export type EventWorktreeReady = {
  id: string
  type: "worktree.ready"
  properties: {
    name: string
    branch?: string
  }
}

export type EventWorktreeFailed = {
  id: string
  type: "worktree.failed"
  properties: {
    message: string
  }
}

export type EventServerConnected = {
  id: string
  type: "server.connected"
  properties: {
    [key: string]: unknown
  }
}

export type EventGlobalDisposed = {
  id: string
  type: "global.disposed"
  properties: {
    [key: string]: unknown
  }
}

export type EventGlobalConfigUpdated = {
  id: string
  type: "global.config.updated"
  properties: {
    [key: string]: unknown
  }
}

export type SyncEventSessionCreated = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.created.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      sessionID: string
      info: Session
    }
  }
}

export type SyncEventSessionUpdated = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.updated.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      sessionID: string
      info: Session
    }
  }
}

export type SyncEventSessionDeleted = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.deleted.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      sessionID: string
      info: Session
    }
  }
}

export type SyncEventMessageUpdated = {
  type: "sync"
  id: string
  syncEvent: {
    type: "message.updated.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      sessionID: string
      info: Message
    }
  }
}

export type SyncEventMessageRemoved = {
  type: "sync"
  id: string
  syncEvent: {
    type: "message.removed.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      sessionID: string
      messageID: string
    }
  }
}

export type SyncEventMessagePartUpdated = {
  type: "sync"
  id: string
  syncEvent: {
    type: "message.part.updated.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      sessionID: string
      part: Part
      time: number
    }
  }
}

export type SyncEventMessagePartRemoved = {
  type: "sync"
  id: string
  syncEvent: {
    type: "message.part.removed.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      sessionID: string
      messageID: string
      partID: string
    }
  }
}

export type SyncEventSessionNextAgentSwitched = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.agent.switched.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      messageID: string
      agent: string
    }
  }
}

export type SyncEventSessionNextModelSwitched = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.model.switched.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      messageID: string
      model: ModelRef
    }
  }
}

export type SyncEventSessionNextMoved = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.moved.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      location: LocationRef
      subdirectory?: string
    }
  }
}

export type SyncEventSessionNextPrompted = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.prompted.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      messageID: string
      prompt: Prompt
      delivery: "steer" | "queue"
    }
  }
}

export type SyncEventSessionNextPromptAdmitted = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.prompt.admitted.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      messageID: string
      prompt: Prompt
      delivery: "steer" | "queue"
    }
  }
}

export type SyncEventSessionNextContextUpdated = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.context.updated.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      messageID: string
      text: string
    }
  }
}

export type SyncEventSessionNextSynthetic = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.synthetic.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      messageID: string
      text: string
    }
  }
}

export type SyncEventSessionNextShellStarted = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.shell.started.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      messageID: string
      callID: string
      command: string
    }
  }
}

export type SyncEventSessionNextShellEnded = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.shell.ended.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      callID: string
      output: string
    }
  }
}

export type SyncEventSessionNextStepStarted = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.step.started.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      assistantMessageID: string
      agent: string
      model: ModelRef
      snapshot?: string
    }
  }
}

export type SyncEventSessionNextStepEnded = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.step.ended.2"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      assistantMessageID: string
      finish: string
      cost: number
      tokens: {
        input: number
        output: number
        reasoning: number
        cache: {
          read: number
          write: number
        }
      }
      snapshot?: string
      files?: Array<string>
    }
  }
}

export type SyncEventSessionNextStepFailed = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.step.failed.2"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      assistantMessageID: string
      error: SessionErrorUnknown
    }
  }
}

export type SyncEventSessionNextTextStarted = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.text.started.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      assistantMessageID: string
      textID: string
    }
  }
}

export type SyncEventSessionNextTextEnded = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.text.ended.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      assistantMessageID: string
      textID: string
      text: string
    }
  }
}

export type SyncEventSessionNextReasoningStarted = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.reasoning.started.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      assistantMessageID: string
      reasoningID: string
      providerMetadata?: LlmProviderMetadata
    }
  }
}

export type SyncEventSessionNextReasoningEnded = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.reasoning.ended.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      assistantMessageID: string
      reasoningID: string
      text: string
      providerMetadata?: LlmProviderMetadata
    }
  }
}

export type SyncEventSessionNextToolInputStarted = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.tool.input.started.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      assistantMessageID: string
      callID: string
      name: string
    }
  }
}

export type SyncEventSessionNextToolInputEnded = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.tool.input.ended.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      assistantMessageID: string
      callID: string
      text: string
    }
  }
}

export type SyncEventSessionNextToolCalled = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.tool.called.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      assistantMessageID: string
      callID: string
      tool: string
      input: {
        [key: string]: unknown
      }
      provider: {
        executed: boolean
        metadata?: LlmProviderMetadata
      }
    }
  }
}

export type SyncEventSessionNextToolProgress = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.tool.progress.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      assistantMessageID: string
      callID: string
      structured: {
        [key: string]: unknown
      }
      content: Array<LlmToolContent>
    }
  }
}

export type SyncEventSessionNextToolSuccess = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.tool.success.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      assistantMessageID: string
      callID: string
      structured: {
        [key: string]: unknown
      }
      content: Array<LlmToolContent>
      outputPaths?: Array<string>
      result?: unknown
      provider: {
        executed: boolean
        metadata?: LlmProviderMetadata
      }
    }
  }
}

export type SyncEventSessionNextToolFailed = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.tool.failed.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      assistantMessageID: string
      callID: string
      error: SessionErrorUnknown
      result?: unknown
      provider: {
        executed: boolean
        metadata?: LlmProviderMetadata
      }
    }
  }
}

export type SyncEventSessionNextRetried = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.retried.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      attempt: number
      error: SessionNextRetryError
    }
  }
}

export type SyncEventSessionNextCompactionStarted = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.compaction.started.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      messageID: string
      reason: "auto" | "manual"
    }
  }
}

export type SyncEventSessionNextCompactionEnded = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.compaction.ended.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      messageID: string
      reason: "auto" | "manual"
      text: string
      recent: string
      include?: string
    }
  }
}

export type SyncEventSessionNextRevertStaged = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.revert.staged.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      revert: RevertState
    }
  }
}

export type SyncEventSessionNextRevertCleared = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.revert.cleared.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
    }
  }
}

export type SyncEventSessionNextRevertCommitted = {
  type: "sync"
  id: string
  syncEvent: {
    type: "session.next.revert.committed.1"
    id: string
    seq: number
    aggregateID: string
    data: {
      timestamp: number
      sessionID: string
      messageID: string
    }
  }
}

export type ConfigV2ReferenceGit = {
  repository: string
  branch?: string
  description?: string
  hidden?: boolean
}

export type ConfigV2ReferenceLocal = {
  path: string
  description?: string
  hidden?: boolean
}

export type PolicyEffect = "allow" | "deny"

export type ConfigV2ExperimentalPolicy = {
  action: "provider.use"
  effect: PolicyEffect
  resource: string
}

export type EventModelsDevRefreshed1 = {
  id: string
  type: "models-dev.refreshed"
  properties: {
    [key: string]: unknown
  }
}

export type EventIntegrationUpdated1 = {
  id: string
  type: "integration.updated"
  properties: {
    [key: string]: unknown
  }
}

export type EventIntegrationConnectionUpdated1 = {
  id: string
  type: "integration.connection.updated"
  properties: {
    integrationID: string
  }
}

export type EventCatalogUpdated1 = {
  id: string
  type: "catalog.updated"
  properties: {
    [key: string]: unknown
  }
}

export type EventSessionCreated1 = {
  id: string
  type: "session.created"
  properties: {
    sessionID: string
    info: Session
  }
}

export type EventSessionUpdated1 = {
  id: string
  type: "session.updated"
  properties: {
    sessionID: string
    info: Session
  }
}

export type EventSessionDeleted1 = {
  id: string
  type: "session.deleted"
  properties: {
    sessionID: string
    info: Session
  }
}

export type EventMessageUpdated1 = {
  id: string
  type: "message.updated"
  properties: {
    sessionID: string
    info: Message
  }
}

export type EventMessageRemoved1 = {
  id: string
  type: "message.removed"
  properties: {
    sessionID: string
    messageID: string
  }
}

export type EventMessagePartUpdated1 = {
  id: string
  type: "message.part.updated"
  properties: {
    sessionID: string
    part: Part
    time: number
  }
}

export type EventMessagePartRemoved1 = {
  id: string
  type: "message.part.removed"
  properties: {
    sessionID: string
    messageID: string
    partID: string
  }
}

export type EventSessionNextAgentSwitched1 = {
  id: string
  type: "session.next.agent.switched"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    agent: string
  }
}

export type EventSessionNextModelSwitched1 = {
  id: string
  type: "session.next.model.switched"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    model: ModelRef
  }
}

export type EventSessionNextMoved1 = {
  id: string
  type: "session.next.moved"
  properties: {
    timestamp: number
    sessionID: string
    location: LocationRef
    subdirectory?: string
  }
}

export type EventSessionNextPrompted1 = {
  id: string
  type: "session.next.prompted"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    prompt: Prompt
    delivery: "steer" | "queue"
  }
}

export type EventSessionNextPromptAdmitted1 = {
  id: string
  type: "session.next.prompt.admitted"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    prompt: Prompt
    delivery: "steer" | "queue"
  }
}

export type EventSessionNextContextUpdated1 = {
  id: string
  type: "session.next.context.updated"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    text: string
  }
}

export type EventSessionNextSynthetic1 = {
  id: string
  type: "session.next.synthetic"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    text: string
  }
}

export type EventSessionNextShellStarted1 = {
  id: string
  type: "session.next.shell.started"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    callID: string
    command: string
  }
}

export type EventSessionNextShellEnded1 = {
  id: string
  type: "session.next.shell.ended"
  properties: {
    timestamp: number
    sessionID: string
    callID: string
    output: string
  }
}

export type EventSessionNextStepStarted1 = {
  id: string
  type: "session.next.step.started"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    agent: string
    model: ModelRef
    snapshot?: string
  }
}

export type EventSessionNextStepEnded1 = {
  id: string
  type: "session.next.step.ended"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    finish: string
    cost: number
    tokens: {
      input: number
      output: number
      reasoning: number
      cache: {
        read: number
        write: number
      }
    }
    snapshot?: string
    files?: Array<string>
  }
}

export type EventSessionNextStepFailed1 = {
  id: string
  type: "session.next.step.failed"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    error: SessionErrorUnknown
  }
}

export type EventSessionNextTextStarted1 = {
  id: string
  type: "session.next.text.started"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    textID: string
  }
}

export type EventSessionNextTextDelta1 = {
  id: string
  type: "session.next.text.delta"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    textID: string
    delta: string
  }
}

export type EventSessionNextTextEnded1 = {
  id: string
  type: "session.next.text.ended"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    textID: string
    text: string
  }
}

export type EventSessionNextReasoningStarted1 = {
  id: string
  type: "session.next.reasoning.started"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    reasoningID: string
    providerMetadata?: LlmProviderMetadata
  }
}

export type EventSessionNextReasoningDelta1 = {
  id: string
  type: "session.next.reasoning.delta"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    reasoningID: string
    delta: string
  }
}

export type EventSessionNextReasoningEnded1 = {
  id: string
  type: "session.next.reasoning.ended"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    reasoningID: string
    text: string
    providerMetadata?: LlmProviderMetadata
  }
}

export type EventSessionNextToolInputStarted1 = {
  id: string
  type: "session.next.tool.input.started"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    name: string
  }
}

export type EventSessionNextToolInputDelta1 = {
  id: string
  type: "session.next.tool.input.delta"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    delta: string
  }
}

export type EventSessionNextToolInputEnded1 = {
  id: string
  type: "session.next.tool.input.ended"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    text: string
  }
}

export type EventSessionNextToolCalled1 = {
  id: string
  type: "session.next.tool.called"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    tool: string
    input: {
      [key: string]: unknown
    }
    provider: {
      executed: boolean
      metadata?: LlmProviderMetadata
    }
  }
}

export type EventSessionNextToolProgress1 = {
  id: string
  type: "session.next.tool.progress"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    structured: {
      [key: string]: unknown
    }
    content: Array<LlmToolContent>
  }
}

export type EventSessionNextToolSuccess1 = {
  id: string
  type: "session.next.tool.success"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    structured: {
      [key: string]: unknown
    }
    content: Array<LlmToolContent>
    outputPaths?: Array<string>
    result?: unknown
    provider: {
      executed: boolean
      metadata?: LlmProviderMetadata
    }
  }
}

export type EventSessionNextToolFailed1 = {
  id: string
  type: "session.next.tool.failed"
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID: string
    callID: string
    error: SessionErrorUnknown
    result?: unknown
    provider: {
      executed: boolean
      metadata?: LlmProviderMetadata
    }
  }
}

export type EventSessionNextRetried1 = {
  id: string
  type: "session.next.retried"
  properties: {
    timestamp: number
    sessionID: string
    attempt: number
    error: SessionNextRetryError
  }
}

export type EventSessionNextCompactionStarted1 = {
  id: string
  type: "session.next.compaction.started"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    reason: "auto" | "manual"
  }
}

export type EventSessionNextCompactionDelta1 = {
  id: string
  type: "session.next.compaction.delta"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    text: string
  }
}

export type EventSessionNextCompactionEnded1 = {
  id: string
  type: "session.next.compaction.ended"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
    reason: "auto" | "manual"
    text: string
    recent: string
    include?: string
  }
}

export type EventSessionNextRevertStaged1 = {
  id: string
  type: "session.next.revert.staged"
  properties: {
    timestamp: number
    sessionID: string
    revert: RevertState
  }
}

export type EventSessionNextRevertCleared1 = {
  id: string
  type: "session.next.revert.cleared"
  properties: {
    timestamp: number
    sessionID: string
  }
}

export type EventSessionNextRevertCommitted1 = {
  id: string
  type: "session.next.revert.committed"
  properties: {
    timestamp: number
    sessionID: string
    messageID: string
  }
}

export type EventMessagePartDelta1 = {
  id: string
  type: "message.part.delta"
  properties: {
    sessionID: string
    messageID: string
    partID: string
    field: string
    delta: string
  }
}

export type EventSessionDiff1 = {
  id: string
  type: "session.diff"
  properties: {
    sessionID: string
    diff: Array<SnapshotFileDiff>
  }
}

export type EventSessionError1 = {
  id: string
  type: "session.error"
  properties: {
    sessionID?: string
    error?:
      | ProviderAuthError
      | UnknownError
      | MessageOutputLengthError
      | MessageAbortedError
      | StructuredOutputError
      | ContextOverflowError
      | ContentFilterError
      | ApiError
  }
}

export type EventInstallationUpdated1 = {
  id: string
  type: "installation.updated"
  properties: {
    version: string
  }
}

export type EventInstallationUpdateAvailable1 = {
  id: string
  type: "installation.update-available"
  properties: {
    version: string
  }
}

export type EventFileEdited1 = {
  id: string
  type: "file.edited"
  properties: {
    file: string
  }
}

export type EventReferenceUpdated1 = {
  id: string
  type: "reference.updated"
  properties: {
    [key: string]: unknown
  }
}

export type EventPermissionV2Asked1 = {
  id: string
  type: "permission.v2.asked"
  properties: {
    id: string
    sessionID: string
    action: string
    resources: Array<string>
    save?: Array<string>
    metadata?: {
      [key: string]: unknown
    }
    source?: PermissionV2Source
  }
}

export type EventPermissionV2Replied1 = {
  id: string
  type: "permission.v2.replied"
  properties: {
    sessionID: string
    requestID: string
    reply: PermissionV2Reply
  }
}

export type EventPluginAdded1 = {
  id: string
  type: "plugin.added"
  properties: {
    id: string
  }
}

export type EventProjectDirectoriesUpdated1 = {
  id: string
  type: "project.directories.updated"
  properties: {
    projectID: string
  }
}

export type EventFileWatcherUpdated1 = {
  id: string
  type: "file.watcher.updated"
  properties: {
    file: string
    event: "add" | "change" | "unlink"
  }
}

export type EventPtyCreated1 = {
  id: string
  type: "pty.created"
  properties: {
    info: Pty
  }
}

export type EventPtyUpdated1 = {
  id: string
  type: "pty.updated"
  properties: {
    info: Pty
  }
}

export type EventPtyExited1 = {
  id: string
  type: "pty.exited"
  properties: {
    id: string
    exitCode: number
  }
}

export type EventPtyDeleted1 = {
  id: string
  type: "pty.deleted"
  properties: {
    id: string
  }
}

export type EventQuestionV2Asked1 = {
  id: string
  type: "question.v2.asked"
  properties: {
    id: string
    sessionID: string
    /**
     * Questions to ask
     */
    questions: Array<QuestionV2Info>
    tool?: QuestionV2Tool
  }
}

export type EventQuestionV2Replied1 = {
  id: string
  type: "question.v2.replied"
  properties: {
    sessionID: string
    requestID: string
    answers: Array<QuestionV2Answer>
  }
}

export type EventQuestionV2Rejected1 = {
  id: string
  type: "question.v2.rejected"
  properties: {
    sessionID: string
    requestID: string
  }
}

export type EventTodoUpdated1 = {
  id: string
  type: "todo.updated"
  properties: {
    sessionID: string
    todos: Array<Todo>
  }
}

export type EventLspUpdated1 = {
  id: string
  type: "lsp.updated"
  properties: {
    [key: string]: unknown
  }
}

export type EventPermissionAsked1 = {
  id: string
  type: "permission.asked"
  properties: {
    id: string
    sessionID: string
    permission: string
    patterns: Array<string>
    metadata: {
      [key: string]: unknown
    }
    always: Array<string>
    tool?: {
      messageID: string
      callID: string
    }
  }
}

export type EventPermissionReplied1 = {
  id: string
  type: "permission.replied"
  properties: {
    sessionID: string
    requestID: string
    reply: "once" | "always" | "reject"
  }
}

export type EventTuiPromptAppend1 = {
  id: string
  type: "tui.prompt.append"
  properties: {
    text: string
  }
}

export type EventTuiCommandExecute1 = {
  id: string
  type: "tui.command.execute"
  properties: {
    command:
      | "session.list"
      | "session.new"
      | "session.share"
      | "session.interrupt"
      | "session.compact"
      | "session.page.up"
      | "session.page.down"
      | "session.line.up"
      | "session.line.down"
      | "session.half.page.up"
      | "session.half.page.down"
      | "session.first"
      | "session.last"
      | "prompt.clear"
      | "prompt.submit"
      | "agent.cycle"
      | string
  }
}

export type EventTuiToastShow1 = {
  id: string
  type: "tui.toast.show"
  properties: {
    title?: string
    message: string
    variant: "info" | "success" | "warning" | "error"
    duration?: number
  }
}

export type EventTuiSessionSelect1 = {
  id: string
  type: "tui.session.select"
  properties: {
    /**
     * Session ID to navigate to
     */
    sessionID: string
  }
}

export type EventMcpToolsChanged1 = {
  id: string
  type: "mcp.tools.changed"
  properties: {
    server: string
  }
}

export type EventMcpBrowserOpenFailed1 = {
  id: string
  type: "mcp.browser.open.failed"
  properties: {
    mcpName: string
    url: string
  }
}

export type EventCommandExecuted1 = {
  id: string
  type: "command.executed"
  properties: {
    name: string
    sessionID: string
    arguments: string
    messageID: string
  }
}

export type EventProjectUpdated1 = {
  id: string
  type: "project.updated"
  properties: {
    id: string
    worktree: string
    vcs?: ProjectVcs
    name?: string
    icon?: ProjectIcon
    commands?: ProjectCommands
    time: ProjectTime
    sandboxes: Array<string>
  }
}

export type EventSessionStatus1 = {
  id: string
  type: "session.status"
  properties: {
    sessionID: string
    status: SessionStatus
  }
}

export type EventSessionIdle1 = {
  id: string
  type: "session.idle"
  properties: {
    sessionID: string
  }
}

export type EventQuestionAsked1 = {
  id: string
  type: "question.asked"
  properties: {
    id: string
    sessionID: string
    /**
     * Questions to ask
     */
    questions: Array<QuestionInfo>
    blocking?: boolean
    tool?: QuestionTool
  }
}

export type EventQuestionReplied1 = {
  id: string
  type: "question.replied"
  properties: {
    sessionID: string
    requestID: string
    answers: Array<QuestionAnswer>
  }
}

export type EventQuestionRejected1 = {
  id: string
  type: "question.rejected"
  properties: {
    sessionID: string
    requestID: string
  }
}

export type EventSessionCompacted1 = {
  id: string
  type: "session.compacted"
  properties: {
    sessionID: string
  }
}

export type EventVcsBranchUpdated1 = {
  id: string
  type: "vcs.branch.updated"
  properties: {
    branch?: string
  }
}

export type EventWorkspaceReady1 = {
  id: string
  type: "workspace.ready"
  properties: {
    name: string
  }
}

export type EventWorkspaceFailed1 = {
  id: string
  type: "workspace.failed"
  properties: {
    message: string
  }
}

export type EventWorkspaceStatus1 = {
  id: string
  type: "workspace.status"
  properties: {
    workspaceID: string
    status: "connected" | "connecting" | "disconnected" | "error"
  }
}

export type EventWorktreeReady1 = {
  id: string
  type: "worktree.ready"
  properties: {
    name: string
    branch?: string
  }
}

export type EventWorktreeFailed1 = {
  id: string
  type: "worktree.failed"
  properties: {
    message: string
  }
}

export type EventServerConnected1 = {
  id: string
  type: "server.connected"
  properties: {
    [key: string]: unknown
  }
}

export type EventGlobalDisposed1 = {
  id: string
  type: "global.disposed"
  properties: {
    [key: string]: unknown
  }
}

export type EventGlobalConfigUpdated1 = {
  id: string
  type: "global.config.updated"
  properties: {
    [key: string]: unknown
  }
}

export type EventMemoryStatus1 = {
  id: string
  type: "memory.status"
  properties: {
    directory: string
    sessionID?: string
    enabled: boolean
    state: "idle" | "checking" | "injecting" | "updating" | "skipped" | "error"
    reason?: string
    project: {
      bytes: number | "NaN" | "Infinity" | "-Infinity"
      estimatedTokens: number | "NaN" | "Infinity" | "-Infinity"
      truncated: boolean
      updatedAt?: number | "NaN" | "Infinity" | "-Infinity"
    }
    consolidation?: {
      trigger: "explicit" | "turn-close" | "rebuild"
      operationCount: number | "NaN" | "Infinity" | "-Infinity"
      cost: number | "NaN" | "Infinity" | "-Infinity"
      tokens: number | "NaN" | "Infinity" | "-Infinity"
    }
    detail?: {
      type: "saved" | "skipped" | "recalled"
      message: string
      reason?: string
      duplicateOf?: string
      tokens?: number | "NaN" | "Infinity" | "-Infinity"
      operationCount?: number | "NaN" | "Infinity" | "-Infinity"
      added?: number | "NaN" | "Infinity" | "-Infinity"
      removed?: number | "NaN" | "Infinity" | "-Infinity"
      skippedCount?: number | "NaN" | "Infinity" | "-Infinity"
      sources?: Array<string>
      files?: Array<string>
    }
  }
}

export type EventMemoryUpdated1 = {
  id: string
  type: "memory.updated"
  properties: {
    directory: string
    sessionID?: string
    enabled: boolean
    state: "idle" | "checking" | "injecting" | "updating" | "skipped" | "error"
    reason?: string
    project: {
      bytes: number | "NaN" | "Infinity" | "-Infinity"
      estimatedTokens: number | "NaN" | "Infinity" | "-Infinity"
      truncated: boolean
      updatedAt?: number | "NaN" | "Infinity" | "-Infinity"
    }
    consolidation?: {
      trigger: "explicit" | "turn-close" | "rebuild"
      operationCount: number | "NaN" | "Infinity" | "-Infinity"
      cost: number | "NaN" | "Infinity" | "-Infinity"
      tokens: number | "NaN" | "Infinity" | "-Infinity"
    }
    detail?: {
      type: "saved" | "skipped" | "recalled"
      message: string
      reason?: string
      duplicateOf?: string
      tokens?: number | "NaN" | "Infinity" | "-Infinity"
      operationCount?: number | "NaN" | "Infinity" | "-Infinity"
      added?: number | "NaN" | "Infinity" | "-Infinity"
      removed?: number | "NaN" | "Infinity" | "-Infinity"
      skippedCount?: number | "NaN" | "Infinity" | "-Infinity"
      sources?: Array<string>
      files?: Array<string>
    }
  }
}

export type EventMemoryError1 = {
  id: string
  type: "memory.error"
  properties: {
    directory: string
    sessionID?: string
    enabled: boolean
    state: "idle" | "checking" | "injecting" | "updating" | "skipped" | "error"
    reason?: string
    project: {
      bytes: number | "NaN" | "Infinity" | "-Infinity"
      estimatedTokens: number | "NaN" | "Infinity" | "-Infinity"
      truncated: boolean
      updatedAt?: number | "NaN" | "Infinity" | "-Infinity"
    }
    consolidation?: {
      trigger: "explicit" | "turn-close" | "rebuild"
      operationCount: number | "NaN" | "Infinity" | "-Infinity"
      cost: number | "NaN" | "Infinity" | "-Infinity"
      tokens: number | "NaN" | "Infinity" | "-Infinity"
    }
    detail?: {
      type: "saved" | "skipped" | "recalled"
      message: string
      reason?: string
      duplicateOf?: string
      tokens?: number | "NaN" | "Infinity" | "-Infinity"
      operationCount?: number | "NaN" | "Infinity" | "-Infinity"
      added?: number | "NaN" | "Infinity" | "-Infinity"
      removed?: number | "NaN" | "Infinity" | "-Infinity"
      skippedCount?: number | "NaN" | "Infinity" | "-Infinity"
      sources?: Array<string>
      files?: Array<string>
    }
  }
}

export type EventTuiToastShow22 = {
  id: string
  type: "tui.toast.show"
  properties: {
    title?: string
    message: string
    variant: "info" | "success" | "warning" | "error"
    duration?: number
  }
}

export type ProviderListResponses = {
  /**
   * List of providers
   */
  200: {
    all: Array<Provider>
    default: {
      [key: string]: string
    }
    connected: Array<string>
    failed: Array<string>
  }
}

export type ProviderListResponse = ProviderListResponses[keyof ProviderListResponses]

export type KilocodeSessionModelUsageResponses = {
  /**
   * Model usage for a session tree
   */
  200: {
    sessionIDs: Array<string>
    totals: {
      steps: number
      cost: number
      tokens: {
        input: number
        output: number
        reasoning: number
        cache: {
          read: number
          write: number
        }
      }
    }
    models: Array<{
      providerID: string
      modelID: string
      steps: number
      cost: number
      tokens: {
        input: number
        output: number
        reasoning: number
        cache: {
          read: number
          write: number
        }
      }
    }>
  }
}

export type KilocodeSessionModelUsageResponse =
  KilocodeSessionModelUsageResponses[keyof KilocodeSessionModelUsageResponses]

export type KilocodeSessionImportProjectData = {
  body?: {
    id: string
    worktree: string
    vcs?: string
    name?: string
    iconUrl?: string
    iconColor?: string
    timeCreated: number
    timeUpdated: number
    timeInitialized?: number
    sandboxes: Array<string>
    commands?: {
      start?: string
    }
  }
  path?: never
  query?: {
    directory?: string
    workspace?: string
  }
  url: "/kilocode/session-import/project"
}

export type KilocodeSessionImportSessionData = {
  body?: {
    id: string
    projectID: string
    force?: boolean
    workspaceID?: string
    parentID?: string
    slug: string
    directory: string
    title: string
    version: string
    shareURL?: string
    summary?: {
      additions: number
      deletions: number
      files: number
      diffs?: Array<{
        [key: string]: unknown
      }>
    }
    revert?: {
      messageID: string
      partID?: string
      snapshot?: string
      diff?: string
      workspace?: "restored" | "snapshots-disabled" | "unavailable"
    }
    permission?: {
      [key: string]: unknown
    }
    timeCreated: number
    timeUpdated: number
    timeCompacting?: number
    timeArchived?: number
  }
  path?: never
  query?: {
    directory?: string
    workspace?: string
  }
  url: "/kilocode/session-import/session"
}

export type KilocodeSessionImportMessageData = {
  body?: {
    id: string
    sessionID: string
    timeCreated: number
    data:
      | {
          role: "user"
          time: {
            created: number
          }
          agent: string
          model: {
            providerID: string
            modelID: string
          }
          tools?: {
            [key: string]: boolean
          }
        }
      | {
          role: "assistant"
          time: {
            created: number
            completed?: number
          }
          parentID: string
          modelID: string
          providerID: string
          mode: string
          agent: string
          path: {
            cwd: string
            root: string
          }
          summary?: boolean
          cost: number
          tokens: {
            total?: number
            input: number
            output: number
            reasoning: number
            cache: {
              read: number
              write: number
            }
          }
          structured?: unknown
          variant?: string
          finish?: string
        }
  }
  path?: never
  query?: {
    directory?: string
    workspace?: string
  }
  url: "/kilocode/session-import/message"
}

export type KilocodeSessionImportPartData = {
  body?: {
    id: string
    messageID: string
    sessionID: string
    timeCreated?: number
    data:
      | {
          type: "text"
          text: string
          synthetic?: boolean
          ignored?: boolean
          time?: {
            start: number
            end?: number
          }
          metadata?: {
            [key: string]: unknown
          }
        }
      | {
          type: "reasoning"
          text: string
          metadata?: {
            [key: string]: unknown
          }
          time: {
            start: number
            end?: number
          }
        }
      | {
          type: "tool"
          callID: string
          tool: string
          state:
            | {
                status: "pending"
                input: {
                  [key: string]: unknown
                }
                raw: string
              }
            | {
                status: "running"
                input: {
                  [key: string]: unknown
                }
                title?: string
                metadata?: {
                  [key: string]: unknown
                }
                time: {
                  start: number
                }
              }
            | {
                status: "completed"
                input: {
                  [key: string]: unknown
                }
                output: string
                title: string
                metadata: {
                  [key: string]: unknown
                }
                time: {
                  start: number
                  end: number
                  compacted?: number
                }
              }
            | {
                status: "error"
                input: {
                  [key: string]: unknown
                }
                error: string
                metadata?: {
                  [key: string]: unknown
                }
                time: {
                  start: number
                  end: number
                }
              }
          metadata?: {
            [key: string]: unknown
          }
        }
  }
  path?: never
  query?: {
    directory?: string
    workspace?: string
  }
  url: "/kilocode/session-import/part"
}

export type MemoryStatusResponses = {
  /**
   * Memory status
   */
  200: {
    root: string
    state: {
      version: 1
      enabled: boolean
      scope: "project"
      autoInject: boolean
      autoConsolidate: boolean
      verbose: boolean
      capture: {
        mode: "selective"
        turnClose: boolean
        explicit: boolean
        maxOpsPerRun: number
        minIntervalMs: number
        timeoutMs: number
      }
      limits: {
        maxProjectIndexBytes: number
        maxSessionFiles: number
        maxRecentSessions: number
        maxConsolidationInputBytes: number
        maxLineChars: number
        maxSessionLineChars: number
      }
      stats: {
        lastInjectedAt: number
        lastInjectedBytes: number
        lastInjectedTokens: number
        lastInjectedSessionID: string
        lastTypedConsolidationAt: number
        lastSessionSavedAt: number
        lastConsolidationCost: number
        lastConsolidationTokens: number
        lastOperationCount: number
        lastRecallAt: number
        lastRecallCount: number
        lastRecallSessionID: string
      }
    }
    exists: {
      state: boolean
      index: boolean
    }
    index: {
      bytes: number
      estimatedTokens: number
      preview: string
    }
  }
}

export type MemoryStatusResponse = MemoryStatusResponses[keyof MemoryStatusResponses]

export type MemoryEnableResponses = {
  /**
   * Memory enabled
   */
  200: {
    root: string
    state: {
      version: 1
      enabled: boolean
      scope: "project"
      autoInject: boolean
      autoConsolidate: boolean
      verbose: boolean
      capture: {
        mode: "selective"
        turnClose: boolean
        explicit: boolean
        maxOpsPerRun: number
        minIntervalMs: number
        timeoutMs: number
      }
      limits: {
        maxProjectIndexBytes: number
        maxSessionFiles: number
        maxRecentSessions: number
        maxConsolidationInputBytes: number
        maxLineChars: number
        maxSessionLineChars: number
      }
      stats: {
        lastInjectedAt: number
        lastInjectedBytes: number
        lastInjectedTokens: number
        lastInjectedSessionID: string
        lastTypedConsolidationAt: number
        lastSessionSavedAt: number
        lastConsolidationCost: number
        lastConsolidationTokens: number
        lastOperationCount: number
        lastRecallAt: number
        lastRecallCount: number
        lastRecallSessionID: string
      }
    }
    index: {
      text: string
      bytes: number
      tokens: number
      truncated: boolean
    }
  }
}

export type MemoryEnableResponse = MemoryEnableResponses[keyof MemoryEnableResponses]

export type MemoryDisableResponses = {
  /**
   * Memory disabled
   */
  200: {
    root: string
    state: {
      version: 1
      enabled: boolean
      scope: "project"
      autoInject: boolean
      autoConsolidate: boolean
      verbose: boolean
      capture: {
        mode: "selective"
        turnClose: boolean
        explicit: boolean
        maxOpsPerRun: number
        minIntervalMs: number
        timeoutMs: number
      }
      limits: {
        maxProjectIndexBytes: number
        maxSessionFiles: number
        maxRecentSessions: number
        maxConsolidationInputBytes: number
        maxLineChars: number
        maxSessionLineChars: number
      }
      stats: {
        lastInjectedAt: number
        lastInjectedBytes: number
        lastInjectedTokens: number
        lastInjectedSessionID: string
        lastTypedConsolidationAt: number
        lastSessionSavedAt: number
        lastConsolidationCost: number
        lastConsolidationTokens: number
        lastOperationCount: number
        lastRecallAt: number
        lastRecallCount: number
        lastRecallSessionID: string
      }
    }
  }
}

export type MemoryDisableResponse = MemoryDisableResponses[keyof MemoryDisableResponses]

export type MemoryConfigureResponses = {
  /**
   * Memory configured
   */
  200: {
    root: string
    state: {
      version: 1
      enabled: boolean
      scope: "project"
      autoInject: boolean
      autoConsolidate: boolean
      verbose: boolean
      capture: {
        mode: "selective"
        turnClose: boolean
        explicit: boolean
        maxOpsPerRun: number
        minIntervalMs: number
        timeoutMs: number
      }
      limits: {
        maxProjectIndexBytes: number
        maxSessionFiles: number
        maxRecentSessions: number
        maxConsolidationInputBytes: number
        maxLineChars: number
        maxSessionLineChars: number
      }
      stats: {
        lastInjectedAt: number
        lastInjectedBytes: number
        lastInjectedTokens: number
        lastInjectedSessionID: string
        lastTypedConsolidationAt: number
        lastSessionSavedAt: number
        lastConsolidationCost: number
        lastConsolidationTokens: number
        lastOperationCount: number
        lastRecallAt: number
        lastRecallCount: number
        lastRecallSessionID: string
      }
    }
  }
}

export type MemoryConfigureResponse = MemoryConfigureResponses[keyof MemoryConfigureResponses]

export type MemoryRebuildResponses = {
  /**
   * Memory rebuilt
   */
  200: {
    root: string
    state: {
      version: 1
      enabled: boolean
      scope: "project"
      autoInject: boolean
      autoConsolidate: boolean
      verbose: boolean
      capture: {
        mode: "selective"
        turnClose: boolean
        explicit: boolean
        maxOpsPerRun: number
        minIntervalMs: number
        timeoutMs: number
      }
      limits: {
        maxProjectIndexBytes: number
        maxSessionFiles: number
        maxRecentSessions: number
        maxConsolidationInputBytes: number
        maxLineChars: number
        maxSessionLineChars: number
      }
      stats: {
        lastInjectedAt: number
        lastInjectedBytes: number
        lastInjectedTokens: number
        lastInjectedSessionID: string
        lastTypedConsolidationAt: number
        lastSessionSavedAt: number
        lastConsolidationCost: number
        lastConsolidationTokens: number
        lastOperationCount: number
        lastRecallAt: number
        lastRecallCount: number
        lastRecallSessionID: string
      }
    }
    index: {
      text: string
      bytes: number
      tokens: number
      truncated: boolean
    }
  }
}

export type MemoryRebuildResponse = MemoryRebuildResponses[keyof MemoryRebuildResponses]

export type MemoryRememberResponses = {
  /**
   * Memory operation result
   */
  200: {
    operationCount: number
    added: number
    removed: number
    skipped: Array<{
      reason: "self_referential" | "out_of_scope" | "secret"
      text?: string
    }>
    index: {
      text: string
      bytes: number
      tokens: number
      truncated: boolean
    }
  }
}

export type MemoryRememberResponse = MemoryRememberResponses[keyof MemoryRememberResponses]

export type MemoryCorrectResponses = {
  /**
   * Memory correction result
   */
  200: {
    operationCount: number
    added: number
    removed: number
    skipped: Array<{
      reason: "self_referential" | "out_of_scope" | "secret"
      text?: string
    }>
    index: {
      text: string
      bytes: number
      tokens: number
      truncated: boolean
    }
  }
}

export type MemoryCorrectResponse = MemoryCorrectResponses[keyof MemoryCorrectResponses]

export type MemoryForgetResponses = {
  /**
   * Memory forget result
   */
  200: {
    operationCount: number
    added: number
    removed: number
    skipped: Array<{
      reason: "self_referential" | "out_of_scope" | "secret"
      text?: string
    }>
    index: {
      text: string
      bytes: number
      tokens: number
      truncated: boolean
    }
  }
}

export type MemoryForgetResponse = MemoryForgetResponses[keyof MemoryForgetResponses]

export type MemoryPurgeResponses = {
  /**
   * Memory purged
   */
  200: {
    root: string
    purged: boolean
  }
}

export type MemoryPurgeResponse = MemoryPurgeResponses[keyof MemoryPurgeResponses]

export type AgentPartInput = {
  id?: string
  type: "agent"
  name: string
  source?: {
    value: string
    start: number
    end: number
  }
}

export type SubtaskPartInput = {
  id?: string
  type: "subtask"
  prompt: string
  description: string
  agent: string
  model?: {
    providerID: string
    modelID: string
  }
  variant?: string
  command?: string
}
