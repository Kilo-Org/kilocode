import type { RGBA } from "@opentui/core"

export function UsageRow(props: { label: string; value: string; color: RGBA }) {
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={props.color}>{props.label}</text>
      <text fg={props.color}>{props.value}</text>
    </box>
  )
}

export function ModelRow(props: {
  label: string
  steps: string
  cost: string
  expanded: boolean
  text: RGBA
  muted: RGBA
  toggle: () => void
}) {
  return (
    <box flexDirection="row" gap={1} onMouseDown={props.toggle}>
      <text fg={props.text} flexShrink={0}>
        {props.expanded ? "▼" : "▶"}
      </text>
      <box flexGrow={1} minWidth={0} overflow="hidden">
        <text fg={props.text} wrapMode="none">
          <b>{props.label}</b>
        </text>
      </box>
      <box width={5} flexDirection="row" flexShrink={0} justifyContent="flex-end">
        <text fg={props.muted}>{props.steps}</text>
      </box>
      <box width={9} flexDirection="row" flexShrink={0} justifyContent="flex-end">
        <text fg={props.muted}>{props.cost}</text>
      </box>
    </box>
  )
}
