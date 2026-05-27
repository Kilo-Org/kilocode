// kilocode_change - new file

/**
 * KiloClaw chat panel
 *
 * Renders a scrollable message list, a slash-command autocomplete popup,
 * and a textarea for chatting with the KiloClaw bot via Kilo Chat.
 * Conversation title and context-window usage live in the sidebar (mirrors
 * the session route's layout).
 *
 * Visual style mirrors the session chat TUI (routes/session/index.tsx).
 */

import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { type BoxRenderable, type KeyBinding, type MouseEvent, type TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { SplitBorder, EmptyBorder } from "@tui/component/border"
import { useKV } from "@tui/context/kv"
import { Spinner } from "@tui/component/spinner"
import type { ChatMessage, TypingMember } from "./types"
import { ClawAutocomplete, type ClawAutocompleteRef, type ClawSlashOption } from "./autocomplete"

function UserMessageRow(props: { msg: ChatMessage; index: number }) {
  const { theme } = useTheme()
  return (
    <box
      border={["left"]}
      borderColor={theme.success}
      customBorderChars={SplitBorder.customBorderChars}
      marginTop={props.index === 0 ? 0 : 1}
      flexShrink={0}
    >
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} backgroundColor={theme.backgroundPanel}>
        <text fg={theme.text} wrapMode="word">
          {props.msg.text}
        </text>
      </box>
    </box>
  )
}

function BotMessageRow(props: { msg: ChatMessage; index: number }) {
  const { theme, syntax } = useTheme()
  const empty = () => !props.msg.text || !props.msg.text.trim()
  return (
    <box marginTop={props.index === 0 ? 0 : 1} flexShrink={0}>
      <box paddingLeft={3}>
        <Show when={!empty()} fallback={<text fg={theme.textMuted}>Thinking...</text>}>
          <code
            filetype="markdown"
            drawUnstyledText={false}
            streaming={true}
            syntaxStyle={syntax()}
            content={props.msg.text}
            fg={theme.text}
          />
        </Show>
      </box>
    </box>
  )
}

