import { Plugin } from "@opencode-ai/plugin/tui"
import { createSignal, Show, type JSX } from "solid-js"

/**
 * Collapsible sidebar section: a clickable triangle heading toggles the body,
 * expanded by default. The triangle uses the semantic action token because the
 * heading row is the click target.
 */
export function SidebarSection(props: {
  readonly theme: Plugin.Context["theme"]
  readonly title: string
  readonly children: JSX.Element
}) {
  const [open, setOpen] = createSignal(true)
  return (
    <box gap={0}>
      <box flexDirection="row" gap={1} onMouseDown={() => setOpen((current) => !current)}>
        <text fg={props.theme.text.action.secondary.default}>{open() ? "▼" : "▶"}</text>
        <text fg={props.theme.text.default}>
          <b>{props.title}</b>
        </text>
      </box>
      <Show when={open()}>{props.children}</Show>
    </box>
  )
}
