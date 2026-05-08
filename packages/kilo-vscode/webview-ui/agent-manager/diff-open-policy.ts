import type { WorktreeFileDiff } from "../src/types/messages"

export const LONG_DIFF_MARKER_FILE_COUNT = 50
export const EXTREME_DIFF_CHANGED_LINES = 2_000

export function isLargeDiffFile(diff: WorktreeFileDiff): boolean {
  return diff.additions + diff.deletions > EXTREME_DIFF_CHANGED_LINES
}

export function expandableOpenFiles(diffs: WorktreeFileDiff[]): string[] {
  return diffs.filter((diff) => !isLargeDiffFile(diff) && diff.generatedLike !== true).map((diff) => diff.file)
}

export function initialOpenFiles(diffs: WorktreeFileDiff[]): string[] {
  return expandableOpenFiles(diffs)
}

export function allOpenFiles(diffs: WorktreeFileDiff[], open: string[]): boolean {
  const targets = expandableOpenFiles(diffs)
  if (targets.length === 0) return false
  const files = new Set(open)
  return targets.every((file) => files.has(file))
}

export function toggleOpenFiles(diffs: WorktreeFileDiff[], open: string[]): string[] {
  if (allOpenFiles(diffs, open)) return []
  return expandableOpenFiles(diffs)
}
