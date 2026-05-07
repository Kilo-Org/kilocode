// kilocode_change - new file

/**
 * KiloClaw status sidebar
 *
 * Mirrors the session sidebar (routes/session/sidebar.tsx): bold
 * conversation title at the top, then context-window usage, then
 * instance/bot/details sections.
 */

import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import type { ClawStatus, ConversationListItem, ConversationStatusRecord } from "./types"

function dot(status: string | null | undefined, theme: any): string {
  if (!status) return theme.textMuted
  if (status === "running") return theme.success
  if (status === "starting" || status === "restarting") return theme.warning
  if (status === "destroying") return theme.error
  return theme.textMuted
}

function uptime(started: string | null | undefined): string {
  if (!started) return "—"
  const ms = Date.now() - new Date(started).getTime()
  if (ms < 0) return "—"
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function ClawSidebar(props: {
  status: ClawStatus | null
  loading: boolean
  error: string | null
  online: boolean
  connected: boolean
  chatLoading: boolean
  chatError: string | null
  conversations: ConversationListItem[]
  activeConversationId: string | null
  conversationStatus: ConversationStatusRecord | null
}) {
  const { theme } = useTheme()

  const conversationTitle = () => {
    const id = props.activeConversationId
    if (!id) return "New conversation"
    const conv = props.conversations.find((c) => c.conversationId === id)
    return conv?.title ?? "Untitled"
  }

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={42}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <scrollbox flexGrow={1}>
        <box flexShrink={0} gap={1} paddingRight={1}>
          {/* Conversation title (top, like session title) */}
          <Show when={props.connected}>
            <box paddingRight={1}>
              <text fg={theme.text} wrapMode="word">
                <b>{conversationTitle()}</b>
              </text>
            </box>
          </Show>

          {/* Bot status — same section pattern as Instance/Details */}
          <Show when={props.connected || props.chatLoading || props.chatError}>
            <box>
              <text fg={theme.text}>
                <b>Bot Status</b>
              </text>
              <Show when={props.chatError}>
                <text fg={theme.error}>{props.chatError}</text>
              </Show>
              <Show when={!props.chatError && props.chatLoading}>
                <text fg={theme.textMuted}>Connecting...</text>
              </Show>
              <Show when={!props.chatError && !props.chatLoading && props.connected}>
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} style={{ fg: props.online ? theme.success : theme.textMuted }}>
                    •
                  </text>
                  <text fg={theme.text}>{props.online ? "Online" : "Offline"}</text>
                </box>
              </Show>
              <Show when={!props.chatError && !props.chatLoading && !props.connected}>
                <text fg={theme.textMuted}>Unavailable</text>
              </Show>
            </box>
          </Show>

          {/* Context window usage */}
          <Show when={props.connected && props.conversationStatus}>
            {(s) => (
              <box>
                <text fg={theme.text}>
                  <b>Context</b>
                </text>
                <Show when={s().contextWindow > 0}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>Used</text>
                    <text fg={theme.text}>
                      {Math.min(100, Math.round((s().contextTokens / s().contextWindow) * 100))}%
                    </text>
                  </box>
                </Show>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.textMuted}>Tokens</text>
                  <text fg={theme.text}>
                    {formatTokens(s().contextTokens)} / {formatTokens(s().contextWindow)}
                  </text>
                </box>
                <Show when={s().model}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>Model</text>
                    <text fg={theme.text} wrapMode="none">
                      {s().model}
                    </text>
                  </box>
                </Show>
                <Show when={s().provider}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>Provider</text>
                    <text fg={theme.text} wrapMode="none">
                      {s().provider}
                    </text>
                  </box>
                </Show>
              </box>
            )}
          </Show>

          <Show when={props.loading}>
            <text fg={theme.textMuted}>Loading...</text>
          </Show>

          <Show when={props.error}>
            <text fg={theme.error}>{props.error}</text>
          </Show>

          <Show when={!props.loading && !props.error && props.status}>
            <box>
              <text fg={theme.text}>
                <b>Instance</b>
              </text>
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} style={{ fg: dot(props.status!.status, theme) }}>
                  •
                </text>
                <text fg={theme.text}>
                  {(props.status!.status ?? "unknown").replace(/^./, (c) => c.toUpperCase())}{" "}
                  <span style={{ fg: theme.textMuted }}>
                    {props.status!.status === "running" ? uptime(props.status!.lastStartedAt) : ""}
                  </span>
                </text>
              </box>
            </box>

            <box>
              <text fg={theme.text}>
                <b>Details</b>
              </text>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>Region</text>
                <text fg={theme.text}>{props.status!.flyRegion?.toUpperCase() ?? "—"}</text>
              </box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>Version</text>
                <text fg={theme.text}>{props.status!.openclawVersion ?? "—"}</text>
              </box>
              <Show when={props.status!.channelCount != null && props.status!.channelCount >= 1}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.textMuted}>Channels</text>
                  <text fg={theme.text}>{props.status!.channelCount}</text>
                </box>
              </Show>
            </box>
          </Show>

          <Show when={!props.loading && !props.error && !props.status}>
            <box>
              <text fg={theme.textMuted}>No instance found.</text>
              <text fg={theme.textMuted}>Visit kilo.ai/claw</text>
              <text fg={theme.textMuted}>to set one up.</text>
            </box>
          </Show>
        </box>
      </scrollbox>

      <box flexShrink={0} paddingTop={1}>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>Esc</span> back
        </text>
      </box>
    </box>
  )
}
