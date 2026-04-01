import type { WorktreeFileDiff } from "../src/types/messages"

export function sameDiffMeta(left: WorktreeFileDiff, right: WorktreeFileDiff) {
  return (
    left.file === right.file &&
    left.status === right.status &&
    left.additions === right.additions &&
    left.deletions === right.deletions &&
    left.tracked === right.tracked &&
    left.generatedLike === right.generatedLike &&
    left.summarized === right.summarized &&
    left.stamp === right.stamp
  )
}

export function mergeWorktreeDiffs(prev: WorktreeFileDiff[], next: WorktreeFileDiff[]) {
  const map = new Map(prev.map((diff) => [diff.file, diff]))
  return next.map((diff) => {
    const existing = map.get(diff.file)
    if (!existing) return diff
    if (existing.summarized) return diff
    if (!diff.summarized) return diff
    if (!sameDiffMeta({ ...existing, summarized: true }, diff)) return diff
    return { ...diff, before: existing.before, after: existing.after, summarized: false }
  })
}
