/**
 * Chat Store
 * 
 * A simplified store for managing chat state in the VS Code webview.
 * This replaces the complex sync/sdk contexts with a transport-based approach.
 */

import { createStore, produce, reconcile } from 'solid-js/store';
import { createSignal, batch, onCleanup, createMemo, type Accessor } from 'solid-js';
import { createChatTransport, type ChatTransport } from './transport';
import type {
  ChatConfig,
  SessionInfo,
  ChatMessage,
  MessagePart,
  PromptAttachment,
} from '../../../src/shared/protocol';

export interface ChatState {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  config: ChatConfig;
  sessions: SessionInfo[];
  currentSessionId?: string;
  messages: Record<string, ChatMessage[]>;
  parts: Record<string, MessagePart[]>;
  requestState: Record<string, 'idle' | 'started' | 'streaming' | 'finished' | 'aborted' | 'error'>;
}

export interface ChatStore {
  state: ChatState;
  currentSession: Accessor<SessionInfo | undefined>;
  currentMessages: Accessor<ChatMessage[]>;
  isStreaming: Accessor<boolean>;
  
  // Actions
  init(workspaceFolder?: string): Promise<void>;
  loadSession(sessionId: string): Promise<void>;
  createSession(): Promise<SessionInfo>;
  sendPrompt(params: {
    text: string;
    attachments?: PromptAttachment[];
    agent?: string;
    model?: { providerId: string; modelId: string };
  }): void;
  abort(): void;
  setCurrentSession(sessionId: string | undefined): void;
}

export function createChatStore(): ChatStore {
  const transport = createChatTransport();
  
  const [state, setState] = createStore<ChatState>({
    status: 'loading',
    config: {},
    sessions: [],
    currentSessionId: undefined,
    messages: {},
    parts: {},
    requestState: {},
  });

  // Derived state
  const currentSession = createMemo(() => {
    const id = state.currentSessionId;
    if (!id) return undefined;
    return state.sessions.find(s => s.id === id);
  });

  const currentMessages = createMemo(() => {
    const id = state.currentSessionId;
    if (!id) return [];
    return state.messages[id] ?? [];
  });

  const isStreaming = createMemo(() => {
    const id = state.currentSessionId;
    if (!id) return false;
    const reqState = state.requestState[id];
    return reqState === 'started' || reqState === 'streaming';
  });

  // Set up event listeners
  const unsubMessageAppended = transport.onMessageAppended(({ sessionId, message }) => {
    setState(produce(draft => {
      if (!draft.messages[sessionId]) {
        draft.messages[sessionId] = [];
      }
      // Check if message already exists
      const existing = draft.messages[sessionId].findIndex(m => m.id === message.id);
      if (existing >= 0) {
        draft.messages[sessionId][existing] = message;
      } else {
        draft.messages[sessionId].push(message);
      }
    }));
  });

  const unsubMessageDelta = transport.onMessageDelta(({ sessionId, messageId, partId, delta, part }) => {
    setState(produce(draft => {
      // Update or create the part
      if (!draft.parts[messageId]) {
        draft.parts[messageId] = [];
      }
      
      const partIndex = draft.parts[messageId].findIndex(p => p.id === partId);
      if (partIndex >= 0) {
        // Append delta to existing content
        const existing = draft.parts[messageId][partIndex];
        if (existing.type === 'text' && delta) {
          existing.content = (existing.content || '') + delta;
        }
        if (part) {
          draft.parts[messageId][partIndex] = part;
        }
      } else if (part) {
        // Add new part
        draft.parts[messageId].push(part);
      }
      
      // Update request state to streaming
      if (draft.requestState[sessionId] === 'started') {
        draft.requestState[sessionId] = 'streaming';
      }
    }));
  });

  const unsubPartUpdated = transport.onPartUpdated(({ messageId, part }) => {
    setState(produce(draft => {
      if (!draft.parts[messageId]) {
        draft.parts[messageId] = [];
      }
      
      const partIndex = draft.parts[messageId].findIndex(p => p.id === part.id);
      if (partIndex >= 0) {
        draft.parts[messageId][partIndex] = part;
      } else {
        draft.parts[messageId].push(part);
      }
    }));
  });

  const unsubRequestState = transport.onRequestState(({ sessionId, state: reqState, error }) => {
    setState(produce(draft => {
      draft.requestState[sessionId] = reqState as ChatState['requestState'][string];
      if (error && reqState === 'error') {
        draft.error = error;
      }
    }));
  });

  const unsubError = transport.onError(({ error }) => {
    setState('error', error);
  });

  // Clean up on unmount
  if (typeof window !== 'undefined') {
    onCleanup(() => {
      unsubMessageAppended();
      unsubMessageDelta();
      unsubPartUpdated();
      unsubRequestState();
      unsubError();
    });
  }

  return {
    get state() {
      return state;
    },
    currentSession,
    currentMessages,
    isStreaming,

    async init(workspaceFolder) {
      setState('status', 'loading');
      const result = await transport.init(workspaceFolder);
      
      batch(() => {
        setState('config', result.config);
        if (result.sessions) {
          setState('sessions', result.sessions);
        }
        if (result.session) {
          setState('currentSessionId', result.session.id);
          // Add to sessions if not present
          if (!state.sessions.find(s => s.id === result.session!.id)) {
            setState('sessions', produce(draft => {
              draft.push(result.session!);
            }));
          }
        }
        setState('status', 'ready');
      });
    },

    async loadSession(sessionId) {
      const result = await transport.loadSession(sessionId);
      
      batch(() => {
        setState('currentSessionId', sessionId);
        setState('messages', sessionId, result.messages);
        
        // Update session info
        const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
        if (sessionIndex >= 0) {
          setState('sessions', sessionIndex, result.session);
        } else {
          setState('sessions', produce(draft => {
            draft.push(result.session);
          }));
        }
        
        // Extract parts from messages
        for (const message of result.messages) {
          if (message.parts) {
            setState('parts', message.id, message.parts);
          }
        }
      });
    },

    async createSession() {
      const session = await transport.createSession();
      
      batch(() => {
        setState('currentSessionId', session.id);
        setState('sessions', produce(draft => {
          draft.unshift(session);
        }));
        setState('messages', session.id, []);
        setState('requestState', session.id, 'idle');
      });
      
      return session;
    },

    sendPrompt(params) {
      const sessionId = state.currentSessionId;
      if (!sessionId) return;

      setState('requestState', sessionId, 'started');
      
      transport.sendPrompt({
        sessionId,
        ...params,
      });
    },

    abort() {
      const sessionId = state.currentSessionId;
      if (!sessionId) return;

      transport.abort(sessionId);
    },

    setCurrentSession(sessionId) {
      setState('currentSessionId', sessionId);
    },
  };
}

// Create a singleton instance for use across the app
let chatStoreInstance: ChatStore | undefined;

export function getChatStore(): ChatStore {
  if (!chatStoreInstance) {
    chatStoreInstance = createChatStore();
  }
  return chatStoreInstance;
}
