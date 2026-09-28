import { type Component, createRoot, onCleanup } from "solid-js"
import { useDragDropContext, type Transformer } from "@thisbeyond/solid-dnd"

/**
 * Keep worktree drags from drifting left off-screen while allowing movement to
 * the right, so a card can leave the sidebar and be dropped on the prompt.
 * Vertical position still drives the sortable reorder animation.
 */
export const ConstrainDragXAxis: Component = () => {
  const ctx = useDragDropContext()
  if (!ctx) return null
  const [, { onDragStart, onDragEnd, addTransformer, removeTransformer }] = ctx
  const xform: Transformer = { id: "constrain-x-axis", order: 100, callback: (t) => ({ ...t, x: Math.max(0, t.x) }) }
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
