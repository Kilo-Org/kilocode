import type { WorktreeFileDiff } from "../src/types/messages"

export const LONG_DIFF_MARKER_FILE_COUNT = 50
export const EXTREME_DIFF_CHANGED_LINES = 2_000
const MAX_EAGER_BYTES = 256 * 1024

export function isLargeDiffFile(diff: WorktreeFileDiff): boolean {
  return diff.additions + diff.deletions > EXTREME_DIFF_CHANGED_LINES
}

// The outer file-row virtualizer bounds the review DOM. Pierre only needs its
// nested line virtualizer when a single file is extreme or lacks a hunk patch.
export function shouldVirtualizeDiff(diff: WorktreeFileDiff): boolean {
  return (
    !diff.patch || isLargeDiffFile(diff) || diff.before.length > MAX_EAGER_BYTES || diff.after.length > MAX_EAGER_BYTES
  )
}

export function isDiffExpandable(diff: WorktreeFileDiff): boolean {
  return diff.kind === "image" || diff.summarized === true || Boolean(diff.patch || diff.before || diff.after)
}

export function sanitizeOpenFiles(diffs: WorktreeFileDiff[], open: string[]): string[] {
  const blocked = new Set(diffs.filter((diff) => !isDiffExpandable(diff)).map((diff) => diff.file))
  return open.filter((file) => !blocked.has(file))
}

export function expandableOpenFiles(diffs: WorktreeFileDiff[]): string[] {
  return diffs.filter(isDiffExpandable).map((diff) => diff.file)
}

function defaultOpenFiles(diffs: WorktreeFileDiff[]): string[] {
  return diffs
    .filter((diff) => diff.kind !== "image" && diff.generatedLike !== true && isDiffExpandable(diff))
    .map((diff) => diff.file)
}

export function initialOpenFiles(diffs: WorktreeFileDiff[]): string[] {
  return defaultOpenFiles(diffs)
}

export function reconcileOpenFiles(
  diffs: WorktreeFileDiff[],
  manual: string[] | undefined,
  known: string[] = [],
): { open: string[] | undefined; known: string[] } {
  const files = expandableOpenFiles(diffs)
  if (!manual) return { open: undefined, known: files }
  const previous = new Set(known)
  const defaults = new Set(defaultOpenFiles(diffs))
  const added = files.filter((file) => !previous.has(file) && defaults.has(file))
  return { open: sanitizeOpenFiles(diffs, [...manual, ...added]), known: files }
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
