import type { WorktreeFileDiff } from "../src/types/messages"

export function sameDiffMeta(left: WorktreeFileDiff, right: WorktreeFileDiff) {
  return (
    left.file === right.file &&
    left.status === right.status &&
    left.additions === right.additions &&
    left.deletions === right.deletions &&
    left.binary === right.binary &&
    left.tracked === right.tracked &&
    left.generatedLike === right.generatedLike &&
    left.summarized === right.summarized &&
    left.stamp === right.stamp
  )
}

function sameDiffSummary(left: WorktreeFileDiff, right: WorktreeFileDiff) {
  return sameDiffMeta({ ...left, summarized: true }, { ...right, summarized: true })
}

export function mergeWorktreeDiffs(prev: WorktreeFileDiff[], next: WorktreeFileDiff[]) {
  const map = new Map(prev.map((diff) => [diff.file, diff]))
  return next.map((diff) => {
    const existing = map.get(diff.file)
    if (!existing) return diff
    if (existing.summarized) return diff
    if (!diff.summarized) return diff
    if (!sameDiffSummary(existing, diff)) return diff
    return { ...diff, before: existing.before, after: existing.after, summarized: false }
  })
}

export function mergeWorktreeDiffDetail(prev: WorktreeFileDiff[], next: WorktreeFileDiff) {
  const existing = prev.find((diff) => diff.file === next.file)
  if (!existing) return prev
  if (!sameDiffSummary(existing, next)) return prev
  return prev.map((diff) => (diff.file === next.file ? next : diff))
}
