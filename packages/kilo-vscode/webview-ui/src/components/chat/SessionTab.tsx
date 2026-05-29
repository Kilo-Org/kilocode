import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { Show, type Component, type JSX } from "solid-js"

export const SessionTab: Component<{
  title: string
  active: boolean
  busy: boolean
  closeTitle: string
  closeLabel: string
  keybind?: string
  closeKeybind?: string
  role?: "tab"
  selected?: boolean
  tabIndex?: number
  onSelect: () => void
  onMiddleClick?: (event: MouseEvent) => void
  onKeyDown?: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent>
  onClose: () => void
}> = (props) => (
  <div
    class={`am-tab ${props.active ? "am-tab-active" : ""}`}
    role={props.role}
    aria-selected={props.selected}
    tabIndex={props.tabIndex}
    onClick={props.onSelect}
    onMouseDown={props.onMiddleClick}
    onKeyDown={props.onKeyDown}
  >
    <TooltipKeybind
      title={props.title}
      keybind={props.keybind ?? ""}
      placement="bottom"
      gutter={8}
      class="am-tab-tooltip"
      openDelay={0}
    >
      <span class="am-tab-title">
        <Show when={props.busy}>
          <span class="am-tab-icon">
            <Spinner class="am-worktree-spinner" />
          </span>
        </Show>
        <span class="am-tab-label">{props.title}</span>
      </span>
    </TooltipKeybind>
    <TooltipKeybind
      title={props.closeTitle}
      keybind={props.closeKeybind ?? ""}
      placement="top"
      gutter={8}
      class="am-tab-close-wrap"
      openDelay={0}
    >
      <IconButton
        icon="close-small"
        size="small"
        variant="ghost"
        label={props.closeLabel}
        class="am-tab-close"
        onClick={(event) => {
          event.stopPropagation()
          props.onClose()
        }}
      />
    </TooltipKeybind>
  </div>
)
