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
  return (
    <div
      class={`am-sidebar-header${props.onToggle ? " am-sidebar-header-toggleable" : ""}${props.class ? ` ${props.class}` : ""}`}
      title={props.title}
      onClick={(event) => {
        if (event.button === 0) props.onToggle?.()
      }}
    >
      <div class="am-sidebar-header-main">
        <Show when={props.onToggle}>
          <button
            class="am-sidebar-header-toggle"
            type="button"
            aria-expanded={props.expanded}
            aria-label={props.ariaLabel}
            onClick={(event) => {
              event.stopPropagation()
              props.onToggle?.()
            }}
          >
            <span class="am-sidebar-header-chevron" aria-hidden="true">
              <Icon name={props.expanded ? "chevron-down" : "chevron-right"} size="small" />
            </span>
          </button>
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
