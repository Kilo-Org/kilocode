/**
 * Session context
 * Manages session state, messages, and handles SSE events from the extension.
 * Also owns global (extension-lifetime) model selection (provider context is catalog-only).
 */

import { createContext, useContext, createSignal, createMemo, createEffect, onMount, onCleanup, batch } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useVSCode } from "./vscode"
import { useServer } from "./server"
import { useProvider } from "./provider"
import { useConfig } from "./config"
import { useLanguage } from "./language"
import { showToast } from "@kilocode/kilo-ui/toast"
import type {
  SessionInfo,
  Message,
  Part,
  PartDelta,
  SessionStatus,
  SessionStatusInfo,
  PermissionRequest,
  QuestionRequest,
  SuggestionRequest,
  TodoItem,
  ModelSelection,
  ContextUsage,
  AgentInfo,
  SkillInfo,
  ExtensionMessage,
  FileAttachment,
  SendMessageFailedMessage,
  McpStatusEntry,
  MessageLoadMode,
} from "../types/messages"
import { removeSessionPermissions, upsertPermission } from "./permission-queue"
import {
  computeStatus,
  calcContextUsage,
  buildFamilyCosts,
  buildFamilyLabels,
  buildCostBreakdown,
  childID,
} from "./session-utils"
import { Identifier } from "../utils/id"
import { resolveModelSelection } from "./model-selection"
import { resolveSessionAgent } from "./session-agent"
import { PartStash } from "./part-stash"
import { KILO_AUTO, parseModelString } from "../../../src/shared/provider-model"

const RECENT_LIMIT = 5
const MESSAGE_PAGE_LIMIT = 80

type MessageMutation = Exclude<MessageLoadMode, "focus"> | "append" | "update"

interface MessagePageState {
  initialLoaded: boolean
  loadingInitial: boolean
  loadingOlder: boolean
  before?: string
  hasMore: boolean
  lastMutation?: MessageMutation
}

const emptyPageState: MessagePageState = {
  initialLoaded: false,
  loadingInitial: false,
  loadingOlder: false,
  hasMore: false,
}

// Store structure for messages and parts
interface SessionStore {
  sessions: Record<string, SessionInfo>
  messages: Record<string, Message[]> // sessionID -> messages
  parts: Record<string, Part[]> // messageID -> parts
  todos: Record<string, TodoItem[]> // sessionID -> todos
  modelSelections: Record<string, ModelSelection | null> // agentName -> model (global, extension-lifetime)
  sessionOverrides: Record<string, ModelSelection> // sessionID -> per-session model override (compare mode)
  agentSelections: Record<string, string> // sessionID -> agent name
  variantSelections: Record<string, string> // "providerID/modelID" -> variant name
  recentModels: ModelSelection[]
  favoriteModels: ModelSelection[]
}

interface SessionContextValue {
  // Current session
  currentSessionID: Accessor<string | undefined>
  currentSession: Accessor<SessionInfo | undefined>
  setCurrentSessionID: (id: string | undefined) => void

  // All sessions (sorted most recent first)
  sessions: Accessor<SessionInfo[]>

  // Session status
  status: Accessor<SessionStatus>
  statusInfo: Accessor<SessionStatusInfo>
  statusText: Accessor<string | undefined>
  busySince: Accessor<number | undefined>
  loading: Accessor<boolean>
  loadingOlderMessages: Accessor<boolean>
  hasOlderMessages: Accessor<boolean>
  messageMutation: Accessor<MessageMutation | undefined>

  // Messages for current session
  messages: Accessor<Message[]>

  // User messages for current session (role === "user")
  userMessages: Accessor<Message[]>

  // All messages keyed by sessionID (includes child sessions)
  allMessages: () => Record<string, Message[]>

  // All parts keyed by messageID (includes child sessions)
  allParts: () => Record<string, Part[]>

  // All session statuses keyed by sessionID (for DataBridge)
  allStatusMap: () => Record<string, SessionStatusInfo>

  // Parts for a specific message
  getParts: (messageID: string) => Part[]

  // Move stashed parts into the reactive store for the given message IDs.
  // Called by VscodeSessionTurn when the virtualizer renders a turn.
  hydrateParts: (messageIDs: string[]) => void

  // Todos for current session
  todos: Accessor<TodoItem[]>

  // Pending permission requests (unscoped — all tracked sessions)
  permissions: Accessor<PermissionRequest[]>
  respondingPermissions: Accessor<Set<string>>

  // Pending question requests (unscoped — all tracked sessions)
  questions: Accessor<QuestionRequest[]>
  questionErrors: Accessor<Set<string>>
  suggestions: Accessor<SuggestionRequest[]>
  suggestionErrors: Accessor<Set<string>>
  respondingSuggestions: Accessor<Set<string>>

  // Scoped permissions/questions — filtered to a session's family (self + subagents)
  scopedPermissions: (sessionID: string | undefined) => PermissionRequest[]
  scopedQuestions: (sessionID: string | undefined) => QuestionRequest[]
  scopedSuggestions: (sessionID: string | undefined) => SuggestionRequest[]

  // Model selection (global, extension-lifetime)
  selected: Accessor<ModelSelection | null>
  selectModel: (providerID: string, modelID: string) => void
  hasModelOverride: Accessor<boolean>
  clearModelOverride: () => void

  // Cost and context usage for the current session
  costBreakdown: Accessor<Array<{ label: string; cost: number }>>
  contextUsage: Accessor<ContextUsage | undefined>

  // Skills loaded from the CLI backend
  skills: Accessor<SkillInfo[]>
  refreshSkills: () => void
  removeSkill: (location: string) => void

  // Agent/mode selection (per-session)
  agents: Accessor<AgentInfo[]>
  allAgents: Accessor<AgentInfo[]>
  removeMode: (name: string) => void
  removeMcp: (name: string) => void

  // MCP server status (runtime connect/disconnect)
  mcpStatus: Accessor<Record<string, McpStatusEntry>>
  mcpLoading: Accessor<string | null>
  connectMcp: (name: string) => void
  disconnectMcp: (name: string) => void
  refreshMcpStatus: () => void
  selectedAgent: Accessor<string>
  selectAgent: (name: string) => void
  getSessionAgent: (sessionID: string) => string
  getSessionModel: (sessionID: string) => ModelSelection | null
  setSessionModel: (sessionID: string, providerID: string, modelID: string) => void
  setSessionAgent: (sessionID: string, name: string) => void

  // Thinking variant for the selected model
  variantList: () => string[]
  currentVariant: () => string | undefined
  selectVariant: (value: string) => void

  // Model favorites
  favoriteModels: Accessor<ModelSelection[]>
  toggleFavorite: (providerID: string, modelID: string) => void

  // Revert/undo state for the current session
  revert: Accessor<SessionInfo["revert"]>
  revertedCount: Accessor<number>
  summary: Accessor<SessionInfo["summary"]>

  // Live worktree diff stats (polled from CLI backend)
  worktreeStats: Accessor<{ files: number; additions: number; deletions: number } | undefined>

  // Actions
  revertSession: (messageID: string) => void
  unrevertSession: () => void
  sendMessage: (text: string, providerID?: string, modelID?: string, files?: FileAttachment[], draftID?: string) => void
  sendCommand: (
    command: string,
    args: string,
    providerID?: string,
    modelID?: string,
    files?: FileAttachment[],
    draftID?: string,
  ) => void
  abort: () => void
  compact: () => void
  respondToPermission: (
    permissionId: string,
    response: "once" | "always" | "reject",
    approvedAlways: string[],
    deniedAlways: string[],
  ) => void
  replyToQuestion: (requestID: string, answers: string[][]) => void
  rejectQuestion: (requestID: string) => void
  acceptSuggestion: (requestID: string, index: number) => void
  dismissSuggestion: (requestID: string) => void
  createSession: () => void
  clearCurrentSession: () => void
  loadSessions: () => void
  loadOlderMessages: () => void
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  syncSession: (sessionID: string) => void

  // Cloud session preview
  cloudPreviewId: Accessor<string | null>
  selectCloudSession: (cloudSessionId: string) => void
  draftSessionID: Accessor<string | undefined>
  setDraftSessionID: (id: string | undefined) => void
}

export const SessionContext = createContext<SessionContextValue>()

