export interface ReviewCommentData {
  id: string
  file: string
  side: "additions" | "deletions"
  line: number
  comment: string
  selectedText: string
}

export interface ReviewMessageData {
  version: 1
  comments: ReviewCommentData[]
}

interface ReviewMessageView {
  data: ReviewMessageData
  body: string
}

const LIMIT = 100
const TOTAL_LIMIT = 1_000_000
const TEXT_LIMIT = 100_000
const SELECTION_LIMIT = 200_000

function escapeInline(value: string): string {
  return value.replace(/([\\`*_\[\]{}()#+\-!|])/g, "\\$1")
}

export function formatReviewCommentMarkdown(comment: ReviewCommentData): string {
  const lines = [`**${escapeInline(comment.file)}** (line ${comment.line}):`]
  if (comment.selectedText) {
    const matches = comment.selectedText.match(/`+/g) ?? []
    const longest = matches.reduce((max, item) => Math.max(max, item.length), 0)
    const fence = "`".repeat(Math.max(3, longest + 1))
    lines.push(fence, comment.selectedText, fence)
  }
  lines.push(comment.comment)
  return lines.join("\n")
}

export function formatReviewCommentsMarkdown(comments: ReviewCommentData[]): string {
  const lines = ["## Review Comments", ""]
  for (const item of comments) {
    lines.push(formatReviewCommentMarkdown(item), "")
  }
  return lines.join("\n").trimEnd()
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string" || value.length > limit) return undefined
  return value
}

function parseComment(value: unknown): ReviewCommentData | undefined {
  const item = record(value)
  if (!item) return undefined

  const id = text(item.id, 512)
  const file = text(item.file, 4_096)
  const comment = text(item.comment, TEXT_LIMIT)
  const selectedText = text(item.selectedText, SELECTION_LIMIT)
  const side = item.side
  const line = item.line
  if (!id || !file || comment === undefined || selectedText === undefined) return undefined
  const absolute = file.startsWith("/") || file.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(file)
  const traversal = file.split(/[\\/]/).includes("..")
  if (absolute || traversal || file.includes("\0")) return undefined
  if (side !== "additions" && side !== "deletions") return undefined
  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) return undefined

  return { id, file, side, line, comment, selectedText }
}

function view(value: unknown, content: string): ReviewMessageView | undefined {
  const data = record(value)
  if (!data || data.version !== 1 || !Array.isArray(data.comments)) return undefined
  if (data.comments.length === 0 || data.comments.length > LIMIT) return undefined

  const comments: ReviewCommentData[] = []
  for (const value of data.comments) {
    const item = parseComment(value)
    if (!item) return undefined
    comments.push(item)
  }
  const size = comments.reduce(
    (total, item) => total + item.id.length + item.file.length + item.comment.length + item.selectedText.length,
    0,
  )
  if (size > TOTAL_LIMIT) return undefined

  const prefix = formatReviewCommentsMarkdown(comments)
  if (content === prefix) return { data: { version: 1, comments }, body: "" }
  if (!content.startsWith(`${prefix}\n\n`)) return undefined
  return { data: { version: 1, comments }, body: content.slice(prefix.length + 2) }
}

export function parseReview(value: unknown, content: string): ReviewMessageData | undefined {
  return view(value, content)?.data
}

export function reviewMetadata(review: ReviewMessageData): Record<string, unknown> {
  return { kilo: { review } }
}

export function reviewBody(review: ReviewMessageData, content: string): string | undefined {
  return view(review, content)?.body
}

export function partReview(metadata: unknown, content: string): ReviewMessageView | undefined {
  const root = record(metadata)
  const kilo = record(root?.kilo)
  return view(kilo?.review, content)
}
