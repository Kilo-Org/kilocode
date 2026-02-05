/**
 * Transport Provider
 *
 * Solid.js context provider that wraps the ChatTransport with reactive signals.
 * Provides session state, messages, and streaming updates as reactive primitives.
 */

import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  onCleanup,
  batch,
  type ParentComponent,
  type Accessor,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import {
  ChatTransport,
  getChatTransport,
  type SessionState,
} from "./chat-transport"
import type {
  ChatMessage,
  SessionInfo,
  SessionStatusInfo,
  PermissionRequest,
  TodoItem,
  ViewContext,
  MessagePart,
} from "../../../src/shared/chat-protocol"

// ============================================================================
// Context Types
// ============================================================================

export interface TransportContextValue {
  // Transport instance
  transport: ChatTransport

  // Reactive state
  currentSession: Accessor<SessionInfo | null>
  messages: ChatMessage[]
  sessionStatus: Accessor<SessionStatusInfo>
  pendingPermissions: PermissionRequest[]
  todos: TodoItem[]
  isLoading: Accessor<boolean>
  error: Accessor<string | null>
  activeRequestId: Accessor<string | null>

  // Actions
  loadSession: (sessionId?: string) => Promise<void>
  sendPrompt: (text: string, attachments?: unknown[]) => string
  abort: () => void
  setModel: (model: string) => void
  replyToPermission: (permissionRequestId: string, reply: "once" | "always" | "reject") => void
  createSession: (title?: string, parentId?: string) => Promise<SessionInfo>
  listSessions: () => Promise<SessionInfo[]>
}

// ============================================================================
// Context
// ============================================================================

const TransportContext = createContext<TransportContextValue>()

export function useTransport(): TransportContextValue {
  const context = useContext(TransportContext)
  if (!context) {
    throw new Error("useTransport must be used within a TransportProvider")
  }
  return context
}

// ============================================================================
// Provider Props
// ============================================================================

export interface TransportProviderProps {
  /** Initial view context to send on init */
  context?: ViewContext
  /** Auto-initialize on mount (default: true) */
  autoInit?: boolean
  /** Session ID to auto-load on init */
  initialSessionId?: string
}

// ============================================================================
// Provider Component
// ============================================================================

