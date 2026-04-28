import type { WorktreeFileDiff } from "../src/types/messages"

export const LONG_DIFF_MARKER_FILE_COUNT = 50
const AUTO_OPEN_FILE_COUNT = 25
const AUTO_OPEN_LIMIT = 8
const LARGE_FILE_CHANGED_LINES = 400

export function isLargeDiffFile(diff: WorktreeFileDiff): boolean {
  return diff.additions + diff.deletions > LARGE_FILE_CHANGED_LINES
}

export function initialOpenFiles(diffs: WorktreeFileDiff[]): string[] {
  if (diffs.length === 0) return []
  if (diffs.length > AUTO_OPEN_FILE_COUNT) return []

  const files = diffs
    .filter((diff) => !isLargeDiffFile(diff) && diff.generatedLike !== true)
    .slice(0, AUTO_OPEN_LIMIT)
    .map((diff) => diff.file)
  return files
}
