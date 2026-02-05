/**
 * Chat Transport Layer
 *
 * Wraps VS Code webview messaging with request/response semantics and streaming support.
 * Provides a typed API for communicating with the extension host.
 */

import type {
  ChatMessage,
  ChatMessageAppendedMessage,
  ChatMessageDeltaMessage,
  ChatMessageUpdatedMessage,
  ChatRequestStateMessage,
  ChatSessionStatusMessage,
  ChatErrorMessage,
  ChatPermissionRequestMessage,
  ChatSessionLoadedMessage,
  ChatSessionsListMessage,
  ChatSessionCreatedMessage,
  ChatSessionUpdatedMessage,
  ChatTodosUpdatedMessage,
  ExtensionToWebviewMessage,
  PromptAttachment,
  SessionInfo,
  ViewContext,
  PermissionRequest,
  SessionStatusInfo,
  TodoItem,
} from "../../../src/shared/chat-protocol"

// ============================================================================
// VS Code API Types
// ============================================================================

interface VSCodeAPI {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

declare function acquireVsCodeApi(): VSCodeAPI

// ============================================================================
// Event Emitter
// ============================================================================

type EventCallback<T> = (data: T) => void

class EventEmitter<T> {
  private listeners: Set<EventCallback<T>> = new Set()

  on(callback: EventCallback<T>): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  emit(data: T): void {
    for (const listener of this.listeners) {
      listener(data)
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}

// ============================================================================
// Session State
// ============================================================================

export interface SessionState {
  session: SessionInfo
  messages: ChatMessage[]
  status: SessionStatusInfo
  pendingPermissions?: PermissionRequest[]
  todos?: TodoItem[]
}

// ============================================================================
// Chat Transport
// ============================================================================

export class ChatTransport {
  private vscode: VSCodeAPI | null = null
  private requestId = 0
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()

  // Event emitters for streaming
  private messageDeltaEmitter = new EventEmitter<ChatMessageDeltaMessage>()
  private messageAppendedEmitter = new EventEmitter<ChatMessageAppendedMessage>()
  private messageUpdatedEmitter = new EventEmitter<ChatMessageUpdatedMessage>()
  private requestStateEmitter = new EventEmitter<ChatRequestStateMessage>()
  private sessionStatusEmitter = new EventEmitter<ChatSessionStatusMessage>()
  private errorEmitter = new EventEmitter<ChatErrorMessage>()
  private permissionRequestEmitter = new EventEmitter<ChatPermissionRequestMessage>()
  private sessionCreatedEmitter = new EventEmitter<ChatSessionCreatedMessage>()
  private sessionUpdatedEmitter = new EventEmitter<ChatSessionUpdatedMessage>()
  private todosUpdatedEmitter = new EventEmitter<ChatTodosUpdatedMessage>()

  private messageHandler: ((event: MessageEvent) => void) | null = null
  private initialized = false

  constructor() {
    this.initVSCodeAPI()
  }

  private initVSCodeAPI(): void {
    if (typeof acquireVsCodeApi === "function") {
      this.vscode = acquireVsCodeApi()
    } else {
      console.warn("[Kilo New] ChatTransport: VS Code API not available (testing mode)")
    }
  }

  private generateRequestId(): string {
    return `req_${++this.requestId}_${Date.now()}`
  }

  private postMessage(message: unknown): void {
    if (!this.vscode) {
      console.warn("[Kilo New] ChatTransport: Cannot post message - VS Code API not available")
      return
    }
    console.log("[Kilo New] ChatTransport: Sending message:", message)
    this.vscode.postMessage(message)
  }

  private handleMessage(event: MessageEvent): void {
    const message = event.data as ExtensionToWebviewMessage
    if (!message || typeof message !== "object" || !("type" in message)) {
      return
    }

    console.log("[Kilo New] ChatTransport: Received message:", message.type, message)

    // Handle request/response correlation
    if (message.requestId && this.pendingRequests.has(message.requestId)) {
      const pending = this.pendingRequests.get(message.requestId)!
      clearTimeout(pending.timeout)
      this.pendingRequests.delete(message.requestId)

      if (message.type === "chat/error") {
        pending.reject(new Error((message as ChatErrorMessage).message))
      } else {
        pending.resolve(message)
      }
      return
    }

    // Emit to appropriate event emitter
    switch (message.type) {
      case "chat/messageDelta":
        this.messageDeltaEmitter.emit(message)
        break
      case "chat/messageAppended":
        this.messageAppendedEmitter.emit(message)
        break
      case "chat/messageUpdated":
        this.messageUpdatedEmitter.emit(message)
        break
      case "chat/requestState":
        this.requestStateEmitter.emit(message)
        break
      case "chat/sessionStatus":
        this.sessionStatusEmitter.emit(message)
        break
      case "chat/error":
        this.errorEmitter.emit(message)
        break
      case "chat/permissionRequest":
        this.permissionRequestEmitter.emit(message)
        break
      case "chat/sessionCreated":
        this.sessionCreatedEmitter.emit(message)
        break
      case "chat/sessionUpdated":
        this.sessionUpdatedEmitter.emit(message)
        break
      case "chat/todosUpdated":
        this.todosUpdatedEmitter.emit(message)
        break
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Initialize the transport and send chat/init message
   */
  init(context: ViewContext): void {
    if (this.initialized) {
      console.warn("[Kilo New] ChatTransport: Already initialized")
      return
    }

    this.messageHandler = this.handleMessage.bind(this)
    window.addEventListener("message", this.messageHandler)
    this.initialized = true

    this.postMessage({
      type: "chat/init",
      context,
    })

    console.log("[Kilo New] ChatTransport: Initialized with context:", context)
  }

  /**
   * Clean up the transport
   */
  dispose(): void {
    if (this.messageHandler) {
      window.removeEventListener("message", this.messageHandler)
      this.messageHandler = null
    }

    // Clear all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error("Transport disposed"))
    }
    this.pendingRequests.clear()

    // Clear all event emitters
    this.messageDeltaEmitter.clear()
    this.messageAppendedEmitter.clear()
    this.messageUpdatedEmitter.clear()
    this.requestStateEmitter.clear()
    this.sessionStatusEmitter.clear()
    this.errorEmitter.clear()
    this.permissionRequestEmitter.clear()
    this.sessionCreatedEmitter.clear()
    this.sessionUpdatedEmitter.clear()
    this.todosUpdatedEmitter.clear()

    this.initialized = false
    console.log("[Kilo New] ChatTransport: Disposed")
  }

  /**
   * Load a session - returns promise that resolves when sessionLoaded received
   */
  loadSession(sessionId?: string, timeout = 30000): Promise<SessionState> {
    const requestId = this.generateRequestId()

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`Load session timeout after ${timeout}ms`))
      }, timeout)

