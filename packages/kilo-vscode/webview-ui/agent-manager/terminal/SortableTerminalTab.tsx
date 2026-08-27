/**
 * Terminal-specific adapter for the shared sortable inspector tab.
 *
 * PTY status determines the icon and whether a Setup tab can be closed. The
 * tab chrome, drag wrapper, context menu, and close behavior are shared with
 * subagent tabs.
 */

import { Show, type Component } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../src/context/language"
import { SortableClosableTab, type ClosableTabProps } from "../ClosableTab"
import { terminalChrome, terminalClosable, terminalStoppable } from "./chrome"
import type { ScriptTerminalStatus } from "./state"

interface Props extends Omit<ClosableTabProps, "icon" | "onClose" | "trailing"> {
  label: string
  tooltip: string
  status?: ScriptTerminalStatus
  onClose: () => void
  onStop?: (event: MouseEvent) => void
}

const StopButton: Component<{ active: boolean; tabIndex: number; onStop?: (event: MouseEvent) => void }> = (props) => {
  const { t } = useLanguage()
  return (
    <Show when={props.active && props.onStop}>
      <TooltipKeybind
        title={t("agentManager.terminal.stopSetup")}
        keybind=""
        placement="top"
        gutter={8}
        class="am-tab-close-wrap"
        openDelay={0}
      >
        <IconButton
          icon="stop"
          size="small"
          variant="ghost"
          aria-label={t("agentManager.terminal.stopSetup")}
          tabIndex={props.tabIndex}
          class="am-tab-close"
          onClick={(event) => {
            event.stopPropagation()
            props.onStop?.(event)
          }}
        />
      </TooltipKeybind>
    </Show>
  )
}

function icon(status: ScriptTerminalStatus | undefined) {
  const value = terminalChrome("", status).icon
  if (value === "success") return "check-small" as const
  if (value === "failure") return "warning" as const
  if (value === "spinner") return "spinner" as const
  return "console" as const
}

function iconStatus(status: ScriptTerminalStatus | undefined) {
  const value = terminalChrome("", status).icon
  if (value === "success") return "success" as const
  if (value === "failure") return "failure" as const
  return undefined
}

export const SortableTerminalTab: Component<
  Props & {
    id: string
    onCloseOthers: () => void
  }
> = (props) => (
  <SortableClosableTab
    id={props.id}
    label={props.label}
    tooltip={terminalChrome(props.tooltip, props.status).tooltip}
    icon={() => icon(props.status)}
    iconStatus={() => iconStatus(props.status)}
    class="am-tab-terminal"
    focused={props.focused}
    active={props.active}
    closeable={terminalClosable(props.status)}
    keybind={props.keybind}
    closeKeybind={props.closeKeybind}
    role={props.role}
    selected={props.selected}
    tabIndex={props.tabIndex}
    onKeyDown={props.onKeyDown}
    onSelect={props.onSelect}
    onMiddleClick={props.onMiddleClick}
    onClose={props.onClose}
    onCloseOthers={props.onCloseOthers}
    trailing={
      <StopButton active={terminalStoppable(props.status)} tabIndex={props.active ? 0 : -1} onStop={props.onStop} />
    }
  />
)
