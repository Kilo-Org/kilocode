/** Pure helpers for drag-and-drop reordering of sidebar projects. */

export interface ProjectRow {
  id: string
  top: number
  bottom: number
}

export interface ProjectDrop {
  id: string
  after: boolean
}

/**
 * Find the insertion point for a dragged project from a vertical position.
 * `rows` are the movable (not pinned) projects in display order. The upper
 * half of a row inserts before it and the lower half inserts after it, so
 * tall expanded projects do not make the target flicker.
 */
export function projectDrop(rows: ProjectRow[], y: number): ProjectDrop | undefined {
  const first = rows.at(0)
  const last = rows.at(-1)
  if (!first || !last) return
  if (y < first.top) return { id: first.id, after: false }
  const row = rows.find((item) => y <= item.bottom) ?? last
  return { id: row.id, after: y > (row.top + row.bottom) / 2 }
}

/** Return the order after moving `from` to `drop`, or undefined when the order does not change. */
export function moveProject(ids: string[], from: string, drop: ProjectDrop): string[] | undefined {
  if (from === drop.id || !ids.includes(from) || !ids.includes(drop.id)) return
  const rest = ids.filter((id) => id !== from)
  const index = rest.indexOf(drop.id) + (drop.after ? 1 : 0)
  const next = [...rest.slice(0, index), from, ...rest.slice(index)]
  if (next.every((id, i) => id === ids[i])) return
  return next
}

/**
 * Apply a local project order on top of the latest snapshots. Pinned projects
 * stay first. Projects missing from `order` keep their snapshot order at the end.
 */
export function applyProjectOrder<T extends { id: string; pinned: boolean }>(projects: T[], order?: string[]): T[] {
  if (!order) return projects
  const movable = projects.filter((project) => !project.pinned)
  const listed = order.flatMap((id) => movable.filter((project) => project.id === id))
  const rest = movable.filter((project) => !order.includes(project.id))
  return [...projects.filter((project) => project.pinned), ...listed, ...rest]
}
