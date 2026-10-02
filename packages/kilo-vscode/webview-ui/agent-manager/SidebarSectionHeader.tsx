import { Show, type Component, type JSX } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"

interface Props {
  label: JSX.Element
  /** Leading icon that takes the chevron's place. On hover it turns into the chevron. */
  icon?: JSX.Element
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
        <Show when={props.onToggle && props.icon}>
          {/* The project icon takes the chevron's place and is the toggle, so
              no separate chevron button is needed. The row click stays for
              activation (see the onClick prop); this click does not bubble. */}
          <button
            type="button"
            class="am-sidebar-header-icon"
            aria-expanded={props.expanded}
            aria-label={props.ariaLabel ?? "Toggle section"}
            disabled={props.disabled}
            onClick={(event) => {
              event.stopPropagation()
              if (!props.disabled) props.onToggle?.()
            }}
          >
            <span class="am-sidebar-header-icon-image">{props.icon}</span>
            <span class="am-sidebar-header-icon-chevron">
              <Icon name="chevron-right" size="small" />
            </span>
          </button>
        </Show>
        <Show when={props.onToggle && !props.icon}>
          <IconButton
            icon="chevron-right"
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
