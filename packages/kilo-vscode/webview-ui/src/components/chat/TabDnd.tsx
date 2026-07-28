declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}

import { createSortable, useDragDropContext, type Transformer } from "@thisbeyond/solid-dnd"
import { createRoot, onCleanup, type Component, type ParentComponent } from "solid-js"

export const ConstrainDragYAxis: Component = () => {
  const context = useDragDropContext()
  if (!context) return null
  const [, { onDragStart, onDragEnd, addTransformer, removeTransformer }] = context
  const transformer: Transformer = { id: "constrain-y-axis", order: 100, callback: (value) => ({ ...value, y: 0 }) }
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

export const SortableTabContainer: ParentComponent<{ id: string }> = (props) => {
  const sortable = createSortable(props.id)
  void sortable
  return (
    <div
      use:sortable
      class="am-tab-sortable"
      classList={{ "am-tab-dragging": sortable.isActiveDraggable }}
      data-tab-id={props.id}
    >
      {props.children}
    </div>
  )
}
