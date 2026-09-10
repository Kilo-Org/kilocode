import { type Component, createRoot, onCleanup } from "solid-js"
import { useDragDropContext, type Transformer } from "@thisbeyond/solid-dnd"

/** Lock drag movement to the Y axis (vertical-only worktree dragging). */
export const ConstrainDragXAxis: Component = () => {
  const ctx = useDragDropContext()
  if (!ctx) return null
  const [, { onDragStart, onDragEnd, addTransformer, removeTransformer }] = ctx
  const xform: Transformer = { id: "constrain-x-axis", order: 100, callback: (t) => ({ ...t, x: 0 }) }
  const dispose = createRoot((d) => {
    onDragStart(({ draggable }) => {
      if (draggable) addTransformer("draggables", draggable.id as string, xform)
    })
    onDragEnd(({ draggable }) => {
      if (draggable) removeTransformer("draggables", draggable.id as string, xform.id)
    })
    return d
  })
  onCleanup(dispose)
  return null
}
