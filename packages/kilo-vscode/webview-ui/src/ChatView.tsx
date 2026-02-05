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
  JSX,
} from 'solid-js';
import { getChatStore, type ChatStore } from './lib/chat-store';
import type { ChatMessage, MessagePart } from '../../src/shared/protocol';

// Import chat view styles
import './chat-view.css';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a timestamp to a human-readable time string
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Simple markdown parser for basic formatting
 * Handles: bold, italic, inline code, code blocks, headers, lists
 */
function parseMarkdown(text: string): JSX.Element {
  // Split by code blocks first
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  const parts: JSX.Element[] = [];
  let lastIndex = 0;
  let match;
  let keyIndex = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      parts.push(
        <span key={keyIndex++}>
          {parseInlineMarkdown(text.slice(lastIndex, match.index))}
        </span>
      );
    }

    // Add code block
    const language = match[1] || 'text';
    const code = match[2].trim();
    parts.push(<CodeBlock key={keyIndex++} language={language} code={code} />);

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(
      <span key={keyIndex++}>
        {parseInlineMarkdown(text.slice(lastIndex))}
      </span>
    );
  }

  return <>{parts}</>;
}

/**
 * Parse inline markdown (bold, italic, inline code, headers, lists)
 */
function parseInlineMarkdown(text: string): JSX.Element {
  // Split into lines for block-level elements
  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  let inList = false;
  let listItems: JSX.Element[] = [];
  let keyIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headers
    const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      if (inList) {
        elements.push(<ul key={keyIndex++}>{listItems}</ul>);
        listItems = [];
        inList = false;
      }
      const level = headerMatch[1].length;
      const content = parseInlineFormatting(headerMatch[2]);
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      elements.push(<Tag key={keyIndex++}>{content}</Tag>);
      continue;
    }

    // List items
    const listMatch = line.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      inList = true;
      listItems.push(<li key={keyIndex++}>{parseInlineFormatting(listMatch[1])}</li>);
      continue;
    }

    // Numbered list items
    const numberedListMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numberedListMatch) {
      if (inList && listItems.length > 0) {
        elements.push(<ul key={keyIndex++}>{listItems}</ul>);
        listItems = [];
      }
      inList = true;
      listItems.push(<li key={keyIndex++}>{parseInlineFormatting(numberedListMatch[1])}</li>);
      continue;
    }

    // End list if we hit a non-list line
    if (inList && line.trim() !== '') {
      elements.push(<ul key={keyIndex++}>{listItems}</ul>);
      listItems = [];
      inList = false;
    }

    // Regular paragraph
    if (line.trim()) {
      elements.push(<p key={keyIndex++}>{parseInlineFormatting(line)}</p>);
    } else if (i < lines.length - 1) {
      // Empty line (paragraph break) - only add if not at end
      elements.push(<br key={keyIndex++} />);
    }
  }

  // Close any remaining list
  if (inList && listItems.length > 0) {
    elements.push(<ul key={keyIndex++}>{listItems}</ul>);
  }

  return <>{elements}</>;
}

/**
 * Parse inline formatting (bold, italic, inline code)
 */
