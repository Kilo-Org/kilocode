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

export interface MergeResult {
  diffs: WorktreeFileDiff[]
  /** Files whose metadata changed while we preserved cached content.
   *  The caller should re-request fresh content for these. */
  stale: Set<string>
}

export function mergeWorktreeDiffs(prev: WorktreeFileDiff[], next: WorktreeFileDiff[]): MergeResult {
  const map = new Map(prev.map((diff) => [diff.file, diff]))
  const stale = new Set<string>()
  const diffs = next.map((diff) => {
    const existing = map.get(diff.file)
    if (!existing) return diff
    // Preserve referential identity when content hasn't changed — this
    // prevents Solid's <For> from re-rendering unchanged <Diff> components,
    // which avoids Pierre's full DOM teardown and the scroll reset it causes.
    if (
      existing.file === diff.file &&
      existing.before === diff.before &&
      existing.after === diff.after &&
      sameDiffMeta(existing, diff)
    )
      return existing
    if (existing.summarized) return diff
    if (!diff.summarized) return diff
    // Metadata matches — restore cached content as before.
    if (sameDiffMeta({ ...existing, summarized: true }, diff)) {
      const merged = { ...diff, before: existing.before, after: existing.after, summarized: false }
      if (existing.before === merged.before && existing.after === merged.after && sameDiffMeta(existing, merged))
        return existing
      return merged
    }
    // Metadata changed (agent edited the file) but we have cached content.
    // Keep the existing reference so <For> doesn't re-render and cause a
    // scroll jump. Track the file as stale so the caller re-requests fresh
    // content. The header stats will be slightly behind until the detail
    // arrives, which is an acceptable trade-off for scroll stability.
    stale.add(diff.file)
    return existing
  })
  return { diffs, stale }
}
