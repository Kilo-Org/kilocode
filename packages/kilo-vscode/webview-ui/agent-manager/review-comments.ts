import type { AnnotationSide } from "@pierre/diffs"
import type { WorktreeFileDiff } from "../src/types/messages"

export interface ReviewComment {
  id: string
  file: string
  side: AnnotationSide
  line: number
  comment: string
  selectedText: string
}

function lineCount(text: string): number {
  if (text.length === 0) return 0
  return text.split("\n").length
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
