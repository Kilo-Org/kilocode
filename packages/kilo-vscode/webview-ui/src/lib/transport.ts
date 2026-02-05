/**
 * Transport layer for webview <-> extension host communication
 * 
 * This module wraps vscode.postMessage with request/response semantics
 * and provides an event emitter pattern for streaming deltas.
 */

import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  MessageHandler,
  MessageBus,
  ChatConfig,
  SessionInfo,
  ChatMessage,
  MessagePart,
  PromptAttachment,
} from '../../../src/shared/protocol';

// Get the VS Code API - this is injected by the webview
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

let vscodeApi: ReturnType<typeof acquireVsCodeApi> | undefined;

function getVsCodeApi() {
  if (!vscodeApi) {
    vscodeApi = acquireVsCodeApi();
  }
  return vscodeApi;
}

type ListenerMap = Map<string, Set<MessageHandler>>;

const listeners: ListenerMap = new Map();
const onceListeners: ListenerMap = new Map();

let requestCounter = 0;
const pendingRequests = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

// Set up message listener
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as ExtensionToWebviewMessage;
    if (!message?.type) return;

    // Handle pending request responses
    if (message.requestId && pendingRequests.has(message.requestId)) {
      const pending = pendingRequests.get(message.requestId)!;
      pendingRequests.delete(message.requestId);
      clearTimeout(pending.timeout);
      
      if (message.type === 'chat/error') {
        pending.reject(new Error((message as { error: string }).error));
      } else {
        pending.resolve(message);
      }
      return;
    }

    // Notify type-specific listeners
    const typeListeners = listeners.get(message.type);
    if (typeListeners) {
      for (const handler of typeListeners) {
        handler(message);
      }
    }

    // Handle once listeners
    const typeOnceListeners = onceListeners.get(message.type);
    if (typeOnceListeners) {
      for (const handler of typeOnceListeners) {
        handler(message);
      }
      onceListeners.delete(message.type);
    }
  });
}

/**
 * Send a message to the extension host
 */
export function postMessage(message: WebviewToExtensionMessage): void {
  getVsCodeApi().postMessage(message);
}

/**
 * Send a message and wait for a response
 */
export function sendRequest<T extends ExtensionToWebviewMessage>(
  message: WebviewToExtensionMessage,
  timeoutMs = 30000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = `req_${++requestCounter}_${Date.now()}`;
    const messageWithId = { ...message, requestId };

    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Request timed out: ${message.type}`));
    }, timeoutMs);

    pendingRequests.set(requestId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
    });

    postMessage(messageWithId);
  });
}

/**
 * Subscribe to a message type
 */
export function on<T extends ExtensionToWebviewMessage['type']>(
  type: T,
  handler: MessageHandler<Extract<ExtensionToWebviewMessage, { type: T }>>
): () => void {
  let typeListeners = listeners.get(type);
  if (!typeListeners) {
    typeListeners = new Set();
    listeners.set(type, typeListeners);
  }
  typeListeners.add(handler as MessageHandler);

  return () => {
    typeListeners?.delete(handler as MessageHandler);
  };
}

/**
 * Subscribe to a message type (one-time)
 */
export function once<T extends ExtensionToWebviewMessage['type']>(
  type: T,
  handler: MessageHandler<Extract<ExtensionToWebviewMessage, { type: T }>>
): () => void {
  let typeListeners = onceListeners.get(type);
  if (!typeListeners) {
    typeListeners = new Set();
    onceListeners.set(type, typeListeners);
  }
  typeListeners.add(handler as MessageHandler);

  return () => {
    typeListeners?.delete(handler as MessageHandler);
  };
}

/**
 * Message bus implementation for use in contexts
 */
export const messageBus: MessageBus = {
  post: postMessage,
  on,
  once,
};

// ============================================================================
// High-level API for chat operations
// ============================================================================

export interface ChatTransport {
  init(workspaceFolder?: string): Promise<{
    config: ChatConfig;
    session?: SessionInfo;
    sessions?: SessionInfo[];
  }>;
  
  loadSession(sessionId: string): Promise<{
    session: SessionInfo;
    messages: ChatMessage[];
  }>;
  
  createSession(): Promise<SessionInfo>;
  
  sendPrompt(params: {
    sessionId: string;
    text: string;
    attachments?: PromptAttachment[];
    agent?: string;
    model?: { providerId: string; modelId: string };
  }): void;
  
  abort(sessionId: string): void;
  
  listSessions(): Promise<SessionInfo[]>;
  
  onMessageAppended(handler: (data: { sessionId: string; message: ChatMessage }) => void): () => void;
  onMessageDelta(handler: (data: { sessionId: string; messageId: string; partId: string; delta: string; part?: MessagePart }) => void): () => void;
  onPartUpdated(handler: (data: { sessionId: string; messageId: string; part: MessagePart }) => void): () => void;
  onRequestState(handler: (data: { sessionId: string; state: string; error?: string }) => void): () => void;
  onSessionCreated(handler: (data: { session: SessionInfo }) => void): () => void;
  onError(handler: (data: { error: string; details?: string }) => void): () => void;
}

export function createChatTransport(): ChatTransport {
  return {
    async init(workspaceFolder) {
      const response = await sendRequest<{
        type: 'chat/initialized';
        config: ChatConfig;
        session?: SessionInfo;
        sessions?: SessionInfo[];
      }>({
        type: 'chat/init',
        workspaceFolder,
      });
      return {
        config: response.config,
        session: response.session,
        sessions: response.sessions,
      };
    },

    async loadSession(sessionId) {
      const response = await sendRequest<{
        type: 'chat/sessionLoaded';
        session: SessionInfo;
        messages: ChatMessage[];
      }>({
        type: 'chat/loadSession',
        sessionId,
      });
      return {
        session: response.session,
        messages: response.messages,
      };
    },

    async createSession() {
      const response = await sendRequest<{
        type: 'chat/sessionCreated';
        session: SessionInfo;
      }>({
        type: 'chat/createSession',
      });
      return response.session;
    },

    sendPrompt(params) {
      postMessage({
        type: 'chat/sendPrompt',
        ...params,
      });
    },

    abort(sessionId) {
      postMessage({
        type: 'chat/abort',
        sessionId,
      });
    },

    async listSessions() {
      const response = await sendRequest<{
        type: 'chat/sessionsListed';
        sessions: SessionInfo[];
      }>({
        type: 'chat/listSessions',
      });
      return response.sessions;
    },

    onMessageAppended(handler) {
      return on('chat/messageAppended', (msg) => {
        handler({ sessionId: msg.sessionId, message: msg.message });
      });
    },

    onMessageDelta(handler) {
      return on('chat/messageDelta', (msg) => {
        handler({
          sessionId: msg.sessionId,
          messageId: msg.messageId,
          partId: msg.partId,
          delta: msg.delta,
          part: msg.part,
        });
      });
    },

    onPartUpdated(handler) {
      return on('chat/partUpdated', (msg) => {
        handler({
          sessionId: msg.sessionId,
          messageId: msg.messageId,
          part: msg.part,
        });
      });
    },

    onRequestState(handler) {
      return on('chat/requestState', (msg) => {
        handler({
          sessionId: msg.sessionId,
          state: msg.state,
          error: msg.error,
        });
      });
    },

    onSessionCreated(handler) {
      return on('chat/sessionCreated', (msg) => {
        handler({ session: msg.session });
      });
    },

    onError(handler) {
      return on('chat/error', (msg) => {
        handler({ error: msg.error, details: msg.details });
      });
    },
  };
}
