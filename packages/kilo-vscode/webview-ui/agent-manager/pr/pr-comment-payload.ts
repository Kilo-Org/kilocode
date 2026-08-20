import { formatReviewCommentMarkdown, type PRReviewCommentData } from "../../../src/shared/review-comments"
import type { PRComment } from "./pr-types"

/** Caps so one talkative PR cannot blow up a prompt. */
const BODY = 4_000
const HUNK = 40
/** A generated or minified file can put the whole hunk on one line. */
const HUNK_CHARS = 8_000
const REPLIES = 5
/** Matches the comment limit enforced by the shared review payload parser. */
export const SEND_LIMIT = 100

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n...` : value
}

/** Keep the `@@` header and the tail: the commented line sits at the end. */
function trim(value: string): string {
  const lines = value.split("\n")
  const cut = lines.length <= HUNK ? lines : [lines[0]!, "...", ...lines.slice(-HUNK)]
  return clip(cut.join("\n"), HUNK_CHARS)
}

export function prPayload(comment: PRComment): PRReviewCommentData {
  const replies = (comment.replies ?? [])
    .slice(0, REPLIES)
    .map((reply) => ({ author: reply.author, body: clip(reply.body, BODY) }))
  return {
    id: comment.threadId,
    origin: "pr",
    author: comment.author,
    body: clip(comment.body, BODY),
    file: comment.file,
    line: comment.line,
    diffHunk: comment.diffHunk ? trim(comment.diffHunk) : undefined,
    outdated: comment.outdated || undefined,
    replies: replies.length > 0 ? replies : undefined,
  }
}

/** Only https urls reach the payload, the markdown, or `openExternal`. */
export function githubUrl(url?: string): string | undefined {
  return url?.startsWith("https://") ? url : undefined
}

/** The whole thread as markdown, for the copy action. */
export function prMarkdown(comment: PRComment): string {
  return formatReviewCommentMarkdown(prPayload(comment))
}

/** First meaningful line of a comment body, for the collapsed row. */
export function preview(body: string): string {
  const line = body.split("\n").find((item) => item.trim().length > 0) ?? ""
  return line.replace(/^[#>\-*\s`]+/, "").trim()
}
