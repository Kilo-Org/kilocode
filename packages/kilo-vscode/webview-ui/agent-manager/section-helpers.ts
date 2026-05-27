/**
 * Section computation helpers for the agent manager sidebar.
 * Pure functions — no solid-dnd dependency so they remain testable.
 */
import type { WorktreeState, SectionState } from "../src/types/messages"

export type TopLevelItem = { kind: "section"; section: SectionState } | { kind: "worktree"; wt: WorktreeState }

export type SidebarItem = { type: "local" | "wt" | "session"; id: string }

/** Build a canonical sidebar order containing section IDs and every worktree ID. */
export function completeSidebarOrder(secs: SectionState[], all: WorktreeState[], order: string[]): string[] {
  const valid = new Set([...secs.map((sec) => sec.id), ...all.map((wt) => wt.id)])
  const secIds = new Set(secs.map((sec) => sec.id))
  const wtMap = new Map(all.map((wt) => [wt.id, wt]))
  const result: string[] = []
  const seen = new Set<string>()
  const add = (id: string) => {
    if (!valid.has(id) || seen.has(id)) return
    result.push(id)
    seen.add(id)
  }
  for (const id of order) add(id)
  for (const sec of secs) add(sec.id)
  for (const wt of all) add(wt.id)
  if (secs.length === 0) return result
  return [
    ...result.filter((id) => {
      const wt = wtMap.get(id)
      return wt && !wt.sectionId
    }),
    ...result.filter((id) => secIds.has(id)),
    ...result.filter((id) => {
      const wt = wtMap.get(id)
      return wt?.sectionId
    }),
  ]
}

/** Check if this worktree is part of a multi-version group. */
export const isGrouped = (wt: WorktreeState) => !!wt.groupId

/** Check if this is the first item in its group within a given list. */
export const isGroupStart = (wt: WorktreeState, idx: number, list: WorktreeState[]) => {
  if (!wt.groupId) return false
  if (idx === 0) return true
  return list[idx - 1]?.groupId !== wt.groupId
}

/** Check if this is the last item in its group within a given list. */
export const isGroupEnd = (wt: WorktreeState, idx: number, list: WorktreeState[]) => {
  if (!wt.groupId) return false
  if (idx === list.length - 1) return true
  return list[idx + 1]?.groupId !== wt.groupId
}

/**
 * Build the top-level list with ungrouped worktrees before sections.
 */
export function buildTopLevelItems(
  secs: SectionState[],
  ungrouped: WorktreeState[],
  all: WorktreeState[],
  order: string[],
): TopLevelItem[] {
  if (secs.length === 0) {
    return all.map((wt) => ({ kind: "worktree" as const, wt }))
  }
  const rank = new Map(order.map((id, idx) => [id, idx] as const))
  const sort = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  return [
    ...sort(ungrouped).map((wt) => ({ kind: "worktree" as const, wt })),
    ...sort(secs).map((section) => ({ kind: "section" as const, section })),
  ]
}

/**
 * Build the flat visual order of all sidebar items matching what the user sees.
 * LOCAL is always first, then worktrees in visual order (ungrouped first, then sections,
 * skipping collapsed sections), then unassigned sessions.
 */
export function buildSidebarOrder(
  items: TopLevelItem[],
  sorted: WorktreeState[],
  sections: SectionState[],
  members: (id: string) => WorktreeState[],
  sessions: { id: string }[],
): SidebarItem[] {
  const result: SidebarItem[] = [{ type: "local", id: "local" }]
  if (sections.length > 0) {
    for (const item of items) {
      if (item.kind === "section") {
        if (!item.section.collapsed) {
          for (const wt of members(item.section.id)) {
            result.push({ type: "wt", id: wt.id })
          }
        }
      } else {
        result.push({ type: "wt", id: item.wt.id })
      }
    }
  } else {
    for (const wt of sorted) {
      result.push({ type: "wt", id: wt.id })
    }
  }
  for (const s of sessions) {
    result.push({ type: "session", id: s.id })
  }
  return result
}

/** Build a map from sidebar item id → 1-based shortcut number (1 for LOCAL, 2+ for worktrees). */
export function buildShortcutMap(order: SidebarItem[]): Map<string, number> {
  const map = new Map<string, number>()
  for (let i = 0; i < order.length && i < 9; i++) {
    map.set(order[i]!.id, i + 1)
  }
  return map
}
