/**
 * Drag-and-drop sortable tab components for the agent manager tab bar.
 */

import { Component } from "solid-js"
import type { JSX } from "solid-js"
import type { SessionInfo } from "../src/types/messages"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../src/context/language"
import { SessionTab } from "../src/components/chat/SessionTab"
import { SessionTabMenu } from "../src/components/chat/SessionTabMenu"
import { SortableTabContainer } from "../src/components/chat/TabDnd"
import { parseBindingTokens } from "./keybind-tokens"

/** Individual sortable tab wrapper using the `use:sortable` directive. */
export const SortableTab: Component<{
  tab: SessionInfo
  active: boolean
  busy: boolean
  keybind?: string
  closeKeybind?: string
  onSelect: () => void
  onMiddleClick: (e: MouseEvent) => void
  onClose: () => void
  onCloseOthers: () => void
  onFork?: () => void
  role?: "tab"
  selected?: boolean
  tabIndex?: number
  onKeyDown?: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent>
}> = (props) => {
  const { t } = useLanguage()
  return (
    <SortableTabContainer id={props.tab.id}>
      <SessionTabMenu
        showFork
        onFork={props.onFork}
        onClose={props.onClose}
        onCloseOthers={props.onCloseOthers}
        closeShortcut={
          props.closeKeybind ? (
            <span class="am-menu-shortcut">
              {parseBindingTokens(props.closeKeybind).map((token) => (
                <kbd class="am-menu-key">{token}</kbd>
              ))}
            </span>
          ) : undefined
        }
      >
        <SessionTab
          title={props.tab.title || t("agentManager.session.untitled")}
          active={props.active}
          busy={props.busy}
          keybind={props.keybind}
          closeKeybind={props.closeKeybind}
          closeTabIndex={props.active ? 0 : -1}
          role={props.role}
          selected={props.selected}
          tabIndex={props.tabIndex}
          onKeyDown={props.onKeyDown}
          closeTitle={t("agentManager.tab.close")}
          closeLabel={t("agentManager.tab.closeTab")}
          onSelect={props.onSelect}
          onMiddleClick={props.onMiddleClick}
          onClose={props.onClose}
        />
      </SessionTabMenu>
    </SortableTabContainer>
  )
}

/** Draggable review tab variant with leading icon and custom tooltip. */
export const SortableReviewTab: Component<{
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
}> = (props) => {
  const { t } = useLanguage()

  return (
    <SortableTabContainer id={props.id}>
      <div class={`am-tab am-tab-review ${props.active ? "am-tab-active" : ""}`}>
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
                <Icon name="layers" size="small" />
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
    </SortableTabContainer>
  )
}
