import type { PermissionRequest, ToolPart } from "@kilocode/sdk/v2"
import { Spinner } from "@tui/component/spinner"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { createMemo, Show } from "solid-js"
import type { PermissionInfo } from "./memory-permission"
import { ModeSwitch } from "./mode-switch"

function PermissionBody(props: { reason?: string }) {
  const { theme } = useTheme()
  return (
    <box paddingLeft={1}>
      <Show when={props.reason}>
        <text fg={theme.textMuted}>{props.reason}</text>
      </Show>
    </box>
  )
}

export namespace ModeSwitchTui {
  export function permission(request: PermissionRequest): PermissionInfo {
    const current = ModeSwitch.prompt(request.metadata ?? {})
    return {
      icon: "⇄",
      heading: current.heading,
      title: current.title,
      body: <PermissionBody reason={current.reason} />,
      options: current.options,
    }
  }

  export function Tool(props: { input: Record<string, unknown>; metadata: Record<string, unknown>; part: ToolPart }) {
    const { theme } = useTheme()
    const sync = useSync()
    const current = createMemo(() => ModeSwitch.event(props.input, props.metadata))
    const reason = createMemo(() => ModeSwitch.reason(current().reason, props.part, sync.data.permission))
    const pending = () => props.part.state.status === "pending" || props.part.state.status === "running"
    const error = () => (props.part.state.status === "error" ? props.part.state.error : undefined)
    return (
      <box paddingLeft={3} marginTop={1} flexDirection="row" gap={1} flexShrink={0}>
        <Show when={pending()} fallback={<text fg={theme.textMuted}>{"⇄"}</text>}>
          <Spinner color={theme.text} />
        </Show>
        <box>
          <text fg={error() ? theme.error : pending() ? theme.text : theme.textMuted}>
            {error() ? "Mode switch failed" : current().title}
            <Show when={error()}>{(message) => ` · ${message()}`}</Show>
          </text>
          <Show when={reason()}>{(value) => <text fg={theme.textMuted}>{value()}</text>}</Show>
        </box>
      </box>
    )
  }
}