export function ClawChat(props: {
  messages: ChatMessage[]
  online: boolean
  connected: boolean
  loading: boolean
  error: string | null
  disabled: boolean
  typingMembers: TypingMember[]
  slashes: () => ClawSlashOption[]
  botName: string
  onSend: (text: string) => Promise<boolean>
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const kv = useKV()
  const [showScrollbar] = kv.signal("scrollbar_visible", true)
  let input: TextareaRenderable | undefined
  let inputAnchor: BoxRenderable | undefined
  let auto: ClawAutocompleteRef | undefined
  const [inputValue, setInputValue] = createSignal("")

  // Input is usable only when the instance is running, the WebSocket is
  // connected, and the bot is online. Sending while the bot is offline
  // would be silently dropped (no one to deliver to), so surface that as
  // a disabled input rather than a message that vanishes.
  const active = createMemo(() => !props.disabled && props.connected && props.online)

  // Render the typing banner with friendly names. Bot members come in as
  // `bot:kiloclaw:{sandboxId}` — the bot is the only non-self member in 1:1
  // chats, so we resolve bot ids to the user-configured `botName` (which
  // falls back to "KiloClaw" upstream) and render any human collaborators
  // by their raw memberId.
  const typingLabel = createMemo(() => {
    const list = props.typingMembers
    if (!list.length) return null
    const names = list.map((m) => (m.memberId.startsWith("bot:") ? props.botName : m.memberId))
    if (names.length === 1) return `${names[0]} is typing`
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing`
    return `${names[0]} and ${names.length - 1} others are typing`
  })

  const placeholder = createMemo(() => {
    if (props.error) return props.error
    if (props.loading) return "Connecting..."
    if (!props.connected) return "Chat unavailable"
    if (props.disabled) return "Instance is stopped"
    if (!props.online) return `${props.botName} is offline`
    return "Type a message... (/ for commands)"
  })

  const submit = async () => {
    if (!input) return
    if (auto?.visible) return // let autocomplete consume Enter
    const text = input.plainText.trim()
    if (!text) return
    if (!active()) return
    const ok = await props.onSend(text)
    if (ok) {
      input.clear()
      setInputValue("")
    }
  }

  // Repaint when external state arrives (events fire outside OpenTUI's
  // render cycle).
  createEffect(() => {
    props.messages.length
    props.online
    props.typingMembers.length
    renderer.requestRender()
  })

  // Drive the textarea's traits + focus from active() and autocomplete
  // visibility. We always render the textarea (even while loading or
  // disconnected) so the input area keeps a stable height; `traits.suspend`
  // disables interaction without changing layout. Mirrors DialogPrompt's
  // suspend-then-blur pattern so the cursor visibly leaves while inactive.
  createEffect(() => {
    if (!input || input.isDestroyed) return
    const suspend = !active()
    const status = props.loading ? "LOADING" : props.disabled ? "OFFLINE" : undefined
    input.traits = auto?.visible
      ? { capture: ["escape", "navigate", "submit", "tab"] as const, suspend, status }
      : { suspend, status }
    if (suspend) input.blur()
    else input.focus()
  })

  return (
    <box flexDirection="column" flexGrow={1} gap={1} paddingTop={1}>
      {/* Messages */}
      <scrollbox
        stickyScroll={true}
        stickyStart="bottom"
        flexGrow={1}
        viewportOptions={{
          paddingRight: showScrollbar() ? 1 : 0,
        }}
        verticalScrollbarOptions={{
          paddingLeft: 1,
          visible: showScrollbar(),
          trackOptions: {
            backgroundColor: theme.backgroundElement,
            foregroundColor: theme.border,
          },
        }}
      >
        <Show when={!props.loading && props.messages.length === 0 && props.connected}>
          <text fg={theme.textMuted} paddingLeft={2}>
            No messages yet. Say hello!
          </text>
        </Show>

        <Show when={!props.connected && !props.loading && !props.error}>
          <text fg={theme.textMuted} paddingLeft={2}>
            Chat not available. Your instance may need to be provisioned or upgraded.
          </text>
        </Show>

        <For each={props.messages}>
          {(msg, index) => (
            <Show when={msg.bot} fallback={<UserMessageRow msg={msg} index={index()} />}>
              <BotMessageRow msg={msg} index={index()} />
            </Show>
          )}
        </For>
      </scrollbox>

      {/* Typing indicator */}
      <Show when={typingLabel()}>
        <box flexShrink={0} paddingLeft={2}>
          <Spinner color={theme.textMuted}>{typingLabel()}</Spinner>
        </box>
      </Show>

      {/* Input area */}
      <box flexShrink={0} ref={(r: BoxRenderable) => (inputAnchor = r)}>
        <box
          border={["left"]}
          borderColor={active() ? theme.primary : theme.textMuted}
          customBorderChars={{
            ...EmptyBorder,
            vertical: "┃",
            bottomLeft: "╹",
          }}
        >
          <box
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            flexShrink={0}
            backgroundColor={theme.backgroundElement}
            flexGrow={1}
          >
            <textarea
              ref={(r: TextareaRenderable) => {
                input = r
              }}
              placeholder={placeholder()}
              placeholderColor={theme.textMuted}
              textColor={active() ? theme.text : theme.textMuted}
              focusedTextColor={active() ? theme.text : theme.textMuted}
              minHeight={2}
              maxHeight={4}
              cursorColor={active() ? theme.text : theme.backgroundElement}
              focusedBackgroundColor={theme.backgroundElement}
              onMouseDown={(e: MouseEvent) => {
                if (active()) e.target?.focus()
              }}
              onContentChange={() => {
                if (!input) return
                const value = input.plainText
                setInputValue(value)
                auto?.onInput(value)
              }}
              onCursorChange={() => auto?.onCursorChange()}
              onKeyDown={(e) => auto?.onKeyDown(e)}
              keyBindings={[
                { name: "return", action: "submit" } satisfies KeyBinding,
                { name: "return", shift: true, action: "newline" } satisfies KeyBinding,
              ]}
              onSubmit={submit}
            />
          </box>
        </box>
        <box
          height={1}
          border={["left"]}
          borderColor={active() ? theme.primary : theme.textMuted}
          customBorderChars={{
            ...EmptyBorder,
            vertical: theme.backgroundElement.a !== 0 ? "╹" : " ",
          }}
        >
          <box
            height={1}
            border={["bottom"]}
            borderColor={theme.backgroundElement}
            customBorderChars={
              theme.backgroundElement.a !== 0
                ? {
                    ...EmptyBorder,
                    horizontal: "▀",
                  }
                : {
                    ...EmptyBorder,
                    horizontal: " ",
                  }
            }
          />
        </box>
      </box>

      {/* Slash autocomplete popup, anchored to the textarea wrapper */}
      <ClawAutocomplete
        value={inputValue()}
        slashes={props.slashes}
        anchor={() => inputAnchor}
        input={() => input}
        ref={(r) => (auto = r)}
      />
    </box>
  )
}
