/**
 * Chat Protocol Types
 *
 * Shared message types for communication between the VS Code webview and extension host.
 * This file is imported by both sides to ensure type safety.
 *
 * Message flow:
 * - Webview → Extension: User actions (init, send prompt, abort, etc.)
 * - Extension → Webview: Backend responses (session data, streaming deltas, errors)
 */

import type {
  MessageInfo,
  MessagePart,
  PermissionRequest,
  SessionInfo,
  SessionStatusInfo,
  TodoItem,
} from "../services/cli-backend/types";

// Re-export types that the webview will need
export type {
  MessageInfo,
  MessagePart,
  PermissionRequest,
  SessionInfo,
  SessionStatusInfo,
  TodoItem,
  ToolState,
} from "../services/cli-backend/types";

// ============================================================================
// Base Types
// ============================================================================

/**
 * Base interface for all messages with optional correlation ID
 */
interface BaseMessage {
  type: string
  /** Correlation ID for matching requests with responses */
  requestId?: string
}

/**
 * View context passed from webview to extension on init
 */
export interface ViewContext {
  /** Current workspace folder path */
  workspacePath?: string
  /** Active editor file path */
  activeFilePath?: string
  /** Selected text in editor */
  selectedText?: string
}

/**
 * Attachment that can be sent with a prompt
 */
export interface PromptAttachment {
  type: "file" | "selection" | "image" | "url"
  /** File path or URL */
  path?: string
  /** Content (for selection or inline content) */
  content?: string
  /** MIME type for images */
  mimeType?: string
  /** Display name */
  name?: string
}

/**
 * Full message with parts for display in the chat timeline
 */
export interface ChatMessage extends MessageInfo {
  parts: MessagePart[]
}

/**
 * Request state for tracking async operations
 */
export type RequestState =
  | { status: "started"; requestId: string }
  | { status: "finished"; requestId: string }
  | { status: "aborted"; requestId: string; reason?: string }

// ============================================================================
// Webview → Extension Messages
// ============================================================================

/**
 * Sent when the webview is ready and initialized
 */
export interface ChatInitMessage extends BaseMessage {
  type: "chat/init"
  /** Context about the current view state */
  context: ViewContext
}

/**
 * Request to load a specific session by ID
 */
export interface ChatLoadSessionMessage extends BaseMessage {
  type: "chat/loadSession"
  /** Session ID to load, or undefined to create/load default session */
  sessionId?: string
}

/**
 * Send a prompt to the assistant
 */
export interface ChatSendPromptMessage extends BaseMessage {
  type: "chat/sendPrompt"
  /** Session ID to send the prompt to */
  sessionId: string
  /** The prompt text */
  text: string
  /** Optional attachments (files, selections, images) */
  attachments?: PromptAttachment[]
  /** Optional model override */
  model?: string
}

/**
 * Abort the current request
 */
export interface ChatAbortMessage extends BaseMessage {
  type: "chat/abort"
  /** Session ID to abort */
  sessionId: string
}

/**
 * Set the model for future requests
 */
export interface ChatSetModelMessage extends BaseMessage {
  type: "chat/setModel"
  /** Model identifier */
  model: string
  /** Optional session ID (if model is per-session) */
  sessionId?: string
}

/**
 * Reply to a permission request
 */
export interface ChatPermissionReplyMessage extends BaseMessage {
  type: "chat/permissionReply"
  /** Session ID */
  sessionId: string
  /** Permission request ID */
  permissionRequestId: string
  /** User's reply */
  reply: "once" | "always" | "reject"
}

/**
 * Request to list available sessions
 */
export interface ChatListSessionsMessage extends BaseMessage {
  type: "chat/listSessions"
}

/**
 * Request to create a new session
 */
export interface ChatCreateSessionMessage extends BaseMessage {
  type: "chat/createSession"
  /** Optional title for the session */
  title?: string
  /** Optional parent session ID for forking */
  parentId?: string
}

/**
 * Union of all webview → extension messages
 */
export type WebviewToExtensionMessage =
  | ChatInitMessage
  | ChatLoadSessionMessage
  | ChatSendPromptMessage
  | ChatAbortMessage
  | ChatSetModelMessage
  | ChatPermissionReplyMessage
  | ChatListSessionsMessage
  | ChatCreateSessionMessage

// ============================================================================
// Extension → Webview Messages
// ============================================================================

/**
 * Sent when a session is loaded with its full state
 */
export interface ChatSessionLoadedMessage extends BaseMessage {
  type: "chat/sessionLoaded"
  /** The loaded session info */
  session: SessionInfo
  /** All messages in the session */
  messages: ChatMessage[]
  /** Current session status */
  status: SessionStatusInfo
  /** Pending permission requests */
  pendingPermissions?: PermissionRequest[]
  /** Todo items */
  todos?: TodoItem[]
}

/**
 * Sent when a new message is added to the session
 */
export interface ChatMessageAppendedMessage extends BaseMessage {
  type: "chat/messageAppended"
  /** Session ID */
  sessionId: string
  /** The new message */
  message: ChatMessage
}

/**
 * Sent when a message is updated (e.g., completed)
 */
export interface ChatMessageUpdatedMessage extends BaseMessage {
  type: "chat/messageUpdated"
  /** Session ID */
  sessionId: string
  /** Updated message info */
  message: MessageInfo
}

