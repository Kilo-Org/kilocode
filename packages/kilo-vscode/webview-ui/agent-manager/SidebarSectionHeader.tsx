import { Show, type Component, type JSX } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"

interface Props {
  label: JSX.Element
  expanded?: boolean
  onToggle?: () => void
  onClick?: () => void
  count?: JSX.Element
  actions?: JSX.Element
  class?: string
  title?: string
  ariaLabel?: string
  disabled?: boolean
}

/** Shared layout for sidebar headings with a fixed leading control column. */
export const SidebarSectionHeader: Component<Props> = (props) => {
  return (
    <div
      class={`am-sidebar-header${props.onToggle ? " am-sidebar-header-toggleable" : ""}${props.class ? ` ${props.class}` : ""}`}
      title={props.title}
      onClick={(event) => {
        if (event.button === 0 && !props.disabled) (props.onClick ?? props.onToggle)?.()
      }}
    >
      <div class="am-sidebar-header-main">
        <Show when={props.onToggle}>
          <IconButton
            icon={props.expanded ? "chevron-down" : "chevron-right"}
            variant="ghost"
            size="small"
            class="am-sidebar-header-toggle"
            aria-expanded={props.expanded}
            aria-label={props.ariaLabel ?? "Toggle section"}
            disabled={props.disabled}
            onClick={(event) => {
              event.stopPropagation()
              if (!props.disabled) props.onToggle?.()
            }}
          />
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
