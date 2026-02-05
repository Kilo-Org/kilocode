/**
 * Message protocol for webview <-> extension host communication
 * 
 * This file defines the typed message protocol used for bidirectional 
 * communication between the VS Code webview and the extension host.
 */

// ============================================================================
// Base types
// ============================================================================

export interface BaseMessage {
  type: string;
  requestId?: string;
}

// ============================================================================
// Webview → Extension messages
// ============================================================================

export interface ChatInitMessage extends BaseMessage {
  type: 'chat/init';
  workspaceFolder?: string;
}

export interface ChatLoadSessionMessage extends BaseMessage {
  type: 'chat/loadSession';
  sessionId: string;
}

export interface ChatCreateSessionMessage extends BaseMessage {
  type: 'chat/createSession';
}

export interface ChatSendPromptMessage extends BaseMessage {
  type: 'chat/sendPrompt';
  sessionId: string;
  text: string;
  attachments?: PromptAttachment[];
  agent?: string;
  model?: {
    providerId: string;
    modelId: string;
  };
}

export interface ChatAbortMessage extends BaseMessage {
  type: 'chat/abort';
  sessionId: string;
}

export interface ChatSetModelMessage extends BaseMessage {
  type: 'chat/setModel';
  providerId: string;
  modelId: string;
}

export interface ChatListSessionsMessage extends BaseMessage {
  type: 'chat/listSessions';
}

export interface PromptAttachment {
  type: 'file' | 'image';
  path?: string;
  content?: string;
  mimeType?: string;
}

export type WebviewToExtensionMessage =
  | ChatInitMessage
  | ChatLoadSessionMessage
  | ChatCreateSessionMessage
  | ChatSendPromptMessage
  | ChatAbortMessage
  | ChatSetModelMessage
  | ChatListSessionsMessage
  | ActionMessage;

// Action messages (from original App.tsx)
export interface ActionMessage extends BaseMessage {
  type: 'action';
  action: string;
}

// ============================================================================
// Extension → Webview messages
// ============================================================================

export interface ChatInitializedMessage extends BaseMessage {
  type: 'chat/initialized';
  config: ChatConfig;
  session?: SessionInfo;
  sessions?: SessionInfo[];
}

export interface ChatSessionLoadedMessage extends BaseMessage {
  type: 'chat/sessionLoaded';
  session: SessionInfo;
  messages: ChatMessage[];
}

export interface ChatSessionCreatedMessage extends BaseMessage {
  type: 'chat/sessionCreated';
  session: SessionInfo;
}

export interface ChatMessageAppendedMessage extends BaseMessage {
  type: 'chat/messageAppended';
  sessionId: string;
  message: ChatMessage;
}

export interface ChatMessageDeltaMessage extends BaseMessage {
  type: 'chat/messageDelta';
  sessionId: string;
  messageId: string;
  partId: string;
  delta: string;
  part?: MessagePart;
}

export interface ChatPartUpdatedMessage extends BaseMessage {
  type: 'chat/partUpdated';
  sessionId: string;
  messageId: string;
  part: MessagePart;
}

export interface ChatRequestStateMessage extends BaseMessage {
  type: 'chat/requestState';
  sessionId: string;
  state: 'started' | 'streaming' | 'finished' | 'aborted' | 'error';
  error?: string;
}

export interface ChatErrorMessage extends BaseMessage {
  type: 'chat/error';
  error: string;
  details?: string;
}

export interface ChatSessionsListedMessage extends BaseMessage {
  type: 'chat/sessionsListed';
  sessions: SessionInfo[];
}

export type ExtensionToWebviewMessage =
  | ChatInitializedMessage
  | ChatSessionLoadedMessage
  | ChatSessionCreatedMessage
  | ChatMessageAppendedMessage
  | ChatMessageDeltaMessage
  | ChatPartUpdatedMessage
  | ChatRequestStateMessage
  | ChatErrorMessage
  | ChatSessionsListedMessage
  | ActionMessage;

// ============================================================================
// Shared data types
// ============================================================================

export interface ChatConfig {
  serverUrl?: string;
  workspaceFolder?: string;
  agents?: AgentInfo[];
  providers?: ProviderInfo[];
}

export interface AgentInfo {
  name: string;
  description?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  models: ModelInfo[];
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface SessionInfo {
  id: string;
  title?: string;
  parentId?: string;
  time: {
    created: number;
    updated?: number;
  };
  summary?: {
    files?: number;
    tokens?: {
      input?: number;
      output?: number;
    };
  };
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  time: {
    created: number;
  };
  agent?: string;
  model?: {
    providerId: string;
    modelId: string;
  };
  parts?: MessagePart[];
}

export interface MessagePart {
  id: string;
  messageId: string;
  type: 'text' | 'tool-invocation' | 'tool-result' | 'file' | 'image' | 'error';
  content?: string;
  tool?: {
    name: string;
    input?: unknown;
    output?: unknown;
  };
  file?: {
    path: string;
    content?: string;
  };
  time?: {
    start?: number;
    end?: number;
  };
}

// ============================================================================
// Helper types
// ============================================================================

export type MessageHandler<T extends BaseMessage = BaseMessage> = (message: T) => void;

export interface MessageBus {
  post(message: WebviewToExtensionMessage): void;
  on<T extends ExtensionToWebviewMessage['type']>(
    type: T,
    handler: MessageHandler<Extract<ExtensionToWebviewMessage, { type: T }>>
  ): () => void;
  once<T extends ExtensionToWebviewMessage['type']>(
    type: T,
    handler: MessageHandler<Extract<ExtensionToWebviewMessage, { type: T }>>
  ): () => void;
}
