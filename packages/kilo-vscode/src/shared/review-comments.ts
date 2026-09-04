export interface ReviewCommentData {
  id: string
  file: string
  side: "additions" | "deletions"
  line: number
  comment: string
  selectedText: string
}

export interface PRReviewReply {
  author: string
  body: string
  avatar?: string
}

/** A GitHub PR review thread handed to the agent from the Agent Manager PR panel. */
export interface PRReviewCommentData {
  id: string
  origin: "pr"
  author: string
  avatar?: string
  body: string
  file?: string
  side?: "additions" | "deletions"
  line?: number
  originalLine?: number
  startLine?: number
  url?: string
  resolved?: boolean
  diffHunk?: string
  outdated?: boolean
  reviewState?: string
  replies?: PRReviewReply[]
}

export type ReviewCommentEntry = ReviewCommentData | PRReviewCommentData

export function isPRReviewComment(item: ReviewCommentEntry): item is PRReviewCommentData {
  return "origin" in item && item.origin === "pr"
}

export interface ReviewMessageData {
  version: 1
  comments: ReviewCommentEntry[]
}

interface ReviewMessageView {
  data: ReviewMessageData
  body: string
}

const LIMIT = 100
const TOTAL_LIMIT = 1_000_000
const TEXT_LIMIT = 100_000
const SELECTION_LIMIT = 200_000
const AUTHOR_LIMIT = 256
const REPLY_LIMIT = 20

function escapeInline(value: string): string {
  return value.replace(/([\\`*_\[\]{}()#+\-!|])/g, "\\$1")
}

/** Wrap a snippet in a fence long enough to survive backticks inside it. */
export function fenced(value: string): string[] {
  const matches = value.match(/`+/g) ?? []
  const longest = matches.reduce((max, item) => Math.max(max, item.length), 0)
  const fence = "`".repeat(Math.max(3, longest + 1))
  return [fence, value, fence]
}

function quote(value: string): string {
  return value
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
}

function formatPR(comment: PRReviewCommentData): string {
  const kind = comment.reviewState ? `PR review (${comment.reviewState.replace("_", " ")})` : "PR comment"
  const at = comment.file
    ? `**${escapeInline(comment.file)}**${comment.line ? ` (line ${comment.line})` : ""}, ${kind}`
    : kind
  const lines = [`${at} by @${comment.author}${comment.outdated ? " (outdated)" : ""}:`]
  if (comment.diffHunk) lines.push(...fenced(comment.diffHunk))
  lines.push(comment.body)
  for (const reply of comment.replies ?? []) lines.push("", quote(`@${reply.author}: ${reply.body}`))
  return lines.join("\n")
}

export function formatReviewCommentMarkdown(comment: ReviewCommentEntry): string {
  if (isPRReviewComment(comment)) return formatPR(comment)
  const lines = [`**${escapeInline(comment.file)}** (line ${comment.line}):`]
  if (comment.selectedText) lines.push(...fenced(comment.selectedText))
  lines.push(comment.comment)
  return lines.join("\n")
}

export function formatReviewCommentsMarkdown(comments: ReviewCommentEntry[]): string {
  const lines = ["## Review Comments", ""]
  for (const item of comments) {
    lines.push(formatReviewCommentMarkdown(item), "")
  }
  return lines.join("\n").trimEnd()
}

export function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

export function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string" || value.length > limit) return undefined
  return value
}

function safe(file: string): boolean {
  const absolute = file.startsWith("/") || file.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(file)
  const traversal = file.split(/[\\/]/).includes("..")
  return !absolute && !traversal && !file.includes("\0")
}

export function isHttpsUrl(value: string): boolean {
  return value.startsWith("https://") && URL.canParse(value)
}

function parseReply(value: unknown): PRReviewReply | undefined {
  const item = record(value)
  if (!item) return undefined
  const author = text(item.author, AUTHOR_LIMIT)
  const body = text(item.body, TEXT_LIMIT)
  const avatar = optional(item.avatar, TEXT_LIMIT, isHttpsUrl)
  if (!author || body === undefined || avatar === false) return undefined
  return avatar === undefined ? { author, body } : { author, body, avatar }
}

function parseReplies(value: unknown): PRReviewReply[] | undefined {
  if (!Array.isArray(value) || value.length > REPLY_LIMIT) return undefined
  const list: PRReviewReply[] = []
  for (const item of value) {
    const reply = parseReply(item)
    if (!reply) return undefined
    list.push(reply)
  }
  return list
}

/** Optional PR field: `undefined` when absent, `false` when present but invalid. */
function optional(value: unknown, limit: number, valid?: (item: string) => boolean): string | false | undefined {
  if (value === undefined) return undefined
  const item = text(value, limit)
  if (item === undefined) return false
  if (valid && !valid(item)) return false
  return item
}

export function optionalLine(value: unknown): number | false | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return false
  return value
}