export const TransportProvider: ParentComponent<TransportProviderProps> = (props) => {
  const transport = getChatTransport()

  // Reactive state
  const [currentSession, setCurrentSession] = createSignal<SessionInfo | null>(null)
  const [sessionStatus, setSessionStatus] = createSignal<SessionStatusInfo>({ type: "idle" })
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [activeRequestId, setActiveRequestId] = createSignal<string | null>(null)

  // Stores for arrays (more efficient updates)
  const [messages, setMessages] = createStore<ChatMessage[]>([])
  const [pendingPermissions, setPendingPermissions] = createStore<PermissionRequest[]>([])
  const [todos, setTodos] = createStore<TodoItem[]>([])

  // ============================================================================
  // Event Handlers
  // ============================================================================

  // Handle new messages
  const unsubMessageAppended = transport.onMessageAppended((msg) => {
    if (msg.sessionId !== currentSession()?.id) return
    setMessages(produce((msgs) => msgs.push(msg.message)))
  })

  // Handle message updates
  const unsubMessageUpdated = transport.onMessageUpdated((msg) => {
    if (msg.sessionId !== currentSession()?.id) return
    setMessages(
      (m) => m.id === msg.message.id,
      produce((m) => {
        m.time = msg.message.time
        m.role = msg.message.role
      })
    )
  })

  // Handle streaming deltas
  const unsubMessageDelta = transport.onMessageDelta((delta) => {
    if (delta.sessionId !== currentSession()?.id) return

    setMessages(
      (m) => m.id === delta.messageId,
      "parts",
      (parts) => parts.id === delta.part.id,
      produce((part: MessagePart) => {
        // Update the part based on its type
        if (delta.part.type === "text" && part.type === "text") {
          part.text = delta.part.text
        } else if (delta.part.type === "tool" && part.type === "tool") {
          part.state = delta.part.state
        } else if (delta.part.type === "reasoning" && part.type === "reasoning") {
          part.text = delta.part.text
        }
      })
    )

    // If part doesn't exist, add it
    setMessages(
      (m) => m.id === delta.messageId,
      produce((msg) => {
        const existingPart = msg.parts.find((p) => p.id === delta.part.id)
        if (!existingPart) {
          msg.parts.push(delta.part)
        }
      })
    )
  })

  // Handle request state changes
  const unsubRequestState = transport.onRequestState((state) => {
    if (state.sessionId !== currentSession()?.id) return

    batch(() => {
      switch (state.state.status) {
        case "started":
          setActiveRequestId(state.state.requestId)
          setError(null)
          break
        case "finished":
        case "aborted":
          setActiveRequestId(null)
          break
      }
    })
  })

  // Handle session status changes
  const unsubSessionStatus = transport.onSessionStatus((status) => {
    if (status.sessionId !== currentSession()?.id) return
    setSessionStatus(status.status)
  })

  // Handle errors
  const unsubError = transport.onError((err) => {
    console.error("[Kilo New] TransportProvider: Error:", err)
    setError(err.message)
  })

  // Handle permission requests
  const unsubPermissionRequest = transport.onPermissionRequest((req) => {
    if (req.request.sessionID !== currentSession()?.id) return
    setPendingPermissions(produce((perms) => perms.push(req.request)))
  })

  // Handle session updates
  const unsubSessionUpdated = transport.onSessionUpdated((msg) => {
    if (msg.session.id === currentSession()?.id) {
      setCurrentSession(msg.session)
    }
  })

  // Handle todos updates
  const unsubTodosUpdated = transport.onTodosUpdated((msg) => {
    if (msg.sessionId !== currentSession()?.id) return
    setTodos(msg.todos)
  })

  // ============================================================================
  // Actions
  // ============================================================================

  const loadSession = async (sessionId?: string): Promise<void> => {
    setIsLoading(true)
    setError(null)

    const state = await transport.loadSession(sessionId)

    batch(() => {
      setCurrentSession(state.session)
      setMessages(state.messages)
      setSessionStatus(state.status)
      setPendingPermissions(state.pendingPermissions ?? [])
      setTodos(state.todos ?? [])
      setIsLoading(false)
    })
  }

  const sendPrompt = (text: string, attachments?: unknown[]): string => {
    const session = currentSession()
    if (!session) {
      throw new Error("No session loaded")
    }
    return transport.sendPrompt(session.id, text, attachments as never)
  }

  const abort = (): void => {
    const session = currentSession()
    if (session) {
      transport.abort(session.id)
    }
  }

  const setModel = (model: string): void => {
    const session = currentSession()
    transport.setModel(model, session?.id)
  }

  const replyToPermission = (
    permissionRequestId: string,
    reply: "once" | "always" | "reject"
  ): void => {
    const session = currentSession()
    if (!session) return

    transport.replyToPermission(session.id, permissionRequestId, reply)

    // Remove from pending
    setPendingPermissions(produce((perms) => {
      const idx = perms.findIndex((p) => p.id === permissionRequestId)
      if (idx !== -1) {
        perms.splice(idx, 1)
      }
    }))
  }

  const createSession = async (title?: string, parentId?: string): Promise<SessionInfo> => {
    return transport.createSession(title, parentId)
  }

  const listSessions = async (): Promise<SessionInfo[]> => {
    return transport.listSessions()
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  createEffect(() => {
    const autoInit = props.autoInit ?? true
    if (autoInit) {
      transport.init(props.context ?? {})

      // Auto-load session if specified
      if (props.initialSessionId !== undefined) {
        loadSession(props.initialSessionId)
      }
    }
  })

  onCleanup(() => {
    unsubMessageAppended()
    unsubMessageUpdated()
    unsubMessageDelta()
    unsubRequestState()
    unsubSessionStatus()
    unsubError()
    unsubPermissionRequest()
    unsubSessionUpdated()
    unsubTodosUpdated()
  })

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: TransportContextValue = {
    transport,
    currentSession,
    messages,
    sessionStatus,
    pendingPermissions,
    todos,
    isLoading,
    error,
    activeRequestId,
    loadSession,
    sendPrompt,
    abort,
    setModel,
    replyToPermission,
    createSession,
    listSessions,
  }

  return (
    <TransportContext.Provider value={value}>
      {props.children}
    </TransportContext.Provider>
  )
}
