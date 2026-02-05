/**
 * ChatView - Main chat interface component
 * 
 * This is a simplified chat view that works in VS Code webviews.
 * It uses the transport layer to communicate with the extension host
 * instead of direct SDK calls.
 */

import {
  Component,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  For,
  Show,
  Switch,
  Match,
  createMemo,
} from 'solid-js';
import { getChatStore, type ChatStore } from './lib/chat-store';
import type { ChatMessage, MessagePart } from '../../src/shared/protocol';

// Import chat view styles (we don't import opencode-app/index.css as it depends on external packages)
import './chat-view.css';

interface MessageBubbleProps {
  message: ChatMessage;
  parts: MessagePart[];
}

const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const textContent = createMemo(() => {
    return props.parts
      .filter(p => p.type === 'text')
      .map(p => p.content || '')
      .join('');
  });

  const toolParts = createMemo(() => {
    return props.parts.filter(p => p.type === 'tool-invocation' || p.type === 'tool-result');
  });

  return (
    <div
      class="message-bubble"
      classList={{
        'message-user': props.message.role === 'user',
        'message-assistant': props.message.role === 'assistant',
      }}
    >
      <div class="message-role">
        {props.message.role === 'user' ? 'You' : 'Assistant'}
        <Show when={props.message.agent}>
          <span class="message-agent"> ({props.message.agent})</span>
        </Show>
      </div>
      
      <div class="message-content">
        <Show when={textContent()}>
          <div class="message-text">{textContent()}</div>
        </Show>
        
        <Show when={toolParts().length > 0}>
          <div class="message-tools">
            <For each={toolParts()}>
              {(part) => (
                <div class="tool-part">
                  <Show when={part.tool?.name}>
                    <span class="tool-name">{part.tool?.name}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

interface PromptInputProps {
  onSubmit: (text: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

const PromptInput: Component<PromptInputProps> = (props) => {
  const [text, setText] = createSignal('');
  let inputRef: HTMLTextAreaElement | undefined;

  const handleSubmit = () => {
    const value = text().trim();
    if (!value || props.isStreaming) return;
    props.onSubmit(value);
    setText('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Auto-resize textarea
  createEffect(() => {
    const el = inputRef;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  });

  return (
    <div class="prompt-input-container">
      <textarea
        ref={inputRef}
        class="prompt-input"
        placeholder="Type your message..."
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        disabled={props.disabled}
        rows={1}
      />
      
      <div class="prompt-actions">
        <Show
          when={props.isStreaming}
          fallback={
            <button
              class="prompt-submit"
              onClick={handleSubmit}
              disabled={!text().trim() || props.disabled}
            >
              Send
            </button>
          }
        >
          <button class="prompt-abort" onClick={props.onAbort}>
            Stop
          </button>
        </Show>
      </div>
    </div>
  );
};

export const ChatView: Component = () => {
  const store = getChatStore();
  const [initialized, setInitialized] = createSignal(false);
  let messagesEndRef: HTMLDivElement | undefined;

  // Initialize on mount
  onMount(async () => {
    await store.init();
    setInitialized(true);
    
    // Create a new session if none exists
    if (!store.state.currentSessionId) {
      await store.createSession();
    }
  });

  // Auto-scroll to bottom when new messages arrive
  createEffect(() => {
    const messages = store.currentMessages();
    if (messages.length > 0 && messagesEndRef) {
      messagesEndRef.scrollIntoView({ behavior: 'smooth' });
    }
  });

  const handleSubmit = (text: string) => {
    store.sendPrompt({ text });
  };

  const handleAbort = () => {
    store.abort();
  };

  const getPartsForMessage = (messageId: string): MessagePart[] => {
    return store.state.parts[messageId] ?? [];
  };

  return (
    <div class="chat-view">
      <Switch>
        <Match when={store.state.status === 'loading' && !initialized()}>
          <div class="chat-loading">
            <div class="loading-spinner" />
            <div>Initializing chat...</div>
          </div>
        </Match>
        
        <Match when={store.state.status === 'error'}>
          <div class="chat-error">
            <div class="error-icon">⚠️</div>
            <div class="error-message">{store.state.error || 'An error occurred'}</div>
          </div>
        </Match>
        
        <Match when={initialized()}>
          <div class="chat-container">
            {/* Session header */}
            <div class="chat-header">
              <Show when={store.currentSession()}>
                <div class="session-title">
                  {store.currentSession()?.title || 'New Chat'}
                </div>
              </Show>
            </div>
            
            {/* Messages area */}
            <div class="chat-messages">
              <Show
                when={store.currentMessages().length > 0}
                fallback={
                  <div class="chat-empty">
                    <div class="empty-icon">💬</div>
                    <div class="empty-text">Start a conversation</div>
                  </div>
                }
              >
                <For each={store.currentMessages()}>
                  {(message) => (
                    <MessageBubble
                      message={message}
                      parts={getPartsForMessage(message.id)}
                    />
                  )}
                </For>
              </Show>
              
              {/* Streaming indicator */}
              <Show when={store.isStreaming()}>
                <div class="streaming-indicator">
                  <div class="typing-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </Show>
              
              <div ref={messagesEndRef} />
            </div>
            
            {/* Prompt input */}
            <div class="chat-input-area">
              <PromptInput
                onSubmit={handleSubmit}
                onAbort={handleAbort}
                isStreaming={store.isStreaming()}
                disabled={store.state.status !== 'ready'}
              />
            </div>
          </div>
        </Match>
      </Switch>
    </div>
  );
};

export default ChatView;