function parseInlineFormatting(text: string): JSX.Element {
  // Process inline code first (to avoid conflicts with other formatting)
  const parts: (string | JSX.Element)[] = [];
  const inlineCodeRegex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match;
  let keyIndex = 0;

  while ((match = inlineCodeRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<code key={keyIndex++}>{match[1]}</code>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // Now process bold and italic on the string parts
  const processedParts = parts.map((part, idx) => {
    if (typeof part !== 'string') return part;

    // Bold: **text** or __text__
    let processed: string | JSX.Element = part;
    const boldRegex = /\*\*([^*]+)\*\*|__([^_]+)__/g;
    const boldParts: (string | JSX.Element)[] = [];
    let boldLastIndex = 0;
    let boldMatch;
    let boldKeyIndex = 0;

    while ((boldMatch = boldRegex.exec(part)) !== null) {
      if (boldMatch.index > boldLastIndex) {
        boldParts.push(part.slice(boldLastIndex, boldMatch.index));
      }
      boldParts.push(<strong key={`bold-${idx}-${boldKeyIndex++}`}>{boldMatch[1] || boldMatch[2]}</strong>);
      boldLastIndex = boldMatch.index + boldMatch[0].length;
    }

    if (boldParts.length > 0) {
      if (boldLastIndex < part.length) {
        boldParts.push(part.slice(boldLastIndex));
      }
      return <span key={`span-${idx}`}>{boldParts}</span>;
    }

    // Italic: *text* or _text_ (but not inside words)
    const italicRegex = /(?<!\w)\*([^*]+)\*(?!\w)|(?<!\w)_([^_]+)_(?!\w)/g;
    const italicParts: (string | JSX.Element)[] = [];
    let italicLastIndex = 0;
    let italicMatch;
    let italicKeyIndex = 0;

    while ((italicMatch = italicRegex.exec(part)) !== null) {
      if (italicMatch.index > italicLastIndex) {
        italicParts.push(part.slice(italicLastIndex, italicMatch.index));
      }
      italicParts.push(<em key={`italic-${idx}-${italicKeyIndex++}`}>{italicMatch[1] || italicMatch[2]}</em>);
      italicLastIndex = italicMatch.index + italicMatch[0].length;
    }

    if (italicParts.length > 0) {
      if (italicLastIndex < part.length) {
        italicParts.push(part.slice(italicLastIndex));
      }
      return <span key={`span-${idx}`}>{italicParts}</span>;
    }

    return part;
  });

  return <>{processedParts}</>;
}

// ============================================================================
// Code Block Component
// ============================================================================

interface CodeBlockProps {
  language: string;
  code: string;
}

const CodeBlock: Component<CodeBlockProps> = (props) => {
  const [copied, setCopied] = createSignal(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <div class="code-block">
      <div class="code-block-header">
        <span class="code-block-language">{props.language}</span>
        <button class="code-block-copy" onClick={handleCopy} title="Copy code">
          {copied() ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{props.code}</code>
      </pre>
    </div>
  );
};

// ============================================================================
// Tool Card Component
// ============================================================================

interface ToolCardProps {
  part: MessagePart;
}

const ToolCard: Component<ToolCardProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  const status = createMemo(() => {
    if (props.part.type === 'tool-result') {
      return 'success';
    }
    if (props.part.time?.end) {
      return 'success';
    }
    return 'pending';
  });

  const statusIcon = createMemo(() => {
    switch (status()) {
      case 'success':
        return '✓';
      case 'error':
        return '✗';
      default:
        return '⋯';
    }
  });

  const formatJson = (value: unknown): string => {
    if (value === undefined || value === null) return '';
    try {
      return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  return (
    <div class="tool-card" classList={{ expanded: expanded() }}>
      <div class="tool-card-header" onClick={() => setExpanded(!expanded())}>
        <span class={`tool-card-icon ${status()}`}>{statusIcon()}</span>
        <span class="tool-card-name">{props.part.tool?.name || 'Unknown Tool'}</span>
        <span class="tool-card-chevron">▶</span>
      </div>
      <div class="tool-card-content">
        <Show when={props.part.tool?.input}>
          <div class="tool-card-section">
            <div class="tool-card-section-label">Arguments</div>
            <div class="tool-card-section-content">
              {formatJson(props.part.tool?.input)}
            </div>
          </div>
        </Show>
        <Show when={props.part.tool?.output}>
          <div class="tool-card-section">
            <div class="tool-card-section-label">Result</div>
            <div class="tool-card-section-content">
              {formatJson(props.part.tool?.output)}
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
};

// ============================================================================
// Message Bubble Component
// ============================================================================

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

  const timestamp = createMemo(() => {
    return props.message.time?.created ? formatTime(props.message.time.created) : null;
  });

  return (
    <div
      class="message-bubble"
      classList={{
        'message-user': props.message.role === 'user',
        'message-assistant': props.message.role === 'assistant',
      }}
    >
      <div class="message-header">
        <span class="message-role">
          {props.message.role === 'user' ? 'You' : 'Assistant'}
        </span>
        <Show when={props.message.agent}>
          <span class="message-agent">({props.message.agent})</span>
        </Show>
        <Show when={timestamp()}>
          <span class="message-time">{timestamp()}</span>
        </Show>
      </div>
      
      <div class="message-content">
        <Show when={textContent()}>
          <div class="message-text">
            {parseMarkdown(textContent())}
          </div>
        </Show>
        
        <Show when={toolParts().length > 0}>
          <div class="message-tools">
            <For each={toolParts()}>
              {(part) => <ToolCard part={part} />}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

// ============================================================================
// Prompt Input Component
// ============================================================================

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
    // Reset height after submit
    if (inputRef) {
      inputRef.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Cmd/Ctrl+Enter to send
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    
    // Enter without shift to send (default behavior)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    
    // Shift+Enter for newline is handled by default textarea behavior
  };

  // Auto-resize textarea
  createEffect(() => {
    // Track text changes
    text();
    const el = inputRef;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  });

  // Focus input on mount
  onMount(() => {
    inputRef?.focus();
  });

  return (
    <div class="prompt-input-wrapper">
      <div
        class="prompt-input-container"
        classList={{ streaming: props.isStreaming }}
      >
        <textarea
          ref={inputRef}
          class="prompt-input"
          placeholder={props.isStreaming ? 'Waiting for response...' : 'Type your message...'}
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={props.disabled || props.isStreaming}
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
                title="Send message (Enter or Cmd+Enter)"
              >
                Send
              </button>
            }
          >
            <button
              class="prompt-abort"
              onClick={props.onAbort}
              title="Stop generation"
            >
              Stop
            </button>
          </Show>
        </div>
      </div>
      <div class="prompt-hint">
        <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for new line
      </div>
    </div>
  );
};

// ============================================================================
// Empty State Component
// ============================================================================

const EmptyState: Component = () => {
  return (
    <div class="chat-empty">
      <div class="empty-icon">💬</div>
      <h2 class="empty-title">Start a conversation</h2>
      <p class="empty-subtitle">
        Ask questions, get help with code, or explore ideas with your AI assistant.
      </p>
      <div class="empty-hints">
        <div class="empty-hint">
          <kbd>Enter</kbd> to send your message
        </div>
        <div class="empty-hint">
          <kbd>Shift+Enter</kbd> for a new line
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Main Chat View Component
// ============================================================================

export const ChatView: Component = () => {
  const store = getChatStore();
  const [initialized, setInitialized] = createSignal(false);
  const [showJumpToBottom, setShowJumpToBottom] = createSignal(false);
  const [isUserScrolling, setIsUserScrolling] = createSignal(false);
  
  let messagesContainerRef: HTMLDivElement | undefined;
  let messagesEndRef: HTMLDivElement | undefined;
  let scrollTimeout: ReturnType<typeof setTimeout> | undefined;

  // Initialize on mount
  onMount(async () => {
    await store.init();
    setInitialized(true);
    
    // Create a new session if none exists
    if (!store.state.currentSessionId) {
      await store.createSession();
    }
  });

  // Smart auto-scroll behavior
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef?.scrollIntoView({ behavior });
  };

  const checkScrollPosition = () => {
    if (!messagesContainerRef) return;
    
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    // Show jump button if scrolled up more than 100px
    setShowJumpToBottom(distanceFromBottom > 100);
    
    // Consider user at bottom if within 50px
    return distanceFromBottom < 50;
  };

  const handleScroll = () => {
    // Clear any existing timeout
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
    
    // Mark as user scrolling
    setIsUserScrolling(true);
    
    // Check position
    checkScrollPosition();
    
    // Reset user scrolling flag after a delay
    scrollTimeout = setTimeout(() => {
      setIsUserScrolling(false);
    }, 150);
  };

  // Auto-scroll when new messages arrive (only if user is at bottom)
  createEffect(() => {
    const messages = store.currentMessages();
    const streaming = store.isStreaming();
    
    if (messages.length > 0 && messagesEndRef) {
      // Auto-scroll if streaming and user hasn't scrolled up
      if (streaming && !isUserScrolling()) {
        const isAtBottom = checkScrollPosition();
        if (isAtBottom || !showJumpToBottom()) {
          scrollToBottom('auto');
        }
      } else if (!streaming && !isUserScrolling()) {
        // Scroll to bottom when streaming finishes
        scrollToBottom('smooth');
      }
    }
  });

  // Cleanup
  onCleanup(() => {
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
  });

  const handleSubmit = (text: string) => {
    store.sendPrompt({ text });
    // Scroll to bottom when user sends a message
    setTimeout(() => scrollToBottom('smooth'), 50);
  };

  const handleAbort = () => {
    store.abort();
  };

  const handleJumpToBottom = () => {
    scrollToBottom('smooth');
    setShowJumpToBottom(false);
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
            <div
              ref={messagesContainerRef}
              class="chat-messages"
              onScroll={handleScroll}
            >
              <Show
                when={store.currentMessages().length > 0}
                fallback={<EmptyState />}
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
            
            {/* Jump to bottom button */}
            <Show when={showJumpToBottom()}>
              <button class="jump-to-bottom" onClick={handleJumpToBottom}>
                <span class="jump-to-bottom-icon">↓</span>
                Jump to bottom
              </button>
            </Show>
            
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
