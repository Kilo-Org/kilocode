/**
 * ChatView - Main chat interface component
 *
 * A minimal chat view that uses the TransportProvider to communicate
 * with the extension host. This serves as the foundation for the chat UI
 * and will be enhanced with the full OpenCode UI components in later iterations.
 */

import {
  Component,
  For,
  Show,
  createSignal,
  createEffect,
  onMount,
} from "solid-js"
import { useTransport } from "../transport/TransportProvider"
import type { ChatMessage, MessagePart } from "../../../src/shared/chat-protocol"

// ============================================================================
// Message Part Renderers
// ============================================================================

const TextPart: Component<{ part: MessagePart & { type: "text" } }> = (props) => {
  return (
    <div class="message-text whitespace-pre-wrap">
      {props.part.text}
    </div>
  )
}

const ToolPart: Component<{ part: MessagePart & { type: "tool" } }> = (props) => {
  return (
    <div class="message-tool">
      <div class="tool-header">
        <span class="tool-name">{props.part.name}</span>
        <span class="tool-state" data-state={props.part.state}>
          {props.part.state}
        </span>
      </div>
    </div>
  )
}

const ReasoningPart: Component<{ part: MessagePart & { type: "reasoning" } }> = (props) => {
  const [expanded, setExpanded] = createSignal(false)

  return (
    <div class="message-reasoning">
      <button
        class="reasoning-toggle"
        onClick={() => setExpanded(!expanded())}
      >
        {expanded() ? "▼" : "▶"} Reasoning
      </button>
      <Show when={expanded()}>
        <div class="reasoning-content whitespace-pre-wrap">
          {props.part.text}
        </div>
      </Show>
    </div>
  )
}

// ============================================================================
// Message Component
// ============================================================================

const Message: Component<{ message: ChatMessage }> = (props) => {
  const roleClass = () => {
    switch (props.message.role) {
      case "user":
        return "message-user"
      case "assistant":
        return "message-assistant"
      default:
        return "message-system"
    }
  }

  return (
    <div class={`message ${roleClass()}`}>
      <div class="message-header">
        <span class="message-role">{props.message.role}</span>
        <span class="message-time">
          {new Date(props.message.time).toLocaleTimeString()}
        </span>
      </div>
      <div class="message-content">
        <For each={props.message.parts}>
          {(part) => (
            <Show
              when={part.type === "text"}
              fallback={
                <Show
                  when={part.type === "tool"}
                  fallback={
                    <Show when={part.type === "reasoning"}>
                      <ReasoningPart part={part as MessagePart & { type: "reasoning" }} />
                    </Show>
                  }
                >
                  <ToolPart part={part as MessagePart & { type: "tool" }} />
                </Show>
              }
            >
              <TextPart part={part as MessagePart & { type: "text" }} />
            </Show>
          )}
        </For>
      </div>
    </div>
  )
}

// ============================================================================
// Prompt Input Component
// ============================================================================

const PromptInput: Component<{
  onSubmit: (text: string) => void
  disabled?: boolean
  working?: boolean
  onAbort?: () => void
}> = (props) => {
  const [text, setText] = createSignal("")
  let inputRef: HTMLTextAreaElement | undefined

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    const value = text().trim()
    if (!value || props.disabled) return

    props.onSubmit(value)
    setText("")
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
    if (e.key === "Escape" && props.working) {
      props.onAbort?.()
    }
  }

  onMount(() => {
    inputRef?.focus()
  })

  return (
    <form class="prompt-form" onSubmit={handleSubmit}>
      <textarea
        ref={inputRef}
        class="prompt-input"
        placeholder="Type a message... (Shift+Enter for newline)"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        disabled={props.disabled}
        rows={3}
      />
      <div class="prompt-actions">
        <Show when={props.working}>
          <button
            type="button"
            class="prompt-abort"
            onClick={props.onAbort}
          >
            Stop
          </button>
        </Show>
        <button
          type="submit"
          class="prompt-submit"
          disabled={props.disabled || !text().trim()}
        >
          {props.working ? "Working..." : "Send"}
        </button>
      </div>
    </form>
  )
}

// ============================================================================
// Session Status Component
// ============================================================================

const SessionStatus: Component = () => {
  const transport = useTransport()

  return (
    <div class="session-status">
      <Show when={transport.currentSession()}>
        {(session) => (
          <span class="session-id">
            Session: {session().id.slice(0, 8)}...
          </span>
        )}
      </Show>
      <Show when={transport.sessionStatus().type !== "idle"}>
        <span class="status-indicator" data-status={transport.sessionStatus().type}>
          {transport.sessionStatus().type}
        </span>
      </Show>
      <Show when={transport.error()}>
        <span class="error-indicator">
          Error: {transport.error()}
        </span>
      </Show>
    </div>
  )
}

// ============================================================================
// Main ChatView Component
// ============================================================================

export const ChatView: Component = () => {
  const transport = useTransport()
  let messagesEndRef: HTMLDivElement | undefined

  // Auto-scroll to bottom when new messages arrive
  createEffect(() => {
    // Track messages length to trigger scroll
    const _ = transport.messages.length
    messagesEndRef?.scrollIntoView({ behavior: "smooth" })
  })

  // Load session on mount
  onMount(async () => {
    console.log("[Kilo New] ChatView: Mounting, loading session...")
    await transport.loadSession()
  })

  const handleSendMessage = (text: string) => {
    console.log("[Kilo New] ChatView: Sending message:", text.slice(0, 50))
    transport.sendPrompt(text)
  }

  const handleAbort = () => {
    console.log("[Kilo New] ChatView: Aborting...")
    transport.abort()
  }

  const isWorking = () => {
    const status = transport.sessionStatus()
    return status.type === "busy" || transport.activeRequestId() !== null
  }

  return (
    <div class="chat-view">
      <SessionStatus />

      <div class="messages-container">
        <Show
          when={!transport.isLoading()}
          fallback={
            <div class="loading-indicator">
              Loading session...
            </div>
          }
        >
          <Show
            when={transport.messages.length > 0}
            fallback={
              <div class="empty-state">
                <p>No messages yet. Start a conversation!</p>
              </div>
            }
          >
            <For each={transport.messages}>
              {(message) => <Message message={message} />}
            </For>
          </Show>
          <div ref={messagesEndRef} />
        </Show>
      </div>

      <Show when={transport.pendingPermissions.length > 0}>
        <div class="permissions-panel">
          <For each={transport.pendingPermissions}>
            {(perm) => (
              <div class="permission-request">
                <div class="permission-info">
                  <strong>{perm.permission}</strong>
                  <Show when={perm.patterns.length > 0}>
                    <ul class="permission-patterns">
                      <For each={perm.patterns}>
                        {(pattern) => <li>{pattern}</li>}
                      </For>
                    </ul>
                  </Show>
                </div>
                <div class="permission-actions">
                  <button
                    class="permission-reject"
                    onClick={() => transport.replyToPermission(perm.id, "reject")}
                  >
                    Deny
                  </button>
                  <button
                    class="permission-always"
                    onClick={() => transport.replyToPermission(perm.id, "always")}
                  >
                    Always Allow
                  </button>
                  <button
                    class="permission-once"
                    onClick={() => transport.replyToPermission(perm.id, "once")}
                  >
                    Allow Once
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <PromptInput
        onSubmit={handleSendMessage}
        disabled={transport.isLoading()}
        working={isWorking()}
        onAbort={handleAbort}
      />
    </div>
  )
}

export default ChatView
