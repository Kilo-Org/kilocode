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
    console.log('[Kilo New] chat-store: onMessageAppended - incomingSessionId:', sessionId, 'currentSessionId:', state.currentSessionId);
    
    setState(produce(draft => {
      // If we receive a message for a different session and our current session is a local one,
      // this means the backend has migrated our local session to a real backend session.
      // We should switch to the new session ID.
      if (draft.currentSessionId &&
          draft.currentSessionId !== sessionId &&
          draft.currentSessionId.startsWith('local_session_')) {
        console.log('[Kilo New] chat-store: Session migration detected - switching from', draft.currentSessionId, 'to', sessionId);
        
        // Move any existing messages from the local session to the new session
        const localMessages = draft.messages[draft.currentSessionId] || [];
        if (localMessages.length > 0) {
          console.log('[Kilo New] chat-store: Moving', localMessages.length, 'messages from local session to backend session');
          if (!draft.messages[sessionId]) {
            draft.messages[sessionId] = [];
          }
          // Prepend local messages to the new session
          draft.messages[sessionId] = [...localMessages, ...draft.messages[sessionId]];
          delete draft.messages[draft.currentSessionId];
        }
        
        // Copy request state
        if (draft.requestState[draft.currentSessionId]) {
          draft.requestState[sessionId] = draft.requestState[draft.currentSessionId];
          delete draft.requestState[draft.currentSessionId];
        }
        
        // Update current session ID
        draft.currentSessionId = sessionId;
        
        // Update sessions list - remove local session, add backend session if not present
        const localSessionIndex = draft.sessions.findIndex(s => s.id.startsWith('local_session_'));
        if (localSessionIndex >= 0) {
          draft.sessions.splice(localSessionIndex, 1);
        }
        if (!draft.sessions.find(s => s.id === sessionId)) {
          draft.sessions.unshift({
            id: sessionId,
            time: { created: Date.now() },
          });
        }
      }
      
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
    console.log('[Kilo New] chat-store: onMessageDelta - incomingSessionId:', sessionId, 'currentSessionId:', state.currentSessionId, 'messageId:', messageId);
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

  // Handle session migration from backend
  // This is sent when the ChatController migrates a local session to a backend session
  const unsubSessionCreated = transport.onSessionCreated(({ session }) => {
    console.log('[Kilo New] chat-store: onSessionCreated - newSessionId:', session.id, 'currentSessionId:', state.currentSessionId);
    
    setState(produce(draft => {
      const oldSessionId = draft.currentSessionId;
      
      // Only migrate if current session is a local session
      if (oldSessionId && oldSessionId.startsWith('local_session_')) {
        console.log('[Kilo New] chat-store: Session migration via onSessionCreated - switching from', oldSessionId, 'to', session.id);
        
        // Move messages from local session to new session
        const localMessages = draft.messages[oldSessionId] || [];
        if (localMessages.length > 0) {
          console.log('[Kilo New] chat-store: Moving', localMessages.length, 'messages from local session to backend session');
          draft.messages[session.id] = localMessages;
          delete draft.messages[oldSessionId];
        } else {
          draft.messages[session.id] = [];
        }
        
        // Copy request state
        if (draft.requestState[oldSessionId]) {
          draft.requestState[session.id] = draft.requestState[oldSessionId];
          delete draft.requestState[oldSessionId];
        }
        
        // Remove local session from sessions list
        const localSessionIndex = draft.sessions.findIndex(s => s.id === oldSessionId);
        if (localSessionIndex >= 0) {
          draft.sessions.splice(localSessionIndex, 1);
        }
      }
      
      // Add new session to sessions list if not present
      if (!draft.sessions.find(s => s.id === session.id)) {
        draft.sessions.unshift(session);
      }
      
      // Update current session ID
      draft.currentSessionId = session.id;
    }));
  });

  // Clean up on unmount
  if (typeof window !== 'undefined') {
    onCleanup(() => {
      unsubMessageAppended();
      unsubMessageDelta();
      unsubPartUpdated();
      unsubRequestState();
      unsubSessionCreated();
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
