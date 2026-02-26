/**
 * Session context
 * Manages session state, messages, and handles SSE events from the extension.
 * Also owns per-session model selection (provider context is catalog-only).
 */

import {
  createContext,
  useContext,
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  ParentComponent,
  Accessor,
  batch,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useVSCode } from "./vscode"
import { useServer } from "./server"
import { useProvider } from "./provider"
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
  TodoItem,
  ModelSelection,
  ContextUsage,
  AgentInfo,
  ExtensionMessage,
  FileAttachment,
} from "../types/messages"
import { removeSessionPermissions, upsertPermission } from "./permission-queue"
import { computeStatus, calcTotalCost, calcContextUsage } from "./session-utils"

// Store structure for messages and parts
interface SessionStore {
  sessions: Record<string, SessionInfo>
  messages: Record<string, Message[]> // sessionID -> messages
  parts: Record<string, Part[]> // messageID -> parts
  todos: Record<string, TodoItem[]> // sessionID -> todos
  modelSelections: Record<string, ModelSelection> // sessionID -> model
  agentSelections: Record<string, string> // sessionID -> agent name
  variantSelections: Record<string, string> // "providerID/modelID" -> variant name
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

  // Todos for current session
  todos: Accessor<TodoItem[]>

  // Pending permission requests
  permissions: Accessor<PermissionRequest[]>

  // Pending question requests
  questions: Accessor<QuestionRequest[]>
  questionErrors: Accessor<Set<string>>

  // Model selection (per-session)
  selected: Accessor<ModelSelection | null>
  selectModel: (providerID: string, modelID: string) => void

  // Cost and context usage for the current session
  totalCost: Accessor<number>
  contextUsage: Accessor<ContextUsage | undefined>

  // Agent/mode selection (per-session)
  agents: Accessor<AgentInfo[]>
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

  // Actions
  sendMessage: (text: string, providerID?: string, modelID?: string, files?: FileAttachment[]) => void
  abort: () => void
  compact: () => void
  respondToPermission: (permissionId: string, response: "once" | "always" | "reject") => void
  replyToQuestion: (requestID: string, answers: string[][]) => void
  rejectQuestion: (requestID: string) => void
  createSession: () => void
  clearCurrentSession: () => void
  loadSessions: () => void
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  syncSession: (sessionID: string) => void

  // Cloud session preview
  cloudPreviewId: Accessor<string | null>
  selectCloudSession: (cloudSessionId: string) => void
}

const SessionContext = createContext<SessionContextValue>()