/**
 * Streaming delta for a message part
 */
export interface ChatMessageDeltaMessage extends BaseMessage {
  type: "chat/messageDelta"
  /** Session ID */
  sessionId: string
  /** Message ID this delta belongs to */
  messageId: string
  /** The updated part */
  part: MessagePart
  /** Text delta (for streaming text) */
  delta?: string
}

/**
 * Request state change notification
 */
export interface ChatRequestStateMessage extends BaseMessage {
  type: "chat/requestState"
  /** Session ID */
  sessionId: string
  /** The state change */
  state: RequestState
}

/**
 * Session status change notification
 */
export interface ChatSessionStatusMessage extends BaseMessage {
  type: "chat/sessionStatus"
  /** Session ID */
  sessionId: string
  /** New status */
  status: SessionStatusInfo
}

/**
 * Error notification
 */
export interface ChatErrorMessage extends BaseMessage {
  type: "chat/error"
  /** Human-readable error message */
  message: string
  /** Error code for programmatic handling */
  code?: string
  /** Debug information */
  debug?: {
    stack?: string
    context?: Record<string, unknown>
  }
  /** Session ID if error is session-specific */
  sessionId?: string
}

/**
 * Permission request from the backend
 */
export interface ChatPermissionRequestMessage extends BaseMessage {
  type: "chat/permissionRequest"
  /** The permission request details */
  request: PermissionRequest
}

/**
 * List of available sessions
 */
export interface ChatSessionsListMessage extends BaseMessage {
  type: "chat/sessionsList"
  /** Available sessions */
  sessions: SessionInfo[]
}

/**
 * Session created notification
 */
export interface ChatSessionCreatedMessage extends BaseMessage {
  type: "chat/sessionCreated"
  /** The created session */
  session: SessionInfo
}

/**
 * Session updated notification
 */
export interface ChatSessionUpdatedMessage extends BaseMessage {
  type: "chat/sessionUpdated"
  /** The updated session info */
  session: SessionInfo
}

/**
 * Todo list updated notification
 */
export interface ChatTodosUpdatedMessage extends BaseMessage {
  type: "chat/todosUpdated"
  /** Session ID */
  sessionId: string
  /** Updated todo items */
  todos: TodoItem[]
}

/**
 * Union of all extension → webview messages
 */
export type ExtensionToWebviewMessage =
  | ChatSessionLoadedMessage
  | ChatMessageAppendedMessage
  | ChatMessageUpdatedMessage
  | ChatMessageDeltaMessage
  | ChatRequestStateMessage
  | ChatSessionStatusMessage
  | ChatErrorMessage
  | ChatPermissionRequestMessage
  | ChatSessionsListMessage
  | ChatSessionCreatedMessage
  | ChatSessionUpdatedMessage
  | ChatTodosUpdatedMessage

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a message is a webview → extension message
 */
export function isWebviewMessage(msg: unknown): msg is WebviewToExtensionMessage {
  if (!msg || typeof msg !== "object" || !("type" in msg)) {
    return false;
  }
  const type = (msg as { type: string }).type;
  return type.startsWith("chat/") && isWebviewMessageType(type);
}

/**
 * Check if a message is an extension → webview message
 */
export function isExtensionMessage(msg: unknown): msg is ExtensionToWebviewMessage {
  if (!msg || typeof msg !== "object" || !("type" in msg)) {
    return false;
  }
  const type = (msg as { type: string }).type;
  return type.startsWith("chat/") && isExtensionMessageType(type);
}

const WEBVIEW_MESSAGE_TYPES = new Set([
  "chat/init",
  "chat/loadSession",
  "chat/sendPrompt",
  "chat/abort",
  "chat/setModel",
  "chat/permissionReply",
  "chat/listSessions",
  "chat/createSession",
]);

const EXTENSION_MESSAGE_TYPES = new Set([
  "chat/sessionLoaded",
  "chat/messageAppended",
  "chat/messageUpdated",
  "chat/messageDelta",
  "chat/requestState",
  "chat/sessionStatus",
  "chat/error",
  "chat/permissionRequest",
  "chat/sessionsList",
  "chat/sessionCreated",
  "chat/sessionUpdated",
  "chat/todosUpdated",
]);

function isWebviewMessageType(type: string): boolean {
  return WEBVIEW_MESSAGE_TYPES.has(type);
}

function isExtensionMessageType(type: string): boolean {
  return EXTENSION_MESSAGE_TYPES.has(type);
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Extract the message type from a message
 */
export type MessageType<T extends { type: string }> = T["type"]

/**
 * Get a specific message type from the union
 */
export type WebviewMessageByType<T extends WebviewToExtensionMessage["type"]> = Extract<
  WebviewToExtensionMessage,
  { type: T }
>

export type ExtensionMessageByType<T extends ExtensionToWebviewMessage["type"]> = Extract<
  ExtensionToWebviewMessage,
  { type: T }
>

/**
 * Handler map type for processing messages
 */
export type WebviewMessageHandler = {
  [K in WebviewToExtensionMessage["type"]]?: (
    message: WebviewMessageByType<K>
  ) => void | Promise<void>
}

export type ExtensionMessageHandler = {
  [K in ExtensionToWebviewMessage["type"]]?: (
    message: ExtensionMessageByType<K>
  ) => void | Promise<void>
}
