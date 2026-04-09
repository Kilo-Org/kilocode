/**
 * Section drag-and-drop helpers. Separated from section-helpers.ts to avoid
 * pulling solid-dnd into test environments.
 */
import { closestCenter } from "@thisbeyond/solid-dnd"
import type { CollisionDetector } from "@thisbeyond/solid-dnd"

/**
 * Collision detector that prioritizes section drop zones when a worktree is
 * dragged (checks bounding box, not just center). Skips the worktree's home
 * section so within-section reorder works. Falls back to closestCenter.
 *
 * @param secIds Accessor for all section IDs
 * @param home Accessor for worktree ID → its sectionId (or undefined if ungrouped)
 */
export function sectionAwareDetector(
  secIds: () => Set<string>,
  home: () => Map<string, string | undefined>,
): CollisionDetector {
  return (draggable, droppables, ctx) => {
    const secs = secIds()
    const id = draggable.id as string
    const mySection = home().get(id)
    if (!secs.has(id)) {
      const pt = draggable.transformed.center
      for (const d of droppables) {
        if (!secs.has(d.id as string)) continue
        if (d.id === mySection) continue
        const { top, bottom, left, right } = d.layout
        if (pt.x >= left && pt.x <= right && pt.y >= top && pt.y <= bottom) return d
      }
    }
    return closestCenter(draggable, droppables, ctx)
  }
}
