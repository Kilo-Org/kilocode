import type { ReviewComment, WorktreeFileDiff } from "../src/types/messages"
import { parsePatch, type Range } from "../../src/shared/pr-patch"
import { formatReviewCommentMarkdown, formatReviewCommentsMarkdown } from "../src/utils/review-comment-markdown"

export type { ReviewComment }
export { formatReviewCommentsMarkdown }

const patches = new WeakMap<WorktreeFileDiff, { patch: string; ranges: Range[] | undefined }>()

export function lineCount(text: string): number {
  if (text.length === 0) return 0
  let n = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

export function getDirectory(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx === -1 ? "" : path.slice(0, idx + 1)
}

export function getFilename(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx === -1 ? path : path.slice(idx + 1)
}

export function extractLines(content: string, start: number, end: number): string {
  let line = 1
  let i = 0
  while (line < start && i < content.length) {
    if (content.charCodeAt(i) === 10) line++
    i++
  }
  const begin = i
  while (i < content.length) {
    if (content.charCodeAt(i) === 10) {
      if (line >= end) return content.slice(begin, i)
      line++
    }
    i++
  }
  return content.slice(begin, i)
}

export function isReviewRangeValid(
  diff: WorktreeFileDiff,
  side: ReviewComment["side"],
  start: number,
  end = start,
): boolean {
  if (start < 1 || end < start) return false
  if (diff.summarized === true) return true
  if (diff.patch) {
    // Session diff text contains only hunk excerpts, not complete file contents.
    let cached = patches.get(diff)
    if (cached?.patch !== diff.patch) {
      cached = { patch: diff.patch, ranges: parsePatch(diff.patch)?.ranges }
      patches.set(diff, cached)
    }
    const target = side === "deletions" ? "LEFT" : "RIGHT"
    return cached.ranges?.some((range) => range.side === target && start >= range.start && end <= range.end) ?? false
  }
  return end <= lineCount(side === "deletions" ? diff.before : diff.after)
}

export function sanitizeReviewComments(comments: ReviewComment[], diffs: WorktreeFileDiff[]): ReviewComment[] {
  const map = new Map(diffs.map((diff) => [diff.file, diff]))
  return comments.filter((comment) => {
    const diff = map.get(comment.file)
    return !!diff && isReviewRangeValid(diff, comment.side, comment.line)
  })
}
