/**
 * Tab chrome for xterm terminals.
 *
 * `TerminalTabChrome` is the shared visual tab: console icon, title,
 * tooltip/keybinding hints, and the X close button — the same
 * `am-tab*` structure the session tabs use. `SortableTerminalTab`
 * wraps it with drag-and-drop and a right-click context menu for the
 * top tab bar; the side terminal panel uses the chrome directly so
 * both surfaces render identical terminal tabs.
 */

import { Component, Show, type JSX } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { useLanguage } from "../../src/context/language"
import { SortableTabContainer } from "../../src/components/chat/TabDnd"
import { parseBindingTokens } from "../keybind-tokens"

export const TerminalTabChrome: Component<{
  label: string
  tooltip: string
  keybind?: string
  closeKeybind?: string
  active: boolean
  role?: "tab"
  selected?: boolean
  tabIndex?: number
  onKeyDown?: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent>
  onSelect: () => void
  onMiddleClick?: (e: MouseEvent) => void
  onClose: (e: MouseEvent) => void
}> = (props) => {
  const { t } = useLanguage()
  return (
    <div class={`am-tab am-tab-terminal ${props.active ? "am-tab-active" : ""}`}>
      <div
        class="am-tab-target"
        role={props.role}
        aria-selected={props.selected}
        tabIndex={props.tabIndex}
        onClick={props.onSelect}
        onMouseDown={props.onMiddleClick}
        onKeyDown={props.onKeyDown}
      >
        <TooltipKeybind
          title={props.tooltip}
          keybind={props.keybind ?? ""}
          placement="bottom"
          gutter={8}
          class="am-tab-tooltip"
          openDelay={0}
        >
          <span class="am-tab-title">
            <span class="am-tab-icon">
              <Icon name="console" size="small" />
            </span>
            <span class="am-tab-label">{props.label}</span>
          </span>
        </TooltipKeybind>
      </div>
      <TooltipKeybind
        title={t("agentManager.tab.close")}
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
          aria-label={t("agentManager.tab.closeTab")}
          tabIndex={props.active ? 0 : -1}
          class="am-tab-close"
          onClick={props.onClose}
        />
      </TooltipKeybind>
    </div>
  )
}

export const SortableTerminalTab: Component<{
  id: string
  label: string
  tooltip: string
  keybind?: string
  closeKeybind?: string
  active: boolean
  role?: "tab"
  selected?: boolean
  tabIndex?: number
  onKeyDown?: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent>
  onSelect: () => void
  onMiddleClick: (e: MouseEvent) => void
  onClose: (e: MouseEvent) => void
  onCloseOthers: () => void
}> = (props) => {
  const { t } = useLanguage()
  return (
    <SortableTabContainer id={props.id}>
      <ContextMenu>
        <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
          <TerminalTabChrome
            label={props.label}
            tooltip={props.tooltip}
            keybind={props.keybind}
            closeKeybind={props.closeKeybind}
            active={props.active}
            role={props.role}
            selected={props.selected}
            tabIndex={props.tabIndex}
            onKeyDown={props.onKeyDown}
            onSelect={props.onSelect}
            onMiddleClick={props.onMiddleClick}
            onClose={props.onClose}
          />
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content class="am-ctx-menu">
            <ContextMenu.Item
              onSelect={() => props.onClose(new MouseEvent("click", { bubbles: true, cancelable: true }) as MouseEvent)}
            >
              <Icon name="close" size="small" />
              <ContextMenu.ItemLabel>{t("agentManager.tab.close")}</ContextMenu.ItemLabel>
              <Show when={props.closeKeybind}>
                <span class="am-menu-shortcut">
                  {parseBindingTokens(props.closeKeybind ?? "").map((token) => (
                    <kbd class="am-menu-key">{token}</kbd>
                  ))}
                </span>
              </Show>
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={props.onCloseOthers}>
              <Icon name="close" size="small" />
              <ContextMenu.ItemLabel>{t("agentManager.tab.closeOthers")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    </SortableTabContainer>
  )
}
