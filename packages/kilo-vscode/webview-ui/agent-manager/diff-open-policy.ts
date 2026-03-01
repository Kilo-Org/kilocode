import type { WorktreeFileDiff } from "../src/types/messages"

export const LONG_DIFF_MARKER_FILE_COUNT = 50
export const LARGE_FILE_CHANGED_LINES = 400

export function isLargeDiffFile(diff: WorktreeFileDiff): boolean {
  return diff.additions + diff.deletions > LARGE_FILE_CHANGED_LINES
}

export function initialOpenFiles(diffs: WorktreeFileDiff[]): string[] {
  if (diffs.length === 0) return []

  const files = diffs.filter((diff) => !isLargeDiffFile(diff)).map((diff) => diff.file)
  return files
}
