/**
 * Section computation helpers for the agent manager sidebar.
 * Pure functions — no solid-dnd dependency so they remain testable.
 */
import type { WorktreeState, SectionState } from "../src/types/messages"

export type TopLevelItem = { kind: "section"; section: SectionState } | { kind: "worktree"; wt: WorktreeState }

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
