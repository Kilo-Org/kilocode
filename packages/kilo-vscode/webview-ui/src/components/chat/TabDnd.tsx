declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}

import { createSortable, useDragDropContext, type Transformer, type DragEvent } from "@thisbeyond/solid-dnd"
import { createRoot, onCleanup, type Component, type ParentComponent } from "solid-js"
import { promptMentionDragging } from "../../utils/prompt-mention-drop"

/**
 * True once a dragged tab has moved below the tab bar, which means it left the
 * bar on the way to the prompt. Reorder must stop at that point so the tabs do
 * not keep animating under the pointer.
 */
export function outsideTabBar(event: DragEvent): boolean {
  return event.draggable.transformed.center.y > event.draggable.layout.bottom
}

/** Same idea for a side panel tab strip, where leaving means moving left. */
export function outsideSidePanel(event: DragEvent): boolean {
  return event.draggable.transformed.center.x < event.draggable.layout.left
}

/**
 * Keep tab drags in the tab bar normally, but allow a session tab to move down
 * out of the bar while it is being dragged to the prompt.
 */
export const ConstrainDragYAxis: Component = () => {
  const context = useDragDropContext()
  if (!context) return null
  const [, { onDragStart, onDragEnd, addTransformer, removeTransformer }] = context
  const transformer: Transformer = {
    id: "constrain-y-axis",
    order: 100,
    callback: (value) => ({ ...value, y: promptMentionDragging() ? Math.max(0, value.y) : 0 }),
  }
  const dispose = createRoot((cleanup) => {
    onDragStart(({ draggable }) => {
      if (draggable) addTransformer("draggables", draggable.id as string, transformer)
    })
    onDragEnd(({ draggable }) => {
      if (draggable) removeTransformer("draggables", draggable.id as string, transformer.id)
    })
    return cleanup
  })
  onCleanup(dispose)
  return null
}

export const SortableTabContainer: ParentComponent<{ id: string; class?: string }> = (props) => {
  const sortable = createSortable(props.id)
  void sortable
  return (
    <div
      use:sortable
      class={props.class ?? "am-tab-sortable"}
      classList={{ "am-tab-dragging": sortable.isActiveDraggable }}
      data-tab-id={props.id}
    >
      {props.children}
    </div>
  )
}
