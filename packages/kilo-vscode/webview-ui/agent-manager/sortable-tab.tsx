/**
 * Drag-and-drop sortable tab components for the agent manager tab bar.
 */

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}

import { Component, onCleanup, Show } from "solid-js"
import { createSortable, useDragDropContext } from "@thisbeyond/solid-dnd"
import type { Transformer } from "@thisbeyond/solid-dnd"
import { createRoot } from "solid-js"
import type { SessionInfo } from "../src/types/messages"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { useLanguage } from "../src/context/language"
import { parseBindingTokens } from "./keybind-tokens"

/** Lock drag movement to the X axis (horizontal-only tab dragging). */
export const ConstrainDragYAxis: Component = () => {
  const context = useDragDropContext()
  if (!context) return null
  const [, { onDragStart, onDragEnd, addTransformer, removeTransformer }] = context
  const transformer: Transformer = { id: "constrain-y-axis", order: 100, callback: (t) => ({ ...t, y: 0 }) }
  const dispose = createRoot((dispose) => {
    onDragStart(({ draggable }) => {
      if (draggable) addTransformer("draggables", draggable.id as string, transformer)
    })
    onDragEnd(({ draggable }) => {
      if (draggable) removeTransformer("draggables", draggable.id as string, transformer.id)
    })
    return dispose
  })
  onCleanup(dispose)
  return null
}

/** Individual sortable tab wrapper using the `use:sortable` directive. */
export const SortableTab: Component<{
  tab: SessionInfo
  active: boolean
  keybind?: string
  closeKeybind?: string
  onSelect: () => void
  onMiddleClick: (e: MouseEvent) => void
  onClose: () => void
  onFork?: () => void
}> = (props) => {
  const { t } = useLanguage()
  const sortable = createSortable(props.tab.id)
  // Prevent tree-shaking of the directive reference used by `use:sortable`
  void sortable
  return (
    <div
      use:sortable
      class={`am-tab-sortable ${sortable.isActiveDraggable ? "am-tab-dragging" : ""}`}
      data-tab-id={props.tab.id}
    >
      <ContextMenu>
        <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
          <TooltipKeybind
            title={props.tab.title || t("agentManager.session.untitled")}
            keybind={props.keybind ?? ""}
            placement="bottom"
            inactive={props.active}
          >
            <div
              class={`am-tab ${props.active ? "am-tab-active" : ""}`}
              onClick={props.onSelect}
              onMouseDown={props.onMiddleClick}
            >
              <span class="am-tab-label">{props.tab.title || t("agentManager.session.untitled")}</span>
              <TooltipKeybind title={t("agentManager.tab.close")} keybind={props.closeKeybind ?? ""} placement="bottom">
                <IconButton
                  icon="close-small"
                  size="small"
                  variant="ghost"
                  label={t("agentManager.tab.closeTab")}
                  class="am-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onClose()
                  }}
                />
              </TooltipKeybind>
            </div>
          </TooltipKeybind>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content class="am-ctx-menu">
            <Show when={props.onFork}>
              <ContextMenu.Item onSelect={() => props.onFork?.()}>
                <Icon name="branch" size="small" />
                <ContextMenu.ItemLabel>{t("agentManager.tab.forkSession")}</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <ContextMenu.Separator />
            </Show>
            <ContextMenu.Item onSelect={props.onClose}>
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

/** Draggable review tab variant with leading icon and custom tooltip. */
export const SortableReviewTab: Component<{
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
  // Prevent tree-shaking of the directive reference used by `use:sortable`
  void sortable

  return (
    <div
      use:sortable
      class={`am-tab-sortable ${sortable.isActiveDraggable ? "am-tab-dragging" : ""}`}
      data-tab-id={props.id}
    >
      <TooltipKeybind title={props.tooltip} keybind={props.keybind ?? ""} placement="bottom" inactive={props.active}>
        <div
          class={`am-tab am-tab-review ${props.active ? "am-tab-active" : ""}`}
          onClick={props.onSelect}
          onMouseDown={props.onMiddleClick}
        >
          <Icon name="layers" size="small" />
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
    </div>
  )
}
