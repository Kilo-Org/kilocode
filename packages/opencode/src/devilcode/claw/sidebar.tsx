// kilocode_change - new file

/**
 * KiloClaw status sidebar
 *
 * Displays essential instance information: status, bot presence,
 * region, sandbox ID, uptime, and version.
 *
 * Visual style mirrors the session sidebar (routes/session/sidebar.tsx).
 */

import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import type { ClawStatus } from "./types"

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

export function ClawSidebar(props: {
  status: ClawStatus | null
  loading: boolean
  error: string | null
  online: boolean
  connected: boolean
  chatLoading: boolean
  chatError: string | null
}) {
  const { theme } = useTheme()

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
          <box paddingRight={1}>
            <text fg={theme.text}>
              <b>KiloClaw</b>
            </text>
          </box>

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
                <b>Bot</b>
              </text>
              <Show when={!props.chatLoading} fallback={<text fg={theme.textMuted}>Connecting...</text>}>
                <Show when={props.chatError}>
                  <text fg={theme.error}>{props.chatError}</text>
                </Show>
                <Show when={!props.chatError && props.connected}>
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} style={{ fg: props.online ? theme.success : theme.textMuted }}>
                      •
                    </text>
                    <text fg={theme.text}>{props.online ? "Online" : "Offline"}</text>
                  </box>
                </Show>
                <Show when={!props.chatError && !props.connected}>
                  <text fg={theme.textMuted}>Unavailable</text>
                </Show>
              </Show>
            </box>

            <box>
              <text fg={theme.text}>
                <b>Details</b>
              </text>
              <text fg={theme.textMuted}>
                Region <span style={{ fg: theme.text }}>{props.status!.flyRegion?.toUpperCase() ?? "—"}</span>
              </text>
              <text fg={theme.textMuted}>
                Version <span style={{ fg: theme.text }}>{props.status!.openclawVersion ?? "—"}</span>
              </text>
              <Show when={props.status!.channelCount != null && props.status!.channelCount >= 1}>
                <text fg={theme.textMuted}>
                  Channels <span style={{ fg: theme.text }}>{props.status!.channelCount}</span>
                </text>
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
