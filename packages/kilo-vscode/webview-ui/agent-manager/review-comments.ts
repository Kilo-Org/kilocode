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

export function formatReviewCommentsMarkdown(comments: ReviewComment[]): string {
  const lines = ["## Review Comments", ""]
  for (const comment of comments) {
    lines.push(`**${comment.file}** (line ${comment.line}):`)
    if (comment.selectedText) {
      lines.push("```")
      lines.push(comment.selectedText)
      lines.push("```")
    }
    lines.push(comment.comment)
    lines.push("")
  }
  return lines.join("\n")
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
