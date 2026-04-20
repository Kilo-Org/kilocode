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
  return result
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
 * Build the interleaved list of sections and ungrouped worktrees
 * ordered by sidebarWorktreeOrder.
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
  const secMap = new Map(secs.map((s) => [s.id, s]))
  const wtMap = new Map(ungrouped.map((wt) => [wt.id, wt]))
  const result: TopLevelItem[] = []
  const placed = new Set<string>()

  for (const id of order) {
    if (placed.has(id)) continue
    placed.add(id)
    const sec = secMap.get(id)
    if (sec) {
      result.push({ kind: "section", section: sec })
      continue
    }
    const wt = wtMap.get(id)
    if (wt) result.push({ kind: "worktree", wt })
  }
  for (const sec of secs) {
    if (!placed.has(sec.id)) result.push({ kind: "section", section: sec })
  }
  for (const wt of ungrouped) {
    if (!placed.has(wt.id)) result.push({ kind: "worktree", wt })
  }
  return result
}

/**
 * Build the flat visual order of all sidebar items matching what the user sees.
 * LOCAL is always first, then worktrees in visual order (respecting section layout and
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
