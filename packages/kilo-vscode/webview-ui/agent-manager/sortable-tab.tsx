/**
 * Drag-and-drop sortable tab components for the agent manager tab bar.
 */

import { Component, onCleanup } from "solid-js"
import { createSortable, useDragDropContext } from "@thisbeyond/solid-dnd"
import type { Transformer } from "@thisbeyond/solid-dnd"
import { createRoot } from "solid-js"
import type { SessionInfo } from "../src/types/messages"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"

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
  onClose: (e: MouseEvent) => void
}> = (props) => {
  const sortable = createSortable(props.tab.id)
  // Prevent tree-shaking of the directive reference used by `use:sortable`
  void sortable
  return (
    // @ts-ignore - use:sortable is a SolidJS directive compiled by esbuild-plugin-solid
    <div
      use:sortable
      class={`am-tab-sortable ${sortable.isActiveDraggable ? "am-tab-dragging" : ""}`}
      data-tab-id={props.tab.id}
    >
      <TooltipKeybind
        title={props.tab.title || "Untitled"}
        keybind={props.keybind ?? ""}
        placement="bottom"
        inactive={props.active}
      >
        <div
          class={`am-tab ${props.active ? "am-tab-active" : ""}`}
          onClick={props.onSelect}
          onMouseDown={props.onMiddleClick}
        >
          <span class="am-tab-label">{props.tab.title || "Untitled"}</span>
          <TooltipKeybind title="Close" keybind={props.closeKeybind ?? ""} placement="bottom">
            <IconButton
              icon="close-small"
              size="small"
              variant="ghost"
              label="Close tab"
              class="am-tab-close"
              onClick={props.onClose}
            />
          </TooltipKeybind>
        </div>
      </TooltipKeybind>
    </div>
  )
}
