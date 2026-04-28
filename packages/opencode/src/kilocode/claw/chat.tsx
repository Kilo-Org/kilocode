// kilocode_change - new file

/**
 * KiloClaw chat panel
 *
 * Renders a scrollable message list and a textarea input for chatting
 * with the KiloClaw bot via Stream Chat.
 *
 * Visual style mirrors the session chat TUI (routes/session/index.tsx).
 */

import { createEffect, createMemo, For, Show } from "solid-js"
import { type KeyBinding, type MouseEvent, type TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { SplitBorder, EmptyBorder } from "@tui/component/border"
import { useKV } from "@tui/context/kv"
import type { ChatMessage } from "./types"

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
  onSend: (text: string) => Promise<boolean>
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const kv = useKV()
  const [showScrollbar] = kv.signal("scrollbar_visible", true)
  let input: TextareaRenderable

  const active = createMemo(() => !props.disabled && props.connected)

  const placeholder = createMemo(() => {
    if (props.error) return props.error
    if (props.loading) return "Connecting..."
    if (!props.connected) return "Chat unavailable"
    if (props.disabled) return "Instance is stopped"
    return ""
  })

  const submit = async () => {
    if (!input) return
    const text = input.plainText.trim()
    if (!text) return
    if (!active()) return
    const ok = await props.onSend(text)
    if (ok) input.clear()
  }

  createEffect(() => {
    if (active()) input?.focus()
  })

  // Stream Chat WebSocket events fire outside OpenTUI's render cycle.
  // Track props driven by external callbacks and explicitly request a repaint.
  createEffect(() => {
    props.messages.length
    props.online
    renderer.requestRender()
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

      {/* Input area */}
      <box flexShrink={0}>
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
            <Show when={active()} fallback={<text fg={theme.textMuted}>{placeholder()}</text>}>
              <textarea
                ref={(r: TextareaRenderable) => {
                  input = r
                }}
                placeholder="Type a message... (Enter to send)"
                textColor={theme.text}
                focusedTextColor={theme.text}
                minHeight={2}
                maxHeight={4}
                cursorColor={theme.text}
                focusedBackgroundColor={theme.backgroundElement}
                onMouseDown={(e: MouseEvent) => e.target?.focus()}
                keyBindings={[
                  { name: "return", action: "submit" } satisfies KeyBinding,
                  { name: "return", shift: true, action: "newline" } satisfies KeyBinding,
                ]}
                onSubmit={submit}
              />
            </Show>
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
    </box>
  )
}
