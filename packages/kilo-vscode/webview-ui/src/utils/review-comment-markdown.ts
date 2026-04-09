import type { ReviewComment } from "../types/messages"

function escapeInline(value: string): string {
  return value.replace(/([\\`*_\[\]{}()#+\-!|])/g, "\\$1")
}

function fenceFor(value: string): string {
  const matches = value.match(/`+/g) ?? []
  const longest = matches.reduce((max, item) => Math.max(max, item.length), 0)
  return "`".repeat(Math.max(3, longest + 1))
}

function formatCode(value: string): string[] {
  const fence = fenceFor(value)
  return [fence, value, fence]
}

export function formatReviewCommentMarkdown(comment: ReviewComment): string {
  const lines = [`**${escapeInline(comment.file)}** (line ${comment.line}):`]
  if (comment.selectedText) {
    lines.push(...formatCode(comment.selectedText))
  }
  lines.push(comment.comment)
  return lines.join("\n")
}

export function formatReviewCommentsMarkdown(comments: ReviewComment[]): string {
  const lines = ["## Review Comments", ""]
  for (const item of comments) {
    lines.push(formatReviewCommentMarkdown(item), "")
  }
  return lines.join("\n").trimEnd()
}
