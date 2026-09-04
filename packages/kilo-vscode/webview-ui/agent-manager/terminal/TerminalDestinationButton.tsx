/**
 * Terminal destination split button for the Agent Manager tab toolbar.
 *
 * The primary action opens whatever the user picked (VS Code integrated
 * terminal or the embedded side panel); the dropdown switches between
 * them. Markup mirrors the `+` new-tab split button in
 * `tab-rendering.tsx` so both share the same split-button styling.
 */

import type { Accessor, Component } from "solid-js"
import { Show } from "solid-js"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip, TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../src/context/language"
import type { TerminalDestination } from "../../src/types/messages/agent-manager"

interface Props {
  destination: Accessor<TerminalDestination>
  /** True while the embedded terminal panel is showing. */
  active: Accessor<boolean>
  keybind: Accessor<string>
  onOpen: () => void
  onChoose: (destination: TerminalDestination) => void
}

export const TerminalDestinationButton: Component<Props> = (props) => {
  const { t } = useLanguage()
  const item = (destination: TerminalDestination, label: string) => (
    <DropdownMenu.Item onSelect={() => props.onChoose(destination)}>
      <span class="am-menu-check">
        <Show when={props.destination() === destination}>
          <Icon name="check" size="small" />
        </Show>
      </span>
      <DropdownMenu.ItemLabel>{label}</DropdownMenu.ItemLabel>
    </DropdownMenu.Item>
  )
  return (
    <div class="am-split-button">
      <TooltipKeybind title={t("agentManager.tab.terminal")} keybind={props.keybind()} placement="bottom" openDelay={0}>
        <IconButton
          icon="console"
          size="small"
          variant="ghost"
          aria-label={t("agentManager.tab.openTerminal")}
          class={props.active() ? "am-tab-diff-btn-active" : ""}
          onClick={props.onOpen}
        />
      </TooltipKeybind>
      <DropdownMenu gutter={4} placement="bottom-end">
        <Tooltip value={t("agentManager.terminal.destination")} placement="bottom" openDelay={0}>
          <DropdownMenu.Trigger class="am-split-arrow" aria-label={t("agentManager.terminal.destination")}>
            <Icon name="chevron-down" size="small" />
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="am-split-menu">
            {item("vscode", t("agentManager.terminal.openInVscode"))}
            {item("agentManager", t("agentManager.terminal.openInPanel"))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}
