import type { ReviewComment, WorktreeFileDiff } from "../src/types/messages"
import { formatReviewCommentMarkdown, formatReviewCommentsMarkdown } from "../src/utils/review-comment-markdown"

export type { ReviewComment }
export { formatReviewCommentsMarkdown }

function lineCount(text: string): number {
  if (text.length === 0) return 0
  return text.split("\n").length
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
  return content
    .split("\n")
    .slice(start - 1, end)
    .join("\n")
}

export function sanitizeReviewComments(comments: ReviewComment[], diffs: WorktreeFileDiff[]): ReviewComment[] {
  const map = new Map(diffs.map((diff) => [diff.file, diff]))
  return comments.filter((comment) => {
    const diff = map.get(comment.file)
    if (!diff) return false
    const content = comment.side === "deletions" ? diff.before : diff.after
    const max = lineCount(content)
    if (comment.line < 1) return false
    if (comment.line > max) return false
    return true
  })
}
