/**
 * Transport Module
 *
 * Exports the chat transport layer for webview-extension communication.
 */

// Core transport
export {
  ChatTransport,
  getChatTransport,
  resetChatTransport,
  type SessionState,
} from "./chat-transport"

// Solid.js provider
export {
  TransportProvider,
  useTransport,
  type TransportContextValue,
  type TransportProviderProps,
} from "./TransportProvider"

// Re-export protocol types for convenience
export type {
  // Message types
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
  // Data types
  SessionInfo,
  SessionStatusInfo,
  MessageInfo,
  MessagePart,
  PermissionRequest,
  TodoItem,
  ToolState,
  PromptAttachment,
  ViewContext,
  RequestState,
  // Union types
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
} from "../../../src/shared/chat-protocol"
