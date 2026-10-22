import type { ReviewComment, WorktreeFileDiff } from "../src/types/messages"
import { formatReviewCommentMarkdown, formatReviewCommentsMarkdown } from "../src/utils/review-comment-markdown"

export type { ReviewComment }
export { formatReviewCommentsMarkdown }

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

export function sanitizeReviewComments(comments: ReviewComment[], diffs: WorktreeFileDiff[]): ReviewComment[] {
  const map = new Map(diffs.map((diff) => [diff.file, diff]))
  return comments.filter((comment) => {
    const diff = map.get(comment.file)
    if (!diff) return false
    const content = comment.side === "deletions" ? diff.before : diff.after
    if (diff.summarized === true) return true
    const max = lineCount(content)
    if (comment.line < 1) return false
    if (comment.line > max) return false
    return true
  })
}
