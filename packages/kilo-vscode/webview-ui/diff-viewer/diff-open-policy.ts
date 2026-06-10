import type { WorktreeFileDiff } from "../src/types/messages"

export const LONG_DIFF_MARKER_FILE_COUNT = 50
export const EXTREME_DIFF_CHANGED_LINES = 2_000
// Total changed rows rendered eagerly (non-virtualized) across one review before
// the remainder falls back to virtualization. Bounds eager DOM for huge reviews
// while letting normal reviews render fully so scrolling never shows gap buffers.
export const EAGER_DIFF_REVIEW_LINES = 8_000

export function isLargeDiffFile(diff: WorktreeFileDiff): boolean {
  return diff.additions + diff.deletions > EXTREME_DIFF_CHANGED_LINES
}

// Files whose hunk-bounded patches should render eagerly (no row virtualization)
// so their rows stay mounted and never re-render on scroll. Never eager-render a
// detail without a patch: a tiny change in a very large source file would make
// Pierre re-diff and render full before/after contents on the main thread.
export function eagerDiffFiles(diffs: WorktreeFileDiff[]): Set<string> {
  const eager = new Set<string>()
  let used = 0
  for (const diff of diffs) {
    if (!diff.patch || isLargeDiffFile(diff)) continue
    const size = diff.additions + diff.deletions
    if (used + size > EAGER_DIFF_REVIEW_LINES) continue
    used += size
    eager.add(diff.file)
  }
  return eager
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
