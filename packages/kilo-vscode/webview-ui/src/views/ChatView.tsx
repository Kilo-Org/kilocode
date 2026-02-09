/**
 * ChatView - Main chat interface component
 *
 * Uses @opencode-ai/ui components for a polished UI that matches
 * the OpenCode design system.
 */

import {
  Component,
  For,
  Show,
  createSignal,
  createEffect,
  onMount,
  Switch,
  Match,
  createMemo,
} from "solid-js"
import { useTransport } from "../transport/TransportProvider"
import type { ChatMessage, MessagePart } from "../../../src/shared/chat-protocol"

// Import UI components from @opencode-ai/ui
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { BasicTool } from "@opencode-ai/ui/basic-tool"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Card } from "@opencode-ai/ui/card"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { Mark } from "@opencode-ai/ui/logo"

// ============================================================================
// Message Part Renderers
// ============================================================================

const TextPart: Component<{ part: MessagePart & { type: "text" } }> = (props) => {
  return (
    <div class="whitespace-pre-wrap text-sm leading-relaxed">
      {props.part.text}
    </div>
  )
}

const ToolPart: Component<{ part: MessagePart & { type: "tool" } }> = (props) => {
  const getToolIcon = (name: string): "code" | "folder" | "console" | "edit-small-2" | "magnifying-glass" | "window-cursor" => {
    const toolIcons: Record<string, "code" | "folder" | "console" | "edit-small-2" | "magnifying-glass" | "window-cursor"> = {
      read: "code",
      write: "edit-small-2",
      edit: "edit-small-2",
      bash: "console",
      list: "folder",
      grep: "magnifying-glass",
      glob: "magnifying-glass",
      webfetch: "window-cursor",
    }
    return toolIcons[name] || "code"
  }

  const getStateColor = () => {
    switch (props.part.state) {
      case "completed":
        return "text-green-500"
      case "error":
        return "text-red-500"
      case "running":
        return "text-blue-500"
      default:
        return "text-yellow-500"
    }
  }

  return (
    <BasicTool
      icon={getToolIcon(props.part.name)}
      trigger={{
        title: props.part.name,
        titleClass: "font-mono text-xs",
        subtitle: props.part.state,
        subtitleClass: getStateColor(),
      }}
      defaultOpen={false}
    >
      <Show when={props.part.input}>
        <div class="p-3 bg-[--color-background-02] rounded text-xs font-mono overflow-x-auto">
          <pre class="whitespace-pre-wrap">{JSON.stringify(props.part.input, null, 2)}</pre>
        </div>
      </Show>
      <Show when={props.part.output}>
        <div class="mt-2 p-3 bg-[--color-background-02] rounded text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto">
          <pre class="whitespace-pre-wrap">{props.part.output}</pre>
        </div>
      </Show>
    </BasicTool>
  )
}

const ReasoningPart: Component<{ part: MessagePart & { type: "reasoning" } }> = (props) => {
  return (
    <Collapsible>
      <Collapsible.Trigger>
        <div class="flex items-center gap-2 text-xs text-[--color-text-dimmed] cursor-pointer hover:text-[--color-text-secondary]">
          <Icon name="brain" size="small" />
          <span>Thinking...</span>
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div class="mt-2 pl-6 text-xs text-[--color-text-dimmed] italic whitespace-pre-wrap border-l-2 border-[--color-border]">
          {props.part.text}
        </div>
      </Collapsible.Content>
    </Collapsible>
  )
}

// ============================================================================
// Message Component
// ============================================================================

