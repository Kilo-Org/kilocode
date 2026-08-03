/** @jsxImportSource solid-js */
import { Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"

export function SectionHeading(props: {
  title: string
  open: boolean
  onToggle: () => void
  count?: string
  countClass?: string
}) {
  return (
    <button class="am-pr-panel-section-heading am-pr-panel-section-toggle am-pr-row" onClick={props.onToggle}>
      <span class="am-pr-panel-section-heading-left am-pr-row">
        <Icon name={props.open ? "chevron-down" : "chevron-right"} size="small" class="am-pr-section-chevron" />
        {props.title}
      </span>
      <Show when={props.count}>
        <span class={`am-pr-panel-section-count ${props.countClass ?? ""}`}>{props.count}</span>
      </Show>
    </button>
  )
}