      this.pendingRequests.set(requestId, {
        resolve: (msg) => {
          const loaded = msg as ChatSessionLoadedMessage
          resolve({
            session: loaded.session,
            messages: loaded.messages,
            status: loaded.status,
            pendingPermissions: loaded.pendingPermissions,
            todos: loaded.todos,
          })
        },
        reject,
        timeout: timeoutId,
      })

      this.postMessage({
        type: "chat/loadSession",
        requestId,
        sessionId,
      })
    })
  }

  /**
   * Send a prompt - returns immediately with requestId, streams via events
   */
  sendPrompt(
    sessionId: string,
    text: string,
    attachments?: PromptAttachment[],
    model?: string
  ): string {
    const requestId = this.generateRequestId()

    this.postMessage({
      type: "chat/sendPrompt",
      requestId,
      sessionId,
      text,
      attachments,
      model,
    })

    return requestId
  }

  /**
   * Abort the current request
   */
  abort(sessionId: string): void {
    this.postMessage({
      type: "chat/abort",
      sessionId,
    })
  }

  /**
   * Set the model for future requests
   */
  setModel(model: string, sessionId?: string): void {
    this.postMessage({
      type: "chat/setModel",
      model,
      sessionId,
    })
  }

  /**
   * Reply to a permission request
   */
  replyToPermission(
    sessionId: string,
    permissionRequestId: string,
    reply: "once" | "always" | "reject"
  ): void {
    this.postMessage({
      type: "chat/permissionReply",
      sessionId,
      permissionRequestId,
      reply,
    })
  }

  /**
   * Create a new session
   */
  createSession(title?: string, parentId?: string, timeout = 10000): Promise<SessionInfo> {
    const requestId = this.generateRequestId()

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`Create session timeout after ${timeout}ms`))
      }, timeout)

      this.pendingRequests.set(requestId, {
        resolve: (msg) => {
          const created = msg as ChatSessionCreatedMessage
          resolve(created.session)
        },
        reject,
        timeout: timeoutId,
      })

      this.postMessage({
        type: "chat/createSession",
        requestId,
        title,
        parentId,
      })
    })
  }

  /**
   * List available sessions
   */
  listSessions(timeout = 10000): Promise<SessionInfo[]> {
    const requestId = this.generateRequestId()

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`List sessions timeout after ${timeout}ms`))
      }, timeout)

      this.pendingRequests.set(requestId, {
        resolve: (msg) => {
          const list = msg as ChatSessionsListMessage
          resolve(list.sessions)
        },
        reject,
        timeout: timeoutId,
      })

      this.postMessage({
        type: "chat/listSessions",
        requestId,
      })
    })
  }

  // ============================================================================
  // Event Subscriptions
  // ============================================================================

  /**
   * Subscribe to streaming message deltas
   */
  onMessageDelta(callback: (delta: ChatMessageDeltaMessage) => void): () => void {
    return this.messageDeltaEmitter.on(callback)
  }

  /**
   * Subscribe to new messages being appended
   */
  onMessageAppended(callback: (msg: ChatMessageAppendedMessage) => void): () => void {
    return this.messageAppendedEmitter.on(callback)
  }

  /**
   * Subscribe to message updates
   */
  onMessageUpdated(callback: (msg: ChatMessageUpdatedMessage) => void): () => void {
    return this.messageUpdatedEmitter.on(callback)
  }

  /**
   * Subscribe to request state changes
   */
  onRequestState(callback: (state: ChatRequestStateMessage) => void): () => void {
    return this.requestStateEmitter.on(callback)
  }

  /**
   * Subscribe to session status changes
   */
  onSessionStatus(callback: (status: ChatSessionStatusMessage) => void): () => void {
    return this.sessionStatusEmitter.on(callback)
  }

  /**
   * Subscribe to errors
   */
  onError(callback: (error: ChatErrorMessage) => void): () => void {
    return this.errorEmitter.on(callback)
  }

  /**
   * Subscribe to permission requests
   */
  onPermissionRequest(callback: (request: ChatPermissionRequestMessage) => void): () => void {
    return this.permissionRequestEmitter.on(callback)
  }

  /**
   * Subscribe to session created events
   */
  onSessionCreated(callback: (msg: ChatSessionCreatedMessage) => void): () => void {
    return this.sessionCreatedEmitter.on(callback)
  }

  /**
   * Subscribe to session updated events
   */
  onSessionUpdated(callback: (msg: ChatSessionUpdatedMessage) => void): () => void {
    return this.sessionUpdatedEmitter.on(callback)
  }

  /**
   * Subscribe to todos updated events
   */
  onTodosUpdated(callback: (msg: ChatTodosUpdatedMessage) => void): () => void {
    return this.todosUpdatedEmitter.on(callback)
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let transportInstance: ChatTransport | null = null

/**
 * Get the singleton transport instance
 */
export function getChatTransport(): ChatTransport {
  if (!transportInstance) {
    transportInstance = new ChatTransport()
  }
  return transportInstance
}

/**
 * Reset the transport instance (for testing)
 */
export function resetChatTransport(): void {
  if (transportInstance) {
    transportInstance.dispose()
    transportInstance = null
  }
}