export const SessionProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const server = useServer()
  const provider = useProvider()
  const { config } = useConfig()
  const language = useLanguage()

  // Current session ID
  const [currentSessionID, setCurrentSessionID] = createSignal<string | undefined>()
  const [draftSessionID, setDraftSessionID] = createSignal<string | undefined>()

  // Per-session status map — keyed by sessionID
  const [statusMap, setStatusMap] = createStore<Record<string, SessionStatusInfo>>({})
  const [busySinceMap, setBusySinceMap] = createStore<Record<string, number>>({})

  const idle: SessionStatusInfo = { type: "idle" }

  // Derived accessors for the current session (backwards compatible)
  const statusInfo = () => {
    const id = currentSessionID()
    return id ? (statusMap[id] ?? idle) : idle
  }
  const status = () => statusInfo().type as SessionStatus
  const busySince = () => {
    const id = currentSessionID()
    return id ? busySinceMap[id] : undefined
  }

  const [loading, setLoading] = createSignal(false)
  const [loaded, setLoaded] = createSignal<Set<string>>(new Set())
  const [pages, setPages] = createStore<Record<string, MessagePageState>>({})

  // Parts stash: holds parts from messagesLoaded outside the reactive store
  // until a VscodeSessionTurn is rendered by the virtualizer and calls
  // hydrateParts(). This avoids writing parts for off-screen messages into
  // the store, which would trigger expensive DOM work for invisible content.
  const stash = new PartStash()

  // Pending permissions
  const [permissions, setPermissions] = createSignal<PermissionRequest[]>([])

  // Permission IDs that have been responded to but not yet confirmed by the server
  const [respondingPermissions, setRespondingPermissions] = createSignal<Set<string>>(new Set())

  // Pending questions
  const [questions, setQuestions] = createSignal<QuestionRequest[]>([])

  // Tracks question IDs that failed so the UI can reset sending state
  const [questionErrors, setQuestionErrors] = createSignal<Set<string>>(new Set())
  const [suggestions, setSuggestions] = createSignal<SuggestionRequest[]>([])
  const [suggestionErrors, setSuggestionErrors] = createSignal<Set<string>>(new Set())
  const [respondingSuggestions, setRespondingSuggestions] = createSignal<Set<string>>(new Set())

  // Tracks whether the user has explicitly set a model override per agent (to
  // prevent the default-sync effect from overwriting it).
  const [userSetAgents, setUserSetAgents] = createSignal<Record<string, boolean>>({})

  // Agents (modes) loaded from the CLI backend
  const [agents, setAgents] = createSignal<AgentInfo[]>([])
  const [allAgents, setAllAgents] = createSignal<AgentInfo[]>([])
  const [defaultAgent, setDefaultAgent] = createSignal("code")

  // Skills loaded from the CLI backend
  const [skills, setSkills] = createSignal<SkillInfo[]>([])

  const removeMode = (name: string) => {
    setAgents((prev) => prev.filter((a) => a.name !== name))

    // Clear stale selections so selectedAgentName() falls back to the default
    if (pendingAgentSelection() === name) {
      setPendingAgentSelection(null)
    }
    setStore(
      "agentSelections",
      produce((selections) => {
        for (const sid of Object.keys(selections)) {
          if (selections[sid] === name) delete selections[sid]
        }
      }),
    )

    vscode.postMessage({ type: "removeMode", name })
  }

  const removeMcp = (name: string) => {
    vscode.postMessage({ type: "removeMcp", name })
  }

  // MCP runtime status
  const [mcpStatus, setMcpStatus] = createSignal<Record<string, McpStatusEntry>>({})
  const [mcpLoading, setMcpLoading] = createSignal<string | null>(null)

  const connectMcp = (name: string) => {
    if (mcpLoading()) return
    if (!server.isConnected()) return
    setMcpLoading(name)
    vscode.postMessage({ type: "connectMcp", name })
  }

  const disconnectMcp = (name: string) => {
    if (mcpLoading()) return
    if (!server.isConnected()) return
    setMcpLoading(name)
    vscode.postMessage({ type: "disconnectMcp", name })
  }

  const refreshMcpStatus = () => {
    vscode.postMessage({ type: "requestMcpStatus" })
  }

  // Pending agent selection for before a session exists
  const [pendingAgentSelection, setPendingAgentSelection] = createSignal<string | null>(null)

  // Cloud session preview state
  const [cloudPreviewId, setCloudPreviewId] = createSignal<string | null>(null)

  // Live worktree diff stats from extension polling
  const [worktreeStats, setWorktreeStats] = createSignal<
    { files: number; additions: number; deletions: number } | undefined
  >()

  // Tracks optimistic messageIDs that haven't been confirmed by the server yet.
  // Prevents handleMessagesLoaded from wiping them when it replaces the array.
  const pendingOptimistic = new Map<string, Set<string>>()

  // Store for sessions, messages, parts, todos, modelSelections, agentSelections
  const [store, setStore] = createStore<SessionStore>({
    sessions: {},
    messages: {},
    parts: {},
    todos: {},
    modelSelections: {},
    sessionOverrides: {},
    agentSelections: {},
    variantSelections: {},
    recentModels: [],
    favoriteModels: [],
  })

  // Per-session agent selection
  const selectedAgentName = createMemo<string>(() => {
    const sessionID = currentSessionID()
    if (sessionID) {
      return store.agentSelections[sessionID] ?? defaultAgent()
    }
    return pendingAgentSelection() ?? defaultAgent()
  })

  const agentNames = createMemo(() => new Set(agents().map((agent) => agent.name)))

  /** Per-mode model from config (e.g. config.agent.code.model). */
  function getModeModel(agentName: string): ModelSelection | null {
    return parseModelString(config().agent?.[agentName]?.model)
  }

  /** Global default model from config (config.model). */
  function getGlobalModel(): ModelSelection | null {
    return parseModelString(config().model)
  }

  function resolveModel(agentName: string, override?: ModelSelection | null): ModelSelection | null {
    return resolveModelSelection({
      providers: provider.providers(),
      connected: provider.connected(),
      override,
      mode: getModeModel(agentName),
      global: getGlobalModel(),
      recent: store.recentModels,
      fallback: KILO_AUTO,
    })
  }

  // Keep model selection in sync with provider/mode default until the user
  // explicitly overrides it.
  createEffect(() => {
    const agentName = selectedAgentName()
    if (userSetAgents()[agentName]) return
    const sel = resolveModel(agentName)
    setStore("modelSelections", agentName, sel)
  })

  // Global model selection per agent/mode
  // Precedence: per-session override > user override > per-mode config > global config model > VS Code default > kilo-auto/free
  // Each candidate is validated against the provider catalog; invalid models fall through.
  const selected = createMemo<ModelSelection | null>(() => {
    const sid = currentSessionID()
    if (sid) {
      const session = store.sessionOverrides[sid]
      if (session) return session
    }
    const agentName = selectedAgentName()
    return resolveModel(agentName, store.modelSelections[agentName])
  })

  function pushRecent(selection: ModelSelection) {
    const key = `${selection.providerID}/${selection.modelID}`
    const filtered = store.recentModels.filter((r) => `${r.providerID}/${r.modelID}` !== key)
    const updated = [selection, ...filtered].slice(0, RECENT_LIMIT)
    setStore("recentModels", updated)
    vscode.postMessage({ type: "persistRecents", recents: updated })
  }

  function applyModel(agentName: string, selection: ModelSelection) {
    pushRecent(selection)
    // Always remember the per-mode model choice so switching modes restores
    // the last-used model (mirrors CLI TUI's model.json behavior).
    setUserSetAgents((prev) => ({ ...prev, [agentName]: true }))
    setStore("modelSelections", agentName, selection)
    // Persist to model.json via the extension host
    vscode.postMessage({
      type: "persistModelSelection",
      agent: agentName,
      providerID: selection.providerID,
      modelID: selection.modelID,
    })
    const sid = currentSessionID()
    if (sid) {
      setStore("sessionOverrides", sid, selection)
    }
  }

  function selectModel(providerID: string, modelID: string) {
    applyModel(selectedAgentName(), { providerID, modelID })
    const sid = currentSessionID()
    if (sid) {
      setStore("messages", sid, (msgs = []) => msgs.filter((m) => !m.error))
    }
  }

  /** The config/default model for the current mode (what settings says). */
  const configModel = createMemo<ModelSelection | null>(() => {
    const agentName = selectedAgentName()
    return resolveModel(agentName)
  })

  /** True when the active model differs from what the config dictates. */
  const hasModelOverride = createMemo<boolean>(() => {
    const sel = selected()
    const cfg = configModel()
    if (!sel || !cfg) return false
    return sel.providerID !== cfg.providerID || sel.modelID !== cfg.modelID
  })

  /** Clear the per-mode model override, falling back to config default. */
  function clearModelOverride() {
    const agentName = selectedAgentName()
    setUserSetAgents((prev) => {
      const next = { ...prev }
      delete next[agentName]
      return next
    })
    setStore(
      "modelSelections",
      produce((selections) => {
        delete selections[agentName]
      }),
    )
    // Clear from model.json via extension host
    vscode.postMessage({ type: "clearModelSelection", agent: agentName })
    // Also clear per-session override so the session falls back to config default
    const sid = currentSessionID()
    if (sid) {
      setStore(
        "sessionOverrides",
        produce((overrides) => {
          delete overrides[sid]
        }),
      )
    }
  }

  // Handle agentsLoaded immediately (not in onMount) so we never miss
  // the initial push that arrives before the DOM mounts. This mirrors the
  // pattern used by ProviderProvider for providersLoaded.
  const unsubAgents = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "agentsLoaded") {
      return
    }
    setAgents(message.agents)
    setAllAgents(message.allAgents ?? message.agents)
    setDefaultAgent(message.defaultAgent)

    const names = new Set(message.agents.map((a) => a.name))

    // Reset pending selection if the agent no longer exists (e.g. after org switch)
    const pending = pendingAgentSelection()
    if (!pending || !names.has(pending)) {
      setPendingAgentSelection(message.defaultAgent)
    }

    // Clear per-session selections that reference a mode no longer available
    setStore(
      "agentSelections",
      produce((selections) => {
        for (const sid of Object.keys(selections)) {
          if (selections[sid] && !names.has(selections[sid]!)) delete selections[sid]
        }
      }),
    )

    // Rescan already-loaded message history so sessions whose messagesLoaded
    // arrived before agentsLoaded (and therefore got no agent selection) are
    // backfilled now that we know the valid agent names.
    batch(() => {
      for (const [sid, msgs] of Object.entries(store.messages)) {
        if (store.agentSelections[sid]) continue
        const agent = resolveSessionAgent(msgs, names)
        if (agent) setStore("agentSelections", sid, agent)
      }
    })
  })

  // Request agents immediately; if the extension's httpClient is not yet ready,
  // extensionDataReady will fire once initialization completes and we retry once.
  vscode.postMessage({ type: "requestAgents" })

  // Skills loaded from the CLI backend
  const unsubSkills = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "skillsLoaded") {
      setSkills(message.skills)
    }
  })

  const refreshSkills = () => {
    vscode.postMessage({ type: "requestSkills" })
  }

  const removeSkill = (location: string) => {
    setSkills((prev) => prev.filter((s) => s.location !== location))
    vscode.postMessage({ type: "removeSkill", location })
  }

  // Handle permission events immediately (not in onMount) so we never miss
  // the first permission request that may arrive before the DOM mounts.
  // This matches the pattern already used for agentsLoaded and skillsLoaded.
  const unsubPermissions = vscode.onMessage((message: ExtensionMessage) => {
    switch (message.type) {
      case "permissionRequest":
        handlePermissionRequest(message.permission)
        break
      case "permissionResolved":
        handlePermissionResolved(message.permissionID)
        break
      case "permissionError":
        handlePermissionError(message.permissionID)
        break
    }
  })
  onCleanup(unsubPermissions)

  // MCP status loaded from CLI backend
  const unsubMcpStatus = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "mcpStatusLoaded") {
      setMcpStatus(message.status)
      setMcpLoading(null)
    }
  })

  // Request MCP status immediately; retry once on extensionDataReady if still missing.
  vscode.postMessage({ type: "requestMcpStatus" })

  const fallback = setTimeout(() => {
    if (agents().length === 0) vscode.postMessage({ type: "requestAgents" })
    if (Object.keys(mcpStatus()).length === 0) vscode.postMessage({ type: "requestMcpStatus" })
  }, 3000)

  const unsubReady = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "extensionDataReady") return
    unsubReady()
    clearTimeout(fallback)
    if (agents().length === 0) vscode.postMessage({ type: "requestAgents" })
    if (Object.keys(mcpStatus()).length === 0) vscode.postMessage({ type: "requestMcpStatus" })
  })

  onCleanup(() => {
    unsubAgents()
    unsubSkills()
    unsubMcpStatus()
    unsubReady()
    clearTimeout(fallback)
  })

  // Variant (thinking effort) selection — keyed by "providerID/modelID"
  const variantKey = (sel: ModelSelection) => `${sel.providerID}/${sel.modelID}`

  const variantList = () => {
    const sel = selected()
    if (!sel) return []
    const model = provider.findModel(sel)
    if (!model?.variants) return []
    return Object.keys(model.variants)
  }

  const currentVariant = () => {
    const sel = selected()
    if (!sel) return undefined
    const list = variantList()
    if (list.length === 0) return undefined
    const stored = store.variantSelections[variantKey(sel)]
    return stored && list.includes(stored) ? stored : list[0]
  }

  const selectVariant = (value: string) => {
    const sel = selected()
    if (!sel) return
    const key = variantKey(sel)
    setStore("variantSelections", key, value)
    vscode.postMessage({ type: "persistVariant", key, value })
  }

  // Load persisted variants from extension globalState
  const unsubVariants = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "variantsLoaded") return
    for (const [k, v] of Object.entries(message.variants)) {
      setStore("variantSelections", k, v)
    }
  })

  vscode.postMessage({ type: "requestVariants" })

  onCleanup(unsubVariants)

  // Load persisted per-mode model selections from model.json via extension host.
  // Uses replace semantics so a reset (empty payload) clears old entries.
  const unsubSelections = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "modelSelectionsLoaded") return
    setStore("modelSelections", reconcile(message.selections))
    const flags: Record<string, boolean> = {}
    for (const name of Object.keys(message.selections)) {
      flags[name] = true
    }
    setUserSetAgents(flags)
  })
  vscode.postMessage({ type: "requestModelSelections" })
  onCleanup(unsubSelections)

  // Load persisted recent models from extension globalState
  const unsubRecents = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "recentsLoaded") return
    setStore("recentModels", message.recents)
  })
  vscode.postMessage({ type: "requestRecents" })
  onCleanup(unsubRecents)

  // Load persisted favorite models from extension globalState
  const unsubFavorites = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "favoritesLoaded") return
    setStore("favoriteModels", message.favorites)
  })
  vscode.postMessage({ type: "requestFavorites" })
  onCleanup(unsubFavorites)

  function handleError(message: Extract<ExtensionMessage, { type: "error" }>) {
    if (!message.sessionID || message.sessionID === currentSessionID()) setLoading(false)
    if (message.sessionID) patchPage(message.sessionID, { loadingInitial: false, loadingOlder: false })
  }

  function toggleFavorite(providerID: string, modelID: string) {
    const key = `${providerID}/${modelID}`
    const idx = store.favoriteModels.findIndex((f) => `${f.providerID}/${f.modelID}` === key)
    const updated =
      idx >= 0 ? store.favoriteModels.filter((_, i) => i !== idx) : [...store.favoriteModels, { providerID, modelID }]
    const action = idx >= 0 ? "remove" : "add"
    setStore("favoriteModels", updated)
    vscode.postMessage({ type: "toggleFavorite", action, providerID, modelID })
  }

  function handleStreamMessage(message: ExtensionMessage): boolean {
    if (message.type === "partUpdated") {
      handlePartUpdated(message.sessionID, message.messageID, message.part, message.delta)
      return true
    }

    if (message.type === "partsUpdated") {
      batch(() => {
        for (const update of message.updates) {
          handlePartUpdated(update.sessionID, update.messageID, update.part, update.delta)
        }
      })
      return true
    }

    return false
  }

  function handleExtensionMessage(message: ExtensionMessage): void {
    // Route suggestion messages (extracted to stay within complexity limit)
    routeSuggestionMessage(message)
    if (handleStreamMessage(message)) return
    switch (message.type) {
      case "sessionCreated":
        handleSessionCreated(message.session, message.draftID)
        break

      case "messagesLoaded":
        handleMessagesLoaded(message.sessionID, message.messages, {
          mode: message.mode,
          cursor: message.cursor,
          hasMore: message.hasMore,
        })
        break

      case "messageCreated":
        handleMessageCreated(message.message)
        break

      case "sessionStatus":
        handleSessionStatus(message.sessionID, message.status, message.attempt, message.message, message.next)
        break

      case "todoUpdated":
        handleTodoUpdated(message.sessionID, message.items)
        break

      case "questionRequest":
        handleQuestionRequest(message.question)
        break

      case "questionResolved":
        handleQuestionResolved(message.requestID)
        break

      case "questionError":
        handleQuestionError(message.requestID)
        break

      case "clearPendingPrompts":
        setPermissions([])
        setQuestions([])
        setSuggestions([])
        setRespondingPermissions(new Set<string>())
        setSuggestionErrors(new Set<string>())
        setRespondingSuggestions(new Set<string>())
        break

      case "sessionsLoaded":
        handleSessionsLoaded(message.sessions, message.preserveSessionIds)
        break

      case "sessionUpdated":
        setStore("sessions", message.session.id, message.session)
        break

      case "sessionDeleted":
        handleSessionDeleted(message.sessionID)
        break

      case "messageRemoved":
        handleMessageRemoved(message.sessionID, message.messageID)
        break

      case "sessionError": {
        if (message.error?.name === "MessageAbortedError") break
        const sid = message.sessionID ?? currentSessionID()
        if (!sid) break
        // Find the last user message in this session to use as parentID
        const msgs = store.messages[sid] ?? []
        const parent = [...msgs].reverse().find((m) => m.role === "user")
        const errorMsg: Message = {
          id: Identifier.ascending("message"),
          sessionID: sid,
          role: "assistant",
          createdAt: new Date().toISOString(),
          parentID: parent?.id,
          error: message.error,
        }
        handleMessageCreated(errorMsg)
        break
      }

      case "error":
        handleError(message)
        break

      case "sendMessageFailed":
        handleSendMessageFailed(message as unknown as SendMessageFailedMessage)
        break

      case "cloudSessionDataLoaded":
        handleCloudSessionDataLoaded(message.cloudSessionId, message.title, message.messages)
        break

      case "cloudSessionImported":
        handleCloudSessionImported(message.cloudSessionId, message.session)
        break

      case "cloudSessionImportFailed":
        setCloudPreviewId(null)
        setCurrentSessionID(undefined)
        setLoading(false)
        showToast({
          variant: "error",
          title: language.t("session.cloud.import.failed") ?? "Failed to import cloud session",
          description: message.error,
        })
        console.error("[Kilo New] Cloud session import failed:", message.error)
        break

      case "worktreeStatsLoaded":
        setWorktreeStats({ files: message.files, additions: message.additions, deletions: message.deletions })
        break
    }
  }

  // Handle messages from extension
  onMount(() => {
    const unsubscribe = vscode.onMessage(handleExtensionMessage)
    onCleanup(unsubscribe)
  })

  // Event handlers
  function handleSessionCreated(session: SessionInfo, draftID?: string) {
    batch(() => {
      setStore("sessions", session.id, session)

      // Only initialize messages if none exist yet — a cloud session import
      // (handleCloudSessionImported) may have already populated messages for
      // this session ID. The SSE session.created event can race with the
      // cloudSessionImported message, and wiping to [] causes a flash of
      // the empty/welcome screen.
      if (!store.messages[session.id]?.length) {
        setStore("messages", session.id, [])
      }

      // Transfer pending agent selection to the new session
      const pendingAgent = pendingAgentSelection()
      if (pendingAgent && !store.agentSelections[session.id]) {
        setStore("agentSelections", session.id, pendingAgent)
        setPendingAgentSelection(null)
      }

      const active = currentSessionID()
      const draft = draftSessionID()
      if (!draftID || draft === draftID || active === draftID) {
        setCurrentSessionID(session.id)
        setDraftSessionID(session.id)
      }
    })
  }

  function patchPage(sessionID: string, patch: Partial<MessagePageState>) {
    setPages(sessionID, { ...(pages[sessionID] ?? emptyPageState), ...patch })
  }

  function mergeMessages(current: Message[], incoming: Message[], mode: Exclude<MessageLoadMode, "focus">) {
    if (mode === "reconcile") {
      // Tail reconcile: incoming is the authoritative newest-N snapshot.
      // Local state may already hold some of those IDs and may also hold
      // newer optimistic entries created after the fetch was taken. Merge
      // by id (server wins on collision) then sort by createdAt so new
      // server messages land in the right position and optimistic tail
      // entries stay at the end.
      const byId = new Map<string, Message>()
      for (const msg of current) byId.set(msg.id, msg)
      for (const msg of incoming) byId.set(msg.id, msg)
      return [...byId.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    }
    const seen = new Set<string>()
    const source = mode === "prepend" ? [...incoming, ...current] : incoming
    return source.filter((msg) => {
      if (seen.has(msg.id)) return false
      seen.add(msg.id)
      return true
    })
  }

  function withPending(sessionID: string, messages: Message[]) {
    const pending = pendingOptimistic.get(sessionID)
    if (!pending || pending.size === 0) return messages
    const ids = new Set(messages.map((msg) => msg.id))
    const current = store.messages[sessionID] ?? []
    const orphans = current.filter((msg) => pending.has(msg.id) && !ids.has(msg.id))
    return [...messages, ...orphans]
  }

  // Cheap shape check: same ids in same order AND same part counts per message.
  // Short-circuits reconcile when the server snapshot matches local state
  // (the common case — SSE didn't actually miss anything), avoiding the
  // 80 setStore("parts", ...) calls per session switch.
  function sameReconcileShape(current: Message[], incoming: Message[]): boolean {
    if (current.length !== incoming.length) return false
    for (let i = 0; i < incoming.length; i++) {
      const c = current[i]!
      const n = incoming[i]!
      if (c.id !== n.id) return false
      if ((c.parts?.length ?? 0) !== (n.parts?.length ?? 0)) return false
    }
    return true
  }

  function handleMessagesLoaded(
    sessionID: string,
    messages: Message[],
    input: { mode?: Exclude<MessageLoadMode, "focus">; cursor?: string; hasMore?: boolean } = {},
  ) {
    const mode = input.mode ?? "replace"
    const reset = mode === "prepend"

    // Reconcile fast-path: if the tail matches local state shape-wise, every
    // message+part-count already agrees with the server. Skip the reactive
    // store churn entirely — virtualizer and rendering stay untouched.
    if (mode === "reconcile" && sameReconcileShape(store.messages[sessionID] ?? [], messages)) {
      patchPage(sessionID, { initialLoaded: true, lastMutation: "update" })
      return
    }

    batch(() => {
      setLoaded((prev) => {
        if (prev.has(sessionID)) return prev
        const next = new Set(prev)
        next.add(sessionID)
        return next
      })
      if (sessionID === currentSessionID()) setLoading(false)

      const current = store.messages[sessionID] ?? []
      const merged =
        mode === "prepend" || mode === "reconcile"
          ? mergeMessages(current, messages, mode)
          : withPending(sessionID, messages)
      // "replace" mode (session switch): assign directly — reconcile's O(n)
      // diff is unnecessary when the entire list is new, and its reactive
      // proxy creation for each message object dominated the trace (~900ms).
      // "prepend" / "reconcile": reconcile to preserve existing proxies.
      if (mode === "replace") {
        setStore("messages", sessionID, merged)
      } else {
        setStore("messages", sessionID, reconcile(merged, { key: "id" }))
      }

      for (const msg of messages) {
        if (!msg.parts || msg.parts.length === 0) continue
        if (mode === "reconcile" && store.parts[msg.id]) {
          // Reconcile on a message already hydrated into the reactive store:
          // write parts directly so visible turns pick up the server-
          // authoritative state immediately instead of waiting for the
          // virtualizer to re-render.
          setStore("parts", msg.id, reconcile(msg.parts, { key: "id" }))
          stash.remove(msg.id)
        } else {
          // Stash parts outside the reactive store — they'll be hydrated
          // on demand when the virtualizer renders the corresponding turn.
          stash.put(msg.id, msg.parts)
        }
      }

      // "reconcile" is a background tail refresh, not a page navigation —
      // preserve the existing pagination cursor/hasMore so "load earlier"
      // keeps working.
      if (mode === "reconcile") {
        patchPage(sessionID, { initialLoaded: true, lastMutation: "update" })
      } else {
        setPages(sessionID, {
          initialLoaded: true,
          loadingInitial: false,
          loadingOlder: false,
          before: input.cursor,
          hasMore: input.hasMore ?? Boolean(input.cursor),
          lastMutation: mode,
        })
      }

      const agent = resolveSessionAgent(merged, agentNames())
      if (agent) {
        setStore("agentSelections", sessionID, agent)
      }
    })
    if (reset) requestAnimationFrame(() => patchPage(sessionID, { lastMutation: undefined }))
  }

  function handleMessageCreated(message: Message) {
    // Message confirmed by server — no longer optimistic.
    // Clear placeholder parts so they don't duplicate alongside real parts
    // arriving via individual part.updated events (the server's message.updated
    // SSE event does NOT include parts).
    const pending = pendingOptimistic.get(message.sessionID)
    const wasOptimistic = pending?.has(message.id)
    pending?.delete(message.id)

    if (wasOptimistic) {
      setStore(
        "parts",
        produce((p) => {
          delete p[message.id]
        }),
      )
    }

    const exists = (store.messages[message.sessionID] ?? []).some((msg) => msg.id === message.id)
    setStore("messages", message.sessionID, (msgs = []) => {
      // Check if message already exists (optimistic or update case).
      // Since we now use the same messageID for optimistic and server messages,
      // this naturally handles the optimistic→real transition.
      const idx = msgs.findIndex((m) => m.id === message.id)
      if (idx >= 0) {
        const updated = [...msgs]
        updated[idx] = { ...msgs[idx], ...message }
        return updated
      }
      return [...msgs, message]
    })
    patchPage(message.sessionID, { initialLoaded: true, lastMutation: exists ? "update" : "append" })

    // Sync mode picker from any message role (user or assistant).
    // agentNames() already excludes subagent/hidden agents, so subtask
    // assistant messages (e.g. "task" agent) are silently ignored.
    const agent = message.agent?.trim()
    if (agent && agentNames().has(agent)) {
      setStore("agentSelections", message.sessionID, agent)
    }

    if (message.parts && message.parts.length > 0) {
      stash.remove(message.id)
      setStore("parts", message.id, message.parts)
    }
  }

  function handlePartUpdated(
    sessionID: string | undefined,
    messageID: string | undefined,
    part: Part,
    delta?: PartDelta,
  ) {
    // Get messageID from the part itself if not provided in the message
    const effectiveMessageID = messageID || part.messageID

    if (!effectiveMessageID) {
      console.warn("[Kilo New] Part updated without messageID:", part.id, part.type)
      return
    }

    if (sessionID) patchPage(sessionID, { lastMutation: "update" })

    // If the stash has parts for this message, hydrate them first so the
    // SSE update merges into the full part list rather than an empty array.
    const stashed = stash.peek(effectiveMessageID)
    if (stashed) {
      stash.remove(effectiveMessageID)
      setStore("parts", effectiveMessageID, stashed)
    }

    setStore(
      "parts",
      produce((parts) => {
        if (!parts[effectiveMessageID]) {
          parts[effectiveMessageID] = []
        }

        const existingIndex = parts[effectiveMessageID].findIndex((p) => p.id === part.id)

        if (existingIndex >= 0) {
          // Update existing part
          const existing = parts[effectiveMessageID][existingIndex]
          if (
            delta?.type === "text-delta" &&
            delta.textDelta &&
            (existing.type === "text" || existing.type === "reasoning")
          ) {
            // Append text delta to text or reasoning parts
            ;(existing as { text: string }).text += delta.textDelta
          } else {
            // Replace entire part
            parts[effectiveMessageID][existingIndex] = part
          }
        } else {
          // Add new part
          parts[effectiveMessageID].push(part)
        }
      }),
    )
  }

  function handleSessionStatus(
    sessionID: string,
    newStatus: SessionStatus,
    attempt?: number,
    message?: string,
    next?: number,
  ) {
    const prev = statusMap[sessionID] ?? { type: "idle" }
    const info: SessionStatusInfo =
      newStatus === "retry"
        ? { type: "retry", attempt: attempt ?? 0, message: message ?? "", next: next ?? 0 }
        : newStatus === "offline"
          ? { type: "offline", message: message ?? "" }
          : { type: newStatus }
    setStatusMap(sessionID, info)
    // Track busy start time
    if (prev.type === "idle" && newStatus !== "idle") {
      setBusySinceMap(sessionID, Date.now())
    }
    if (newStatus === "idle") {
      setBusySinceMap(
        produce((map) => {
          delete map[sessionID]
        }),
      )
      // Session is idle — any remaining pending optimistic IDs are either
      // already confirmed (messageCreated removed them) or orphaned (queued
      // callbacks were dropped on abort). Clean up the tracking set; the
      // messages themselves will be reconciled on the next messagesLoaded.
      pendingOptimistic.delete(sessionID)
    }
  }

  function handlePermissionRequest(permission: PermissionRequest) {
    setPermissions((prev) => upsertPermission(prev, permission))
  }

  function handlePermissionResolved(permissionID: string) {
    setPermissions((prev) => prev.filter((p) => p.id !== permissionID))
    setRespondingPermissions((prev) => {
      if (!prev.has(permissionID)) return prev
      const next = new Set(prev)
      next.delete(permissionID)
      return next
    })
  }

  function handlePermissionError(permissionID: string) {
    // Remove from responding set so buttons re-enable (permission prompt is still visible)
    setRespondingPermissions((prev) => {
      if (!prev.has(permissionID)) return prev
      const next = new Set(prev)
      next.delete(permissionID)
      return next
    })
    showToast({
      variant: "error",
      title: language.t("settings.permissions.toast.updateFailed.title"),
    })
  }

  function handleQuestionRequest(question: QuestionRequest) {
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.id === question.id)
      if (idx === -1) return [...prev, question]
      const next = prev.slice()
      next[idx] = question
      return next
    })
  }

  function handleQuestionResolved(requestID: string) {
    setQuestions((prev) => prev.filter((q) => q.id !== requestID))
    setQuestionErrors((prev) => {
      const next = new Set(prev)
      next.delete(requestID)
      return next
    })
  }

  function handleQuestionError(requestID: string) {
    setQuestionErrors((prev) => new Set(prev).add(requestID))
  }

  function handleSuggestionRequest(suggestion: SuggestionRequest) {
    setSuggestions((prev) => {
      const idx = prev.findIndex((item) => item.id === suggestion.id)
      if (idx === -1) return [...prev, suggestion]
      const next = prev.slice()
      next[idx] = suggestion
      return next
    })
  }

  function handleSuggestionResolved(requestID: string) {
    setSuggestions((prev) => prev.filter((item) => item.id !== requestID))
    setRespondingSuggestions((prev) => {
      if (!prev.has(requestID)) return prev
      const next = new Set(prev)
      next.delete(requestID)
      return next
    })
    setSuggestionErrors((prev) => {
      if (!prev.has(requestID)) return prev
      const next = new Set(prev)
      next.delete(requestID)
      return next
    })
  }

  function handleSuggestionError(requestID: string) {
    setRespondingSuggestions((prev) => {
      if (!prev.has(requestID)) return prev
      const next = new Set(prev)
      next.delete(requestID)
      return next
    })
    setSuggestionErrors((prev) => new Set(prev).add(requestID))
  }

  /**
   * Route suggestion-related extension messages.
   * Extracted from the main message handler to stay within the complexity limit.
   */
  function routeSuggestionMessage(message: ExtensionMessage) {
    switch (message.type) {
      case "suggestionRequest":
        handleSuggestionRequest(message.suggestion)
        break
      case "suggestionResolved":
        handleSuggestionResolved(message.requestID)
        break
      case "suggestionError":
        handleSuggestionError(message.requestID)
        break
    }
  }

  /**
   * Handle a failed send: remove the optimistic message from the store
   * and show a toast. The PromptInput restores the draft text separately
   * by listening for the same sendMessageFailed event.
   */
  function handleSendMessageFailed(message: SendMessageFailedMessage) {
    if (message.sessionID && message.messageID) {
      pendingOptimistic.get(message.sessionID)?.delete(message.messageID)
      stash.remove(message.messageID)
      batch(() => {
        setStore("messages", message.sessionID!, (msgs = []) => msgs.filter((m) => m.id !== message.messageID))
        setStore(
          "parts",
          produce((parts) => {
            delete parts[message.messageID!]
          }),
        )
      })
    }

    showToast({
      variant: "error",
      title: language.t("prompt.toast.promptSendFailed.title") ?? "Failed to send message",
      description: message.error,
    })

    if (!message.sessionID && message.draftID) {
      setDraftSessionID(message.draftID)
    }
  }

  /**
   * BFS walk over message parts to discover all session IDs in a session's
   * family tree (self + subagents + sub-subagents). Reads directly from the
   * store so it's reactive — automatically updates when new parts arrive.
   */
  function sessionFamily(rootID: string): Set<string> {
    const family = new Set<string>([rootID])
    const queue = [rootID]
    while (queue.length > 0) {
      const sid = queue.pop()!
      const msgs = store.messages[sid]
      if (!msgs) continue
      for (const msg of msgs) {
        const parts = store.parts[msg.id]
        if (!parts) continue
        for (const p of parts) {
          if (p.type !== "tool") continue
          // Webview ToolState omits runtime metadata; task parts still carry it from the backend.
          const child = childID(
            p as {
              type: string
              tool?: string
              metadata?: { sessionId?: string }
              state?: { metadata?: { sessionId?: string } }
            },
          )
          if (child && !family.has(child)) {
            family.add(child)
            queue.push(child)
          }
        }
      }
    }
    return family
  }

  /** Return permissions scoped to the given session's family (self + subagents). */
  function scopedPermissions(sessionID: string | undefined): PermissionRequest[] {
    if (!sessionID) return []
    const family = sessionFamily(sessionID)
    return permissions().filter((p) => family.has(p.sessionID))
  }

  /** Return questions scoped to the given session's family (self + subagents). */
  function scopedQuestions(sessionID: string | undefined): QuestionRequest[] {
    if (!sessionID) return []
    const family = sessionFamily(sessionID)
    return questions().filter((q) => family.has(q.sessionID))
  }

  function scopedSuggestions(sessionID: string | undefined): SuggestionRequest[] {
    if (!sessionID) return []
    const family = sessionFamily(sessionID)
    return suggestions().filter((item) => family.has(item.sessionID))
  }

  function handleTodoUpdated(sessionID: string, items: TodoItem[]) {
    setStore("todos", sessionID, items)
  }

  function handleSessionsLoaded(loaded: SessionInfo[], preserve?: string[]) {
    const kept = preserve?.length ? new Set(preserve) : undefined
    batch(() => {
      // Reconcile: remove sessions not in the loaded list to prevent stale
      // entries from other projects accumulating in the store.
      // Sessions whose worktree directories failed to list are preserved —
      // their absence is transient, not a real deletion.
      const ids = new Set(loaded.map((s) => s.id))
      setStore(
        "sessions",
        produce((sessions) => {
          for (const id of Object.keys(sessions)) {
            if (id.startsWith("cloud:")) continue
            if (kept?.has(id)) continue
            if (!ids.has(id)) delete sessions[id]
          }
        }),
      )
      for (const s of loaded) {
        setStore("sessions", s.id, s)
      }
    })
  }

  function handleSessionDeleted(sessionID: string) {
    pendingOptimistic.delete(sessionID)
    batch(() => {
      // Collect message IDs so we can clean up their parts (store + stash)
      const msgs = store.messages[sessionID] ?? []
      const msgIds = msgs.map((m) => m.id)
      for (const id of msgIds) stash.remove(id)

      setStore(
        "sessions",
        produce((sessions) => {
          delete sessions[sessionID]
        }),
      )
      setStore(
        "messages",
        produce((messages) => {
          delete messages[sessionID]
        }),
      )
      setStore(
        "parts",
        produce((parts) => {
          for (const id of msgIds) {
            delete parts[id]
          }
        }),
      )
      setStore(
        "todos",
        produce((todos) => {
          delete todos[sessionID]
        }),
      )
      setPages(
        produce((map) => {
          delete map[sessionID]
        }),
      )
      setStore(
        "agentSelections",
        produce((selections) => {
          delete selections[sessionID]
        }),
      )
      // Clean up pending questions/errors for the deleted session
      const deleted = questions()
        .filter((q) => q.sessionID === sessionID)
        .map((q) => q.id)
      if (deleted.length > 0) {
        setQuestions((prev) => prev.filter((q) => q.sessionID !== sessionID))
        setQuestionErrors((prev) => {
          const next = new Set(prev)
          for (const id of deleted) next.delete(id)
          if (next.size === prev.size) return prev
          return next
        })
      }
      const gone = suggestions()
        .filter((item) => item.sessionID === sessionID)
        .map((item) => item.id)
      if (gone.length > 0) {
        setSuggestions((prev) => prev.filter((item) => item.sessionID !== sessionID))
        setSuggestionErrors((prev) => {
          const next = new Set(prev)
          for (const id of gone) next.delete(id)
          if (next.size === prev.size) return prev
          return next
        })
        setRespondingSuggestions((prev) => {
          const next = new Set(prev)
          for (const id of gone) next.delete(id)
          if (next.size === prev.size) return prev
          return next
        })
      }
      setPermissions((prev) => removeSessionPermissions(prev, sessionID))
      setStatusMap(
        produce((map) => {
          delete map[sessionID]
        }),
      )
      setBusySinceMap(
        produce((map) => {
          delete map[sessionID]
        }),
      )
      if (currentSessionID() === sessionID) {
        setCurrentSessionID(undefined)
        setLoading(false)
      }
    })
  }

  // Matches desktop app's event-reducer.ts: message.removed handler.
  // Splices the message from the store and deletes its parts.
  function handleMessageRemoved(sessionID: string, messageID: string) {
    setStore("messages", sessionID, (msgs = []) => msgs.filter((m) => m.id !== messageID))
    setStore(
      "parts",
      produce((parts) => {
        delete parts[messageID]
      }),
    )
    // Also clear any stashed parts for this message. Without this, a
    // removed-before-hydrated message leaks parts in the stash and can
    // resurface them via getParts() after the message is gone.
    stash.remove(messageID)
  }

  function handleCloudSessionDataLoaded(cloudSessionId: string, title: string, messages: Message[]) {
    if (cloudPreviewId() !== cloudSessionId) return
    const key = `cloud:${cloudSessionId}`
    batch(() => {
      setLoaded((prev) => {
        if (prev.has(key)) return prev
        const next = new Set(prev)
        next.add(key)
        return next
      })
      setStore("sessions", key, {
        id: key,
        title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      patchPage(key, { initialLoaded: true, hasMore: false, lastMutation: "replace" })
      setStore("messages", key, messages)
      for (const msg of messages) {
        if (msg.parts && msg.parts.length > 0) {
          setStore("parts", msg.id, msg.parts)
        }
      }
      setCurrentSessionID(key)
      setLoading(false)
    })
  }

  function handleCloudSessionImported(cloudSessionId: string, session: SessionInfo) {
    const cloudKey = `cloud:${cloudSessionId}`
    const cloudMessages = store.messages[cloudKey] ?? []
    batch(() => {
      setLoaded((prev) => {
        const next = new Set(prev)
        next.add(session.id)
        next.delete(cloudKey)
        return next
      })
      setStore("sessions", session.id, session)

      const pendingAgent = pendingAgentSelection()
      if (pendingAgent && !store.agentSelections[session.id]) {
        setStore("agentSelections", session.id, pendingAgent)
      }

      // Carry over cloud messages so there's no loading flash
      setStore("messages", session.id, cloudMessages)

      setCloudPreviewId(null)
      setCurrentSessionID(session.id)

      // Clean up synthetic cloud: entries from sessions/messages stores.
      //
      // Why we do NOT delete cloud parts here:
      //
      // During preview, parts are stored keyed by the original cloud message IDs
      // (e.g. store.parts["<cloud-msg-id>"] = [...]). When the import completes
      // we carry cloudMessages into the new local session (above) so the UI
      // renders immediately without a loading flash. Those carried-over message
      // objects still hold their original cloud IDs, so every SessionTurn
      // calls getParts("<cloud-msg-id>") — which means the parts must remain in
      // the store for now.
      //
      // If we deleted them here, every message would temporarily render with no
      // parts (parts().length === 0), showing only a loading shimmer until the
      // real data arrives.
      //
      // Instead, right after this batch we dispatch a "loadMessages" request
      // (below). When the extension responds with the "messagesLoaded" event,
      // handleMessagesLoaded() replaces the messages array with server-assigned
      // IDs and writes new parts keyed by those IDs. The old cloud-keyed part
      // entries become orphans — no message in the store references them anymore.
      // They remain in store.parts until the webview reloads or the store is
      // reset, which is a bounded, one-session-worth amount of data that does
      // not accumulate over time.
      setStore(
        "sessions",
        produce((sessions) => {
          delete sessions[cloudKey]
        }),
      )
      setStore(
        "messages",
        produce((messages) => {
          delete messages[cloudKey]
        }),
      )
    })
    // Load real messages in the background (picks up server-assigned IDs
    // and the new user message once the send completes via SSE)
    patchPage(session.id, { loadingInitial: true, before: undefined, hasMore: false })
    vscode.postMessage({ type: "loadMessages", sessionID: session.id, mode: "replace", limit: MESSAGE_PAGE_LIMIT })
  }

  // Actions
  function selectAgent(name: string) {
    const id = currentSessionID()
    if (id) {
      setStore("agentSelections", id, name)
      // Clear per-session model override so the new mode's configured/default
      // model takes effect instead of the previous mode's override.
      setStore(
        "sessionOverrides",
        produce((overrides) => {
          delete overrides[id]
        }),
      )
    } else {
      setPendingAgentSelection(name)
      // When switching mode, initialize model for the new mode if the user
      // hasn't explicitly set one for it
      if (!userSetAgents()[name] && !store.modelSelections[name]) {
        setStore("modelSelections", name, resolveModel(name))
      }
    }
  }

  /** Create an optimistic user message + parts in the store so the UI updates instantly. */
  function addOptimistic(sid: string, messageID: string, text: string, files?: FileAttachment[]) {
    const now = Date.now()
    const temp: Message = {
      id: messageID,
      sessionID: sid,
      role: "user",
      createdAt: new Date(now).toISOString(),
      time: { created: now },
    }
    const pending = pendingOptimistic.get(sid) ?? new Set()
    pending.add(messageID)
    pendingOptimistic.set(sid, pending)

    const parts: Part[] = []
    if (text) {
      parts.push({ type: "text" as const, id: Identifier.ascending("part"), messageID, text })
    }
    for (const file of files ?? []) {
      parts.push({
        type: "file" as const,
        id: Identifier.ascending("part"),
        messageID,
        mime: file.mime,
        url: file.url,
        filename: file.filename,
        source: file.source,
      })
    }

    setStore("messages", sid, (msgs = []) => [...msgs, temp])
    setStore("parts", messageID, parts)
    patchPage(sid, { initialLoaded: true, lastMutation: "append" })
    queueMicrotask(() => window.dispatchEvent(new CustomEvent("resumeAutoScroll")))
  }

  function sendMessage(
    text: string,
    providerID?: string,
    modelID?: string,
    files?: FileAttachment[],
    draftID?: string,
  ) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot send message: not connected")
      return
    }

    const messageID = Identifier.ascending("message")

    const preview = cloudPreviewId()
    if (preview) {
      const agent = selectedAgentName() !== defaultAgent() ? selectedAgentName() : undefined
      vscode.postMessage({
        type: "importAndSend",
        cloudSessionId: preview,
        text,
        messageID,
        providerID,
        modelID,
        agent,
        variant: currentVariant(),
        files,
      })
      return
    }

    const sid = currentSessionID()
    const suggestion = scopedSuggestions(sid)[0]
    if (suggestion) dismissSuggestion(suggestion.id)
    for (const q of scopedQuestions(sid)) {
      rejectQuestion(q.id)
    }
    if (sid) addOptimistic(sid, messageID, text, files)

    const agent = selectedAgentName() !== defaultAgent() ? selectedAgentName() : undefined

    vscode.postMessage({
      type: "sendMessage",
      text,
      messageID,
      sessionID: sid,
      draftID,
      providerID,
      modelID,
      agent,
      variant: currentVariant(),
      files,
    })
  }

  function sendCommand(
    command: string,
    args: string,
    providerID?: string,
    modelID?: string,
    files?: FileAttachment[],
    draftID?: string,
  ) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot send command: not connected")
      return
    }

    // Cloud previews need import-then-command; post importAndSend with command metadata
    const preview = cloudPreviewId()
    if (preview) {
      const agent = selectedAgentName() !== defaultAgent() ? selectedAgentName() : undefined
      vscode.postMessage({
        type: "importAndSend",
        cloudSessionId: preview,
        text: `/${command} ${args}`.trim(),
        messageID: Identifier.ascending("message"),
        providerID,
        modelID,
        agent,
        variant: currentVariant(),
        files,
        command,
        commandArgs: args,
      })
      return
    }

    const messageID = Identifier.ascending("message")
    const sid = currentSessionID()
    const suggestion = scopedSuggestions(sid)[0]
    if (suggestion) dismissSuggestion(suggestion.id)
    for (const q of scopedQuestions(sid)) {
      rejectQuestion(q.id)
    }

    if (sid) addOptimistic(sid, messageID, `/${command} ${args}`.trim(), files)

    const agent = selectedAgentName() !== defaultAgent() ? selectedAgentName() : undefined

    vscode.postMessage({
      type: "sendCommand",
      command,
      arguments: args,
      messageID,
      sessionID: sid,
      draftID,
      providerID,
      modelID,
      agent,
      variant: currentVariant(),
      files,
    })
  }

  function abort() {
    const sessionID = currentSessionID()
    if (!sessionID) {
      console.warn("[Kilo New] Cannot abort: no current session")
      return
    }

    vscode.postMessage({
      type: "abort",
      sessionID,
    })
  }

  function compact() {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot compact: not connected")
      return
    }

    const sessionID = currentSessionID()
    if (!sessionID) {
      console.warn("[Kilo New] Cannot compact: no current session")
      return
    }

    const sel = selected()
    vscode.postMessage({
      type: "compact",
      sessionID,
      providerID: sel?.providerID,
      modelID: sel?.modelID,
    })
  }

  function respondToPermission(
    permissionId: string,
    response: "once" | "always" | "reject",
    approvedAlways: string[],
    deniedAlways: string[],
  ) {
    // Resolve sessionID from the stored permission request
    const permission = permissions().find((p) => p.id === permissionId)
    const sessionID = permission?.sessionID ?? currentSessionID() ?? ""

    // Mark as responding so the UI disables the buttons.
    // The permission is removed when the server confirms via permission.replied SSE.
    setRespondingPermissions((prev) => new Set(prev).add(permissionId))

    vscode.postMessage({
      type: "permissionResponse",
      permissionId,
      sessionID,
      response,
      approvedAlways,
      deniedAlways,
    })
  }

  function clearQuestionError(requestID: string) {
    setQuestionErrors((prev) => {
      if (!prev.has(requestID)) return prev
      const next = new Set(prev)
      next.delete(requestID)
      return next
    })
  }

  function clearSuggestionError(requestID: string) {
    setSuggestionErrors((prev) => {
      if (!prev.has(requestID)) return prev
      const next = new Set(prev)
      next.delete(requestID)
      return next
    })
  }

  function replyToQuestion(requestID: string, answers: string[][]) {
    clearQuestionError(requestID)
    const question = questions().find((item) => item.id === requestID)
    const sessionID = question?.sessionID ?? currentSessionID() ?? ""
    vscode.postMessage({
      type: "questionReply",
      requestID,
      sessionID,
      answers,
    })
  }

  function rejectQuestion(requestID: string) {
    clearQuestionError(requestID)
    const question = questions().find((item) => item.id === requestID)
    const sessionID = question?.sessionID ?? currentSessionID() ?? ""
    vscode.postMessage({
      type: "questionReject",
      requestID,
      sessionID,
    })
  }

  function acceptSuggestion(requestID: string, index: number) {
    clearSuggestionError(requestID)
    setRespondingSuggestions((prev) => new Set(prev).add(requestID))
    const sid = suggestions().find((s) => s.id === requestID)?.sessionID ?? currentSessionID() ?? ""
    vscode.postMessage({
      type: "suggestionAccept",
      requestID,
      sessionID: sid,
      index,
    })
  }

  function dismissSuggestion(requestID: string) {
    clearSuggestionError(requestID)
    setRespondingSuggestions((prev) => new Set(prev).add(requestID))
    const sid = suggestions().find((s) => s.id === requestID)?.sessionID ?? currentSessionID() ?? ""
    vscode.postMessage({
      type: "suggestionDismiss",
      requestID,
      sessionID: sid,
    })
  }

  function createSession() {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot create session: not connected")
      return
    }

    // Reset agent selection to default for the new session (model overrides persist)
    setPendingAgentSelection(defaultAgent())
    vscode.postMessage({ type: "createSession" })
  }

  function clearCurrentSession() {
    setCurrentSessionID(undefined)
    setDraftSessionID(undefined)
    setCloudPreviewId(null)
    setLoading(false)
    setPendingAgentSelection(defaultAgent())
    vscode.postMessage({ type: "clearSession" })
  }

  function loadSessions() {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot load sessions: not connected")
      return
    }
    vscode.postMessage({ type: "loadSessions" })
  }

  function loadOlderMessages() {
    const id = currentSessionID()
    if (!id || !server.isConnected()) return
    const page = pages[id] ?? emptyPageState
    if (!page.hasMore || page.loadingOlder || page.loadingInitial || !page.before) return
    patchPage(id, { loadingOlder: true })
    vscode.postMessage({
      type: "loadMessages",
      sessionID: id,
      mode: "prepend",
      before: page.before,
      limit: MESSAGE_PAGE_LIMIT,
    })
  }

  function selectSession(id: string) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot select session: not connected")
      return
    }
    if (id.startsWith("cloud:")) {
      console.warn("[Kilo New] Cannot select cloud preview session via selectSession")
      return
    }
    const ready = loaded().has(id)
    setCurrentSessionID(id)
    setDraftSessionID(id)
    setLoading(!ready)
    if (ready) {
      vscode.postMessage({ type: "loadMessages", sessionID: id, mode: "focus" })
      return
    }
    patchPage(id, { loadingInitial: true, loadingOlder: false, before: undefined, hasMore: false })
    vscode.postMessage({ type: "loadMessages", sessionID: id, mode: "replace", limit: MESSAGE_PAGE_LIMIT })
  }

  function selectCloudSession(cloudSessionId: string) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot select cloud session: not connected")
      return
    }
    const key = `cloud:${cloudSessionId}`
    setCloudPreviewId(cloudSessionId)
    setCurrentSessionID(key)
    setDraftSessionID(key)
    setLoading(true)
    vscode.postMessage({ type: "requestCloudSessionData", sessionId: cloudSessionId })
  }

  function deleteSession(id: string) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot delete session: not connected")
      return
    }
    // Optimistically remove from the list so the UI updates immediately
    setStore(
      "sessions",
      produce((sessions) => {
        delete sessions[id]
      }),
    )
    setLoaded((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    vscode.postMessage({ type: "deleteSession", sessionID: id })
  }

  function renameSession(id: string, title: string) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot rename session: not connected")
      return
    }
    vscode.postMessage({ type: "renameSession", sessionID: id, title })
  }

  // Computed values
  const currentSession = () => {
    const id = currentSessionID()
    return id ? store.sessions[id] : undefined
  }

  const pageState = () => {
    const id = currentSessionID()
    return id ? (pages[id] ?? emptyPageState) : emptyPageState
  }

  const loadingOlderMessages = () => pageState().loadingOlder
  const hasOlderMessages = () => pageState().hasMore
  const messageMutation = () => pageState().lastMutation

  const messages = () => {
    const id = currentSessionID()
    return id ? store.messages[id] || [] : []
  }

  const getParts = (messageID: string) => {
    return store.parts[messageID] || stash.peek(messageID) || []
  }

  function hydrateParts(ids: string[]) {
    const pending = stash.take(ids, (id) => Boolean(store.parts[id]))
    if (Object.keys(pending).length === 0) return
    setStore(
      "parts",
      produce((p) => {
        for (const [id, parts] of Object.entries(pending)) p[id] = parts
      }),
    )
  }

  const allMessages = () => store.messages

  const allParts = () => store.parts

  const allStatusMap = () => statusMap as Record<string, SessionStatusInfo>

  const userMessages = createMemo(() => messages().filter((m) => m.role === "user"))

  const revert = createMemo(() => {
    const id = currentSessionID()
    // revert can be null (cleared by unrevert) or undefined (never set) — treat both as "no revert"
    return id ? (store.sessions[id]?.revert ?? undefined) : undefined
  })

  const revertedCount = createMemo(() => {
    const boundary = revert()?.messageID
    if (!boundary) return 0
    return userMessages().filter((m) => m.id >= boundary).length
  })

  const summary = createMemo(() => {
    const id = currentSessionID()
    return id ? (store.sessions[id]?.summary ?? undefined) : undefined
  })

  function revertSession(messageID: string) {
    const id = currentSessionID()
    if (!id) return
    // Restore the reverted user message's prompt text into the input.
    // Dispatch as a window message so PromptInput picks it up via onMessage.
    const parts = store.parts[messageID]
    if (parts) {
      const text = parts
        .filter((p) => p.type === "text" && !(p as { synthetic?: boolean }).synthetic)
        .map((p) => (p as { text: string }).text ?? "")
        .join("")
      if (text) window.postMessage({ type: "setChatBoxMessage", text }, "*")
    }
    vscode.postMessage({ type: "revertSession", sessionID: id, messageID })
  }

  function unrevertSession() {
    const id = currentSessionID()
    if (!id) return
    // Clear the prompt input on full redo (matching TUI/desktop behavior)
    window.postMessage({ type: "setChatBoxMessage", text: "" }, "*")
    vscode.postMessage({ type: "unrevertSession", sessionID: id })
  }

  function syncSession(sessionID: string) {
    vscode.postMessage({ type: "syncSession", sessionID, parentSessionID: currentSessionID() })
  }

  const todos = () => {
    const id = currentSessionID()
    return id ? store.todos[id] || [] : []
  }

  const sessions = createMemo(() =>
    Object.values(store.sessions)
      .filter((s) => !s.id.startsWith("cloud:"))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  )

  /** Per-session cost — only reads store.messages (not parts). */
  const familyCosts = createMemo<Map<string, number>>(() => {
    const id = currentSessionID()
    if (!id) return new Map()
    return buildFamilyCosts(sessionFamily(id), store.messages)
  })

  /** Child session labels — only reads store.parts (not message costs). */
  const familyLabels = createMemo<Map<string, string>>(() => {
    const id = currentSessionID()
    if (!id) return new Map()
    return buildFamilyLabels(sessionFamily(id), store.messages as any, store.parts as any)
  })

  /** Combined cost breakdown with labels. */
  const costBreakdown = createMemo<Array<{ label: string; cost: number }>>(() => {
    const id = currentSessionID()
    const costs = familyCosts()
    if (!id || costs.size === 0) return []
    return buildCostBreakdown(id, costs, familyLabels(), language.t("context.stats.thisSession"))
  })

  // Status text derived from last assistant message parts
  const statusText = createMemo<string | undefined>(() => {
    if (status() === "idle") return undefined
    const fallback = language.t("ui.sessionTurn.status.consideringNextSteps")
    const id = currentSessionID()
    const msgs = messages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role !== "assistant") continue
      const parts = getParts(msgs[i].id)
      if (parts.length === 0) break
      const raw = computeStatus(parts[parts.length - 1], language.t) ?? fallback
      // When delegating to a subagent and that subagent is blocked on a prompt,
      // replace the generic "Delegating work" label with a more informative one
      // so the user understands why nothing appears to be happening.
      if (raw === language.t("ui.sessionTurn.status.delegating")) {
        const scoped = scopedPermissions(id)
        if (scoped.length > 0) return language.t("ui.sessionTurn.status.delegatingWaitingPermission")
        const scopedQ = scopedQuestions(id)
        if (scopedQ.length > 0) return language.t("ui.sessionTurn.status.delegatingWaitingQuestion")
      }
      return raw
    }
    return fallback
  })

  const contextUsage = createMemo<ContextUsage | undefined>(() => {
    const msgs = messages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.role !== "assistant" || !m.tokens) continue
      const usage = calcContextUsage(m.tokens, undefined)
      if (usage.tokens === 0) continue
      const sel = selected()
      const model = sel ? provider.findModel(sel) : undefined
      const limit = model?.limit?.context ?? model?.contextLength
      return calcContextUsage(m.tokens, limit)
    }
    return undefined
  })

  const value: SessionContextValue = {
    currentSessionID,
    currentSession,
    setCurrentSessionID,
    sessions,
    status,
    statusInfo,
    statusText,
    busySince,
    loading,
    loadingOlderMessages,
    hasOlderMessages,
    messageMutation,
    messages,
    userMessages,
    getParts,
    hydrateParts,
    todos,
    permissions,
    respondingPermissions,
    questions,
    questionErrors,
    suggestions,
    suggestionErrors,
    respondingSuggestions,
    scopedPermissions,
    scopedQuestions,
    scopedSuggestions,
    selected,
    selectModel,
    hasModelOverride,
    clearModelOverride,
    costBreakdown,
    contextUsage,
    agents,
    allAgents,
    skills,
    refreshSkills,
    removeSkill,
    removeMode,
    removeMcp,
    mcpStatus,
    mcpLoading,
    connectMcp,
    disconnectMcp,
    refreshMcpStatus,
    selectedAgent: selectedAgentName,
    selectAgent,
    getSessionAgent: (sessionID: string) => store.agentSelections[sessionID] ?? defaultAgent(),
    getSessionModel: (sessionID: string) => {
      const override = store.sessionOverrides[sessionID]
      if (override) return override
      const agentName = store.agentSelections[sessionID] ?? defaultAgent()
      return resolveModel(agentName, store.modelSelections[agentName])
    },
    setSessionModel: (sessionID: string, providerID: string, modelID: string) => {
      // Only write per-session override — do NOT touch global modelSelections or
      // userSetAgents.  The override is what selected()/getSessionModel() actually
      // reads, and mutating the global map here is both redundant and harmful: the
      // agent may not yet be assigned (sendInitialMessage calls setSessionModel
      // before setSessionAgent), so the write would land on defaultAgent() and
      // corrupt the default mode's model for later sessions.
      setStore("sessionOverrides", sessionID, { providerID, modelID })
    },
    setSessionAgent: (sessionID: string, name: string) => {
      setStore("agentSelections", sessionID, name)
    },
    allMessages,
    allParts,
    allStatusMap,
    favoriteModels: () => store.favoriteModels,
    toggleFavorite,
    variantList,
    currentVariant,
    selectVariant,
    revert,
    revertedCount,
    summary,
    worktreeStats,
    revertSession,
    unrevertSession,
    sendMessage,
    sendCommand,
    abort,
    compact,
    respondToPermission,
    replyToQuestion,
    rejectQuestion,
    acceptSuggestion,
    dismissSuggestion,
    createSession,
    clearCurrentSession,
    loadSessions,
    loadOlderMessages,
    selectSession,
    deleteSession,
    renameSession,
    syncSession,
    cloudPreviewId,
    selectCloudSession,
    draftSessionID,
    setDraftSessionID,
  }

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider")
  }
  return context
}
