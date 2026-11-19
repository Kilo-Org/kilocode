import { For, type JSX } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"

// Keep every icon mounted so changing modifiers reverses the crossfade instead of restarting it.
const SEND_ICONS = ["send", "arrow-up", "clock", "arrow-right"] as const

export function ComposerSend(props: {
  hint: JSX.Element
  icon: (typeof SEND_ICONS)[number]
  label: string
  disabled: boolean
  onClick: (event: MouseEvent) => void
}) {
  return (
    <Tooltip value={props.hint} placement="top" openDelay={0}>
      <button
        type="button"
        data-component="icon-button"
        data-size="small"
        data-variant="ghost"
        data-icon={props.icon}
        class="prompt-send-button"
        onClick={props.onClick}
        disabled={props.disabled}
        aria-label={props.label}
      >
        <For each={SEND_ICONS}>
          {(name) => (
            <span class="prompt-send-icon" data-name={name} data-active={props.icon === name ? "" : undefined}>
              <Icon name={name} size="small" />
            </span>
          )}
        </For>
      </button>
    </Tooltip>
  )
}
