import { Show, type Component, type JSX } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"

interface Props {
  label: JSX.Element
  expanded?: boolean
  onToggle?: () => void
  count?: JSX.Element
  actions?: JSX.Element
  class?: string
  title?: string
  ariaLabel?: string
}

/** Shared layout for sidebar headings with a fixed leading control column. */
export const SidebarSectionHeader: Component<Props> = (props) => {
  const keydown = (event: KeyboardEvent) => {
    if (!props.onToggle || event.target !== event.currentTarget) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    props.onToggle()
  }

  return (
    <div
      class={`am-sidebar-header${props.class ? ` ${props.class}` : ""}`}
      role={props.onToggle ? "button" : undefined}
      tabIndex={props.onToggle ? 0 : undefined}
      aria-expanded={props.onToggle ? props.expanded : undefined}
      aria-label={props.ariaLabel}
      title={props.title}
      onClick={(event) => {
        if (event.button === 0) props.onToggle?.()
      }}
      onKeyDown={keydown}
    >
      <div class="am-sidebar-header-main">
        <Show when={props.onToggle}>
          <span class="am-sidebar-header-chevron" aria-hidden="true">
            <Icon name={props.expanded ? "chevron-down" : "chevron-right"} size="small" />
          </span>
        </Show>
        <div class="am-sidebar-header-label">{props.label}</div>
      </div>
      <Show when={props.count !== undefined}>
        <span class="am-sidebar-header-count">{props.count}</span>
      </Show>
      <Show when={props.actions !== undefined}>
        <div class="am-sidebar-header-actions">{props.actions}</div>
      </Show>
    </div>
  )
}