const Message: Component<{ message: ChatMessage; isLast?: boolean }> = (props) => {
  const isUser = () => props.message.role === "user"
  const isAssistant = () => props.message.role === "assistant"

  return (
    <div
      class="group relative"
      classList={{
        "flex justify-end": isUser(),
      }}
    >
      <div
        class="max-w-[85%] rounded-lg p-4"
        classList={{
          "bg-[--color-background-03] ml-auto": isUser(),
          "bg-transparent": isAssistant(),
        }}
      >
        {/* Message header */}
        <div class="flex items-center gap-2 mb-2">
          <Show when={isAssistant()}>
            <div class="w-5 h-5 rounded-full bg-[--color-accent] flex items-center justify-center">
              <Mark class="w-3 h-3 text-white" />
            </div>
          </Show>
          <span class="text-xs font-medium text-[--color-text-secondary] capitalize">
            {props.message.role}
          </span>
          <span class="text-xs text-[--color-text-dimmed]">
            {new Date(props.message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Message content */}
        <div class="space-y-3">
          <For each={props.message.parts}>
            {(part) => (
              <Switch>
                <Match when={part.type === "text"}>
                  <TextPart part={part as MessagePart & { type: "text" }} />
                </Match>
                <Match when={part.type === "tool"}>
                  <ToolPart part={part as MessagePart & { type: "tool" }} />
                </Match>
                <Match when={part.type === "reasoning"}>
                  <ReasoningPart part={part as MessagePart & { type: "reasoning" }} />
                </Match>
              </Switch>
            )}
          </For>
        </div>
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
  const [rows, setRows] = createSignal(1)
  let inputRef: HTMLTextAreaElement | undefined

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    const value = text().trim()
    if (!value || props.disabled) return

    props.onSubmit(value)
    setText("")
    setRows(1)
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

  const handleInput = (e: Event) => {
    const target = e.currentTarget as HTMLTextAreaElement
    setText(target.value)
    
    // Auto-resize
    const lineCount = (target.value.match(/\n/g) || []).length + 1
    setRows(Math.min(Math.max(lineCount, 1), 8))
  }

  onMount(() => {
    inputRef?.focus()
  })

  return (
    <form class="relative" onSubmit={handleSubmit}>
      <div class="relative bg-[--color-background-02] rounded-xl border border-[--color-border] focus-within:border-[--color-accent] transition-colors">
        <textarea
          ref={inputRef}
          class="w-full bg-transparent text-sm text-[--color-text-primary] placeholder:text-[--color-text-dimmed] resize-none outline-none p-4 pr-24"
          placeholder="Ask anything... (Shift+Enter for newline)"
          value={text()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          disabled={props.disabled}
          rows={rows()}
        />
        
        <div class="absolute right-2 bottom-2 flex items-center gap-1">
          <Show when={props.working}>
            <Tooltip content="Stop generation (Esc)">
              <IconButton
                icon="stop"
                size="small"
                variant="ghost"
                onClick={props.onAbort}
              />
            </Tooltip>
          </Show>
          
          <Tooltip content={props.working ? "Working..." : "Send message (Enter)"}>
            <IconButton
              icon={props.working ? "spinner" : "arrow-right"}
              size="small"
              variant="primary"
              disabled={props.disabled || !text().trim()}
              onClick={handleSubmit}
            />
          </Tooltip>
        </div>
      </div>
      
      <div class="flex items-center justify-between mt-2 px-1">
        <div class="flex items-center gap-2">
          <span class="text-xs text-[--color-text-dimmed]">
            <kbd class="px-1.5 py-0.5 bg-[--color-background-03] rounded text-[10px]">Enter</kbd> to send
          </span>
          <span class="text-xs text-[--color-text-dimmed]">
            <kbd class="px-1.5 py-0.5 bg-[--color-background-03] rounded text-[10px]">Shift+Enter</kbd> for newline
          </span>
        </div>
        <Show when={props.working}>
          <div class="flex items-center gap-2 text-xs text-[--color-text-dimmed]">
            <Spinner size="small" />
            <span>Generating...</span>
          </div>
        </Show>
      </div>
    </form>
  )
}

// ============================================================================
// Session Header Component
// ============================================================================

const SessionHeader: Component = () => {
  const transport = useTransport()

  return (
    <div class="flex items-center justify-between px-4 py-3 border-b border-[--color-border] bg-[--color-background-01]">
      <div class="flex items-center gap-3">
        <Mark class="w-6 h-6 text-[--color-accent]" />
        <div>
          <h1 class="text-sm font-semibold text-[--color-text-primary]">Kilo Code</h1>
          <Show when={transport.currentSession()}>
            {(session) => (
              <span class="text-xs text-[--color-text-dimmed]">
                Session: {session().id.slice(0, 8)}
              </span>
            )}
          </Show>
        </div>
      </div>
      
      <div class="flex items-center gap-2">
        <Show when={transport.sessionStatus().type !== "idle"}>
          <div class="flex items-center gap-2 px-2 py-1 rounded-full bg-[--color-background-03]">
            <div
              class="w-2 h-2 rounded-full animate-pulse"
              classList={{
                "bg-yellow-500": transport.sessionStatus().type === "busy",
                "bg-green-500": transport.sessionStatus().type === "idle",
              }}
            />
            <span class="text-xs text-[--color-text-secondary] capitalize">
              {transport.sessionStatus().type}
            </span>
          </div>
        </Show>
        
        <Tooltip content="New session">
          <IconButton
            icon="plus"
            size="small"
            variant="ghost"
            onClick={() => transport.createSession()}
          />
        </Tooltip>
      </div>
    </div>
  )
}

// ============================================================================
// Permission Request Component
// ============================================================================

const PermissionPanel: Component = () => {
  const transport = useTransport()

  return (
    <Show when={transport.pendingPermissions.length > 0}>
      <div class="border-t border-[--color-border] bg-[--color-background-02] p-4">
        <div class="flex items-center gap-2 mb-3">
          <Icon name="circle-ban-sign" size="small" class="text-yellow-500" />
          <span class="text-sm font-medium text-[--color-text-primary]">
            Permission Required
          </span>
        </div>
        
        <For each={transport.pendingPermissions}>
          {(perm) => (
            <Card class="mb-3 last:mb-0">
              <div class="p-3">
                <div class="font-medium text-sm text-[--color-text-primary] mb-2">
                  {perm.permission}
                </div>
                <Show when={perm.patterns.length > 0}>
                  <div class="mb-3">
                    <For each={perm.patterns}>
                      {(pattern) => (
                        <div class="text-xs font-mono text-[--color-text-dimmed] bg-[--color-background-03] px-2 py-1 rounded mb-1">
                          {pattern}
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                
                <div class="flex items-center gap-2 justify-end">
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => transport.replyToPermission(perm.id, "reject")}
                  >
                    Deny
                  </Button>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => transport.replyToPermission(perm.id, "always")}
                  >
                    Always Allow
                  </Button>
                  <Button
                    size="small"
                    variant="primary"
                    onClick={() => transport.replyToPermission(perm.id, "once")}
                  >
                    Allow Once
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </For>
      </div>
    </Show>
  )
}

// ============================================================================
// Empty State Component
// ============================================================================

const EmptyState: Component = () => {
  return (
    <div class="flex flex-col items-center justify-center h-full text-center px-8">
      <Mark class="w-16 h-16 text-[--color-accent] mb-6 opacity-50" />
      <h2 class="text-lg font-semibold text-[--color-text-primary] mb-2">
        Start a conversation
      </h2>
      <p class="text-sm text-[--color-text-dimmed] max-w-md">
        Ask me anything about your code. I can help you write, debug, refactor, 
        and understand your codebase.
      </p>
      <div class="mt-6 flex flex-wrap gap-2 justify-center">
        <Button size="small" variant="secondary" icon="code">
          Explain code
        </Button>
        <Button size="small" variant="secondary" icon="edit-small-2">
          Write code
        </Button>
        <Button size="small" variant="secondary" icon="magnifying-glass">
          Find bugs
        </Button>
      </div>
    </div>
  )
}

// ============================================================================
// Error Display Component
// ============================================================================

const ErrorDisplay: Component<{ error: string }> = (props) => {
  return (
    <div class="mx-4 mb-4 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
      <div class="flex items-start gap-3">
        <Icon name="circle-x" size="small" class="text-red-500 mt-0.5" />
        <div>
          <div class="text-sm font-medium text-red-500 mb-1">Error</div>
          <div class="text-sm text-[--color-text-secondary]">{props.error}</div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main ChatView Component
// ============================================================================

export const ChatView: Component = () => {
  const transport = useTransport()
  let messagesContainerRef: HTMLDivElement | undefined

  // Auto-scroll setup
  const { scrollRef, scrollToBottom } = createAutoScroll()

  // Auto-scroll when messages change
  createEffect(() => {
    const _ = transport.messages.length
    scrollToBottom()
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
    <div class="flex flex-col h-screen bg-[--color-background-01] text-[--color-text-primary]">
      <SessionHeader />

      {/* Messages area */}
      <div
        ref={(el) => {
          messagesContainerRef = el
          scrollRef(el)
        }}
        class="flex-1 overflow-y-auto"
      >
        <Show
          when={!transport.isLoading()}
          fallback={
            <div class="flex items-center justify-center h-full">
              <div class="flex flex-col items-center gap-3">
                <Spinner size="large" />
                <span class="text-sm text-[--color-text-dimmed]">Loading session...</span>
              </div>
            </div>
          }
        >
          <Show
            when={transport.messages.length > 0}
            fallback={<EmptyState />}
          >
            <div class="max-w-3xl mx-auto py-6 px-4 space-y-6">
              <For each={transport.messages}>
                {(message, index) => (
                  <Message
                    message={message}
                    isLast={index() === transport.messages.length - 1}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      {/* Error display */}
      <Show when={transport.error()}>
        <ErrorDisplay error={transport.error()!} />
      </Show>

      {/* Permission panel */}
      <PermissionPanel />

      {/* Input area */}
      <div class="border-t border-[--color-border] bg-[--color-background-01] p-4">
        <div class="max-w-3xl mx-auto">
          <PromptInput
            onSubmit={handleSendMessage}
            disabled={false}
            working={isWorking()}
            onAbort={handleAbort}
          />
        </div>
      </div>
    </div>
  )
}

export default ChatView
