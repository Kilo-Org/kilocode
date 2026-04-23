/**
 * Draggable tab chrome for an xterm terminal tab.
 *
 * Shares the same hover/tooltip/close/right-click mechanism as the
 * session and review tab variants so users get consistent navigation
 * hints and context actions regardless of tab kind.
 */

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}

import { Component, Show } from "solid-js"
import { createSortable } from "@thisbeyond/solid-dnd"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { useLanguage } from "../../src/context/language"
import { parseBindingTokens } from "../keybind-tokens"

export const SortableTerminalTab: Component<{
  id: string
  label: string
  tooltip: string
  keybind?: string
  closeKeybind?: string
  active: boolean
  onSelect: () => void
  onMiddleClick: (e: MouseEvent) => void
  onClose: (e: MouseEvent) => void
}> = (props) => {
  const { t } = useLanguage()
  const sortable = createSortable(props.id)
  void sortable
  return (
    <div
      use:sortable
      class={`am-tab-sortable ${sortable.isActiveDraggable ? "am-tab-dragging" : ""}`}
      data-tab-id={props.id}
    >
      <ContextMenu>
        <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
          <TooltipKeybind
            title={props.tooltip}
            keybind={props.keybind ?? ""}
            placement="bottom"
            inactive={props.active}
          >
            <div
              class={`am-tab am-tab-terminal ${props.active ? "am-tab-active" : ""}`}
              onClick={props.onSelect}
              onMouseDown={props.onMiddleClick}
            >
              <Icon name="console" size="small" />
              <span class="am-tab-label">{props.label}</span>
              <TooltipKeybind title={t("agentManager.tab.close")} keybind={props.closeKeybind ?? ""} placement="bottom">
                <IconButton
                  icon="close-small"
                  size="small"
                  variant="ghost"
                  label={t("agentManager.tab.closeTab")}
                  class="am-tab-close"
                  onClick={props.onClose}
                />
              </TooltipKeybind>
            </div>
          </TooltipKeybind>
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
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    </div>
  )
}