function position(
  item: Record<string, unknown>,
): Pick<PRReviewCommentData, "file" | "side" | "line" | "originalLine" | "startLine"> | undefined {
  const file = optional(item.file, 4_096, safe)
  const side = item.side
  if (side !== undefined && side !== "additions" && side !== "deletions") return
  const line = optionalLine(item.line)
  const originalLine = optionalLine(item.originalLine)
  const startLine = optionalLine(item.startLine)
  if (file === false || line === false || originalLine === false || startLine === false) return
  return {
    file,
    ...(side === undefined ? {} : { side }),
    line,
    ...(originalLine === undefined ? {} : { originalLine }),
    ...(startLine === undefined ? {} : { startLine }),
  }
}

function parsePR(item: Record<string, unknown>): PRReviewCommentData | undefined {
  const id = text(item.id, 512)
  const author = text(item.author, AUTHOR_LIMIT)
  const body = text(item.body, TEXT_LIMIT)
  const place = position(item)
  const avatar = optional(item.avatar, TEXT_LIMIT, isHttpsUrl)
  const hunk = optional(item.diffHunk, SELECTION_LIMIT)
  const url = optional(item.url, TEXT_LIMIT, isHttpsUrl)
  if (!id || !author || body === undefined || !place) return undefined
  if (avatar === false || hunk === false || url === false) return undefined
  if (item.outdated !== undefined && typeof item.outdated !== "boolean") return undefined
  if (item.resolved !== undefined && typeof item.resolved !== "boolean") return undefined
  const reviewState = optional(item.reviewState, 64)
  if (reviewState === false) return undefined

  const replies = item.replies === undefined ? undefined : parseReplies(item.replies)
  if (item.replies !== undefined && !replies) return undefined

  return {
    id,
    origin: "pr",
    author,
    ...(avatar === undefined ? {} : { avatar }),
    body,
    ...place,
    ...(url === undefined ? {} : { url }),
    ...(item.resolved === undefined ? {} : { resolved: item.resolved }),
    diffHunk: hunk,
    outdated: item.outdated,
    reviewState: reviewState || undefined,
    replies,
  }
}

function parseComment(value: unknown): ReviewCommentEntry | undefined {
  const item = record(value)
  if (!item) return undefined
  if (item.origin === "pr") return parsePR(item)
  if (item.origin !== undefined) return undefined

  const id = text(item.id, 512)
  const file = text(item.file, 4_096)
  const comment = text(item.comment, TEXT_LIMIT)
  const selectedText = text(item.selectedText, SELECTION_LIMIT)
  const side = item.side
  const line = item.line
  if (!id || !file || comment === undefined || selectedText === undefined) return undefined
  if (!safe(file)) return undefined
  if (side !== "additions" && side !== "deletions") return undefined
  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) return undefined

  return { id, file, side, line, comment, selectedText }
}

function weight(item: ReviewCommentEntry): number {
  if (!isPRReviewComment(item))
    return item.id.length + item.file.length + item.comment.length + item.selectedText.length
  const replies = (item.replies ?? []).reduce(
    (total, reply) => total + reply.author.length + reply.body.length + (reply.avatar?.length ?? 0),
    0,
  )
  return (
    item.id.length +
    item.author.length +
    item.body.length +
    (item.file?.length ?? 0) +
    (item.avatar?.length ?? 0) +
    (item.url?.length ?? 0) +
    (item.diffHunk?.length ?? 0) +
    replies
  )
}

function view(value: unknown, content: string): ReviewMessageView | undefined {
  const data = record(value)
  if (!data || data.version !== 1 || !Array.isArray(data.comments)) return undefined
  if (data.comments.length === 0 || data.comments.length > LIMIT) return undefined

  const comments: ReviewCommentEntry[] = []
  for (const value of data.comments) {
    const item = parseComment(value)
    if (!item) return undefined
    comments.push(item)
  }
  const size = comments.reduce((total, item) => total + weight(item), 0)
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

export function partReview(metadata: unknown, content: string): ReviewMessageView | undefined {
  const root = record(metadata)
  const kilo = record(root?.kilo)
  return view(kilo?.review, content)
}