export const SessionProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const server = useServer()
  const provider = useProvider()
  const language = useLanguage()

  // Current session ID
  const [currentSessionID, setCurrentSessionID] = createSignal<string | undefined>()

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

  // Pending permissions
  const [permissions, setPermissions] = createSignal<PermissionRequest[]>([])

  // Pending questions
  const [questions, setQuestions] = createSignal<QuestionRequest[]>([])

  // Tracks question IDs that failed so the UI can reset sending state
  const [questionErrors, setQuestionErrors] = createSignal<Set<string>>(new Set())

  // Pending model selection for before a session exists
  const [pendingModelSelection, setPendingModelSelection] = createSignal<ModelSelection | null>(null)
  const [pendingWasUserSet, setPendingWasUserSet] = createSignal(false)

  // Agents (modes) loaded from the CLI backend
  const [agents, setAgents] = createSignal<AgentInfo[]>([])
  const [defaultAgent, setDefaultAgent] = createSignal("code")

  // Pending agent selection for before a session exists (mirrors pendingModelSelection)
  const [pendingAgentSelection, setPendingAgentSelection] = createSignal<string | null>(null)

  // Cloud session preview state
  const [cloudPreviewId, setCloudPreviewId] = createSignal<string | null>(null)

  // Store for sessions, messages, parts, todos, modelSelections, agentSelections
  const [store, setStore] = createStore<SessionStore>({
    sessions: {},
    messages: {},
    parts: {},
    todos: {},
    modelSelections: {},
    agentSelections: {},
    variantSelections: {},
  })

  // Keep pending selection in sync with provider default until the user
  // explicitly changes it (or a session exists).
  createEffect(() => {
    const def = provider.defaultSelection()
    if (currentSessionID()) {
      return
    }

    if (pendingWasUserSet()) {
      return
    }

    setPendingModelSelection(def)
  })

  // If we have no pending yet, initialize it from provider default.
  createEffect(() => {
    if (!pendingModelSelection()) {
      setPendingModelSelection(provider.defaultSelection())
    }
  })

  // Per-session model selection
  const selected = createMemo<ModelSelection | null>(() => {
    const sessionID = currentSessionID()
    if (sessionID) {
      return store.modelSelections[sessionID] ?? provider.defaultSelection()
    }
    return pendingModelSelection()
  })

  // Per-session agent selection
  const selectedAgentName = createMemo<string>(() => {
    const sessionID = currentSessionID()
    if (sessionID) {
      return store.agentSelections[sessionID] ?? defaultAgent()
    }
    return pendingAgentSelection() ?? defaultAgent()
  })

  function selectModel(providerID: string, modelID: string) {
    const selection: ModelSelection = { providerID, modelID }
    const id = currentSessionID()
    if (id) {
      setStore("modelSelections", id, selection)
    } else {
      setPendingWasUserSet(true)
      setPendingModelSelection(selection)
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
    setDefaultAgent(message.defaultAgent)
    // Initialize pending agent if not yet set by the user
    if (!pendingAgentSelection()) {
      setPendingAgentSelection(message.defaultAgent)
    }
  })

  // Request agents in case the initial push was missed.
  // Retry a few times because the extension's httpClient may
  // not be ready yet when the first request arrives.
  let agentRetries = 0
  const agentMaxRetries = 5
  const agentRetryMs = 500

  vscode.postMessage({ type: "requestAgents" })

  const agentRetryTimer = setInterval(() => {
    agentRetries++
    if (agents().length > 0 || agentRetries >= agentMaxRetries) {
      clearInterval(agentRetryTimer)
      return
    }
    vscode.postMessage({ type: "requestAgents" })
  }, agentRetryMs)

  onCleanup(() => {
    unsubAgents()
    clearInterval(agentRetryTimer)
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

  // Handle messages from extension
  onMount(() => {
    const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
      switch (message.type) {
        case "sessionCreated":
          handleSessionCreated(message.session)
          break

        case "messagesLoaded":
          handleMessagesLoaded(message.sessionID, message.messages)
          break

        case "messageCreated":
          handleMessageCreated(message.message)
          break

        case "partUpdated":
          handlePartUpdated(message.sessionID, message.messageID, message.part, message.delta)
          break

        case "sessionStatus":
          handleSessionStatus(message.sessionID, message.status, message.attempt, message.message, message.next)
          break

        case "permissionRequest":
          handlePermissionRequest(message.permission)
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

        case "sessionsLoaded":
          handleSessionsLoaded(message.sessions)
          break

        case "sessionUpdated":
          setStore("sessions", message.session.id, message.session)
          break

        case "sessionDeleted":
          handleSessionDeleted(message.sessionID)
          break

        case "error":
          // Only clear loading if the error is for the current session
          // (or has no sessionID for backwards compatibility)
          if (!message.sessionID || message.sessionID === currentSessionID()) setLoading(false)
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
      }
    })

    onCleanup(unsubscribe)
  })

  // Event handlers
  function handleSessionCreated(session: SessionInfo) {
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

      // If there's a pending model selection, assign it to this new session.
      // Guard against duplicate sessionCreated events (HTTP response + SSE)
      // which would overwrite the user's selection with the effect-restored default.
      const pending = pendingModelSelection()
      if (pending && !store.modelSelections[session.id]) {
        setStore("modelSelections", session.id, pending)
        setPendingModelSelection(null)
        setPendingWasUserSet(false)
      }

      // Transfer pending agent selection to the new session
      const pendingAgent = pendingAgentSelection()
      if (pendingAgent && !store.agentSelections[session.id]) {
        setStore("agentSelections", session.id, pendingAgent)
        setPendingAgentSelection(null)
      }

      setCurrentSessionID(session.id)
    })
  }

  function handleMessagesLoaded(sessionID: string, messages: Message[]) {
    batch(() => {
      if (sessionID === currentSessionID()) setLoading(false)
      setStore("messages", sessionID, messages)

      // Also extract parts from messages
      for (const msg of messages) {
        if (msg.parts && msg.parts.length > 0) {
          setStore("parts", msg.id, msg.parts)
        }
      }
    })
  }

  function handleMessageCreated(message: Message) {
    setStore("messages", message.sessionID, (msgs = []) => {
      // Check if message already exists (update case)
      const existingIndex = msgs.findIndex((m) => m.id === message.id)
      if (existingIndex >= 0) {
        const updated = [...msgs]
        updated[existingIndex] = { ...msgs[existingIndex], ...message }
        return updated
      }
      // Replace optimistic user message if one exists
      if (message.role === "user") {
        const optimisticIdx = msgs.findIndex((m) => m.id.startsWith("optimistic-") && m.role === "user")
        if (optimisticIdx >= 0) {
          const updated = [...msgs]
          // Clean up optimistic parts
          const old = msgs[optimisticIdx]
          setStore(
            "parts",
            produce((parts) => {
              delete parts[old.id]
            }),
          )
          updated[optimisticIdx] = message
          return updated
        }
      }
      return [...msgs, message]
    })

    if (message.parts && message.parts.length > 0) {
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

    setStore(
      "parts",
      produce((parts) => {
        if (!parts[effectiveMessageID]) {
          parts[effectiveMessageID] = []
        }

        const existingIndex = parts[effectiveMessageID].findIndex((p) => p.id === part.id)

        if (existingIndex >= 0) {
          // Update existing part
          if (
            delta?.type === "text-delta" &&
            delta.textDelta &&
            parts[effectiveMessageID][existingIndex].type === "text"
          ) {
            // Append text delta
            ;(parts[effectiveMessageID][existingIndex] as { text: string }).text += delta.textDelta
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
    }
  }

  function handlePermissionRequest(permission: PermissionRequest) {
    setPermissions((prev) => upsertPermission(prev, permission))
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

  function handleTodoUpdated(sessionID: string, items: TodoItem[]) {
    setStore("todos", sessionID, items)
  }

  function handleSessionsLoaded(loaded: SessionInfo[]) {
    batch(() => {
      for (const s of loaded) {
        setStore("sessions", s.id, s)
      }
    })
  }

  function handleSessionDeleted(sessionID: string) {
    batch(() => {
      // Collect message IDs so we can clean up their parts
      const msgs = store.messages[sessionID] ?? []
      const msgIds = msgs.map((m) => m.id)

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
      setStore(
        "modelSelections",
        produce((selections) => {
          delete selections[sessionID]
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

  function handleCloudSessionDataLoaded(cloudSessionId: string, title: string, messages: Message[]) {
    if (cloudPreviewId() !== cloudSessionId) return
    const key = `cloud:${cloudSessionId}`
    batch(() => {
      setStore("sessions", key, {
        id: key,
        title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
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
      setStore("sessions", session.id, session)

      const pending = pendingModelSelection()
      if (pending && !store.modelSelections[session.id]) {
        setStore("modelSelections", session.id, pending)
      }
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
    vscode.postMessage({ type: "loadMessages", sessionID: session.id })
  }

  // Actions
  function selectAgent(name: string) {
    const id = currentSessionID()
    if (id) {
      setStore("agentSelections", id, name)
    } else {
      setPendingAgentSelection(name)
    }
  }

  function sendMessage(text: string, providerID?: string, modelID?: string, files?: FileAttachment[]) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot send message: not connected")
      return
    }

    const preview = cloudPreviewId()
    if (preview) {
      const agent = selectedAgentName() !== defaultAgent() ? selectedAgentName() : undefined
      vscode.postMessage({
        type: "importAndSend",
        cloudSessionId: preview,
        text,
        providerID,
        modelID,
        agent,
        variant: currentVariant(),
        files,
      })
      return
    }

    const sid = currentSessionID()
    if (sid) {
      const tempId = `optimistic-${crypto.randomUUID()}`
      const now = Date.now()
      const temp: Message = {
        id: tempId,
        sessionID: sid,
        role: "user",
        createdAt: new Date(now).toISOString(),
        time: { created: now },
      }
      setStore("messages", sid, (msgs = []) => [...msgs, temp])
      setStore("parts", tempId, [{ type: "text" as const, id: `${tempId}-text`, text }])
    }

    const agent = selectedAgentName() !== defaultAgent() ? selectedAgentName() : undefined

    vscode.postMessage({
      type: "sendMessage",
      text,
      sessionID: sid,
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

  function respondToPermission(permissionId: string, response: "once" | "always" | "reject") {
    // Resolve sessionID from the stored permission request
    const permission = permissions().find((p) => p.id === permissionId)
    const sessionID = permission?.sessionID ?? currentSessionID() ?? ""

    vscode.postMessage({
      type: "permissionResponse",
      permissionId,
      sessionID,
      response,
    })

    // Remove from pending permissions
    setPermissions((prev) => prev.filter((p) => p.id !== permissionId))
  }

  function clearQuestionError(requestID: string) {
    setQuestionErrors((prev) => {
      if (!prev.has(requestID)) return prev
      const next = new Set(prev)
      next.delete(requestID)
      return next
    })
  }

  function replyToQuestion(requestID: string, answers: string[][]) {
    clearQuestionError(requestID)
    vscode.postMessage({
      type: "questionReply",
      requestID,
      answers,
    })
  }

  function rejectQuestion(requestID: string) {
    clearQuestionError(requestID)
    vscode.postMessage({
      type: "questionReject",
      requestID,
    })
  }

  function createSession() {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot create session: not connected")
      return
    }

    // Reset pending selection to default for the new session
    setPendingModelSelection(provider.defaultSelection())
    setPendingWasUserSet(false)
    setPendingAgentSelection(defaultAgent())
    vscode.postMessage({ type: "createSession" })
  }

  function clearCurrentSession() {
    setCurrentSessionID(undefined)
    setCloudPreviewId(null)
    setLoading(false)
    setPermissions([])
    setQuestions([])
    setQuestionErrors(new Set<string>())
    setPendingModelSelection(provider.defaultSelection())
    setPendingWasUserSet(false)
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

  function selectSession(id: string) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot select session: not connected")
      return
    }
    if (id.startsWith("cloud:")) {
      console.warn("[Kilo New] Cannot select cloud preview session via selectSession")
      return
    }
    setCurrentSessionID(id)
    setLoading(true)
    vscode.postMessage({ type: "loadMessages", sessionID: id })
  }

  function selectCloudSession(cloudSessionId: string) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot select cloud session: not connected")
      return
    }
    const key = `cloud:${cloudSessionId}`
    setCloudPreviewId(cloudSessionId)
    setCurrentSessionID(key)
    setLoading(true)
    vscode.postMessage({ type: "requestCloudSessionData", sessionId: cloudSessionId })
  }

  function deleteSession(id: string) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot delete session: not connected")
      return
    }
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

  const messages = () => {
    const id = currentSessionID()
    return id ? store.messages[id] || [] : []
  }

  const getParts = (messageID: string) => {
    return store.parts[messageID] || []
  }

  const allMessages = () => store.messages

  const allParts = () => store.parts

  const allStatusMap = () => statusMap as Record<string, SessionStatusInfo>

  const userMessages = createMemo(() => messages().filter((m) => m.role === "user"))

  function syncSession(sessionID: string) {
    vscode.postMessage({ type: "syncSession", sessionID })
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

  const totalCost = createMemo(() => calcTotalCost(messages()))

  // Status text derived from last assistant message parts
  const statusText = createMemo<string | undefined>(() => {
    if (status() === "idle") return undefined
    const fallback = language.t("ui.sessionTurn.status.consideringNextSteps")
    const msgs = messages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role !== "assistant") continue
      const parts = getParts(msgs[i].id)
      if (parts.length === 0) break
      return computeStatus(parts[parts.length - 1], language.t) ?? fallback
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
    messages,
    userMessages,
    getParts,
    todos,
    permissions,
    questions,
    questionErrors,
    selected,
    selectModel,
    totalCost,
    contextUsage,
    agents,
    selectedAgent: selectedAgentName,
    selectAgent,
    getSessionAgent: (sessionID: string) => store.agentSelections[sessionID] ?? defaultAgent(),
    getSessionModel: (sessionID: string) => store.modelSelections[sessionID] ?? provider.defaultSelection(),
    setSessionModel: (sessionID: string, providerID: string, modelID: string) => {
      setStore("modelSelections", sessionID, { providerID, modelID })
    },
    setSessionAgent: (sessionID: string, name: string) => {
      setStore("agentSelections", sessionID, name)
    },
    allMessages,
    allParts,
    allStatusMap,
    variantList,
    currentVariant,
    selectVariant,
    sendMessage,
    abort,
    compact,
    respondToPermission,
    replyToQuestion,
    rejectQuestion,
    createSession,
    clearCurrentSession,
    loadSessions,
    selectSession,
    deleteSession,
    renameSession,
    syncSession,
    cloudPreviewId,
    selectCloudSession,
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
