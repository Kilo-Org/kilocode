import { formatReviewCommentMarkdown, type PRReviewCommentData } from "../../../src/shared/review-comments"
import type { PRComment } from "./pr-types"

/** Caps so one talkative PR cannot blow up a prompt. */
const BODY = 4_000
const HUNK = 40
/**
 * GitHub truncates `diffHunk` at the commented line, and its length swings from
 * a few lines to a whole added file. The panel and the agent payload each use a
 * fixed window around that line so every comment reads at the same size.
 * The card shows the four lines GitHub shows, then continues with worktree
 * context so a comment about what happens next is readable; the agent gets more.
 */
const VIEW = { before: 3, after: 3 }
const SEND = { before: 24, after: 8 }
/** A generated or minified file can put the whole hunk on one line. */
const HUNK_CHARS = 8_000
const REPLIES = 5
/** Matches the comment limit enforced by the shared review payload parser. */
export const SEND_LIMIT = 100

type HunkLine = {
  text: string
  old: number
  next: number
}

type HunkView = {
  header: string
  lines: HunkLine[]
  patch: string
  top: boolean
  bottom: boolean
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n...` : value
}

function parseHunk(value: string): { header: string; lines: HunkLine[] } | undefined {
  const source = value.split("\n")
  const match = source[0]?.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/)
  if (!match) return undefined

  let old = Number(match[1])
  let next = Number(match[3])
  const lines: HunkLine[] = []
  for (const [index, raw] of source.slice(1).entries()) {
    if (raw === "" && index === source.length - 2) continue
    if (raw.startsWith("\\")) continue
    const text = raw === "" ? " " : raw
    const mark = text[0]
    if (mark !== " " && mark !== "+" && mark !== "-") return undefined
    const item = { text, old, next }
    lines.push(item)
    if (mark !== "+") old++
    if (mark !== "-") next++
  }

  return {
    header: `@@ -${match[1]}${match[2] ? `,${match[2]}` : ""} +${match[3]}${match[4] ? `,${match[4]}` : ""} @@${match[5]}`,
    lines,
  }
}

function range(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`
}

function patch(header: string, lines: HunkLine[]): string {
  const first = lines[0]
  if (!first) return header
  const oldCount = lines.filter((line) => line.text[0] !== "+").length
  const nextCount = lines.filter((line) => line.text[0] !== "-").length
  const suffix = header.slice(header.lastIndexOf("@@") + 2)
  const title = `@@ -${range(first.old, oldCount)} +${range(first.next, nextCount)} @@${suffix}`
  return `${title}\n${lines.map((line) => line.text).join("\n")}`
}

/** Index of the line the comment was written against, or the end of the hunk. */
function target(lines: HunkLine[], line?: number): number {
  if (!line) return lines.length - 1
  const added = lines.findIndex((item) => item.next === line && item.text[0] === "+")
  if (added >= 0) return added
  const removed = lines.findIndex((item) => item.old === line && item.text[0] === "-")
  if (removed >= 0) return removed
  const kept = lines.findIndex((item) => item.next === line && item.text[0] === " ")
  return kept >= 0 ? kept : lines.length - 1
}

/**
 * Continue the hunk with lines read from the worktree. A hunk stops at the
 * commented line, so a comment about what happens next has nothing to show
 * without them, and they are unmodified code: context lines, never additions.
 */
function extend(lines: HunkLine[], after: string[], count: number): HunkLine[] {
  const last = lines.at(-1)
  if (!last || count === 0) return lines
  const start =
    last.text[0] === "-"
      ? { old: last.old + 1, next: last.next }
      : last.text[0] === "+"
        ? { old: last.old, next: last.next + 1 }
        : { old: last.old + 1, next: last.next + 1 }
  return [
    ...lines,
    ...after
      .slice(0, count)
      .map((text, index) => ({ text: ` ${text}`, old: start.old + index, next: start.next + index })),
  ]
}

/** Fixed-size window around the commented line, independent of hunk length. */
function crop(
  value: string,
  line: number | undefined,
  window: { before: number; after: number },
  after?: string[],
): HunkView {
  const parsed = parseHunk(value)
  if (!parsed || parsed.lines.length === 0) {
    return { header: "", lines: [], patch: value, top: false, bottom: false }
  }
  const index = target(parsed.lines, line)
  const start = Math.max(0, index - window.before)
  const end = Math.min(parsed.lines.length, index + window.after + 1)
  const room = window.after - (end - index - 1)
  const tail = end === parsed.lines.length && after?.length && room > 0 ? after : []
  const lines = extend(parsed.lines.slice(start, end), tail, Math.min(room, tail.length))
  return {
    header: parsed.header,
    lines,
    patch: patch(parsed.header, lines),
    top: start > 0,
    bottom: end < parsed.lines.length || tail.length > 0,
  }
}

/** Bounded context rendered inside a comment card. */
export function displayHunk(value: string, line?: number, after?: string[]): HunkView {
  return crop(value, line, VIEW, after)
}

/** Keep the `@@` header and the comment context when formatting agent input. */
function trim(value: string, line?: number, after?: string[]): string {
  const view = crop(value, line, SEND, after)
  if (view.lines.length === 0) return trimFallback(value)
  if (!view.top && !view.bottom) return clip(value, HUNK_CHARS)
  const body = view.patch.split("\n")
  const lines = [body[0]!, ...(view.top ? ["..."] : []), ...body.slice(1), ...(view.bottom ? ["..."] : [])]
  return clip(lines.join("\n"), HUNK_CHARS)
}

/** Keep the `@@` header and the tail for malformed hunks without line metadata. */
function trimFallback(value: string): string {
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
    diffHunk: comment.diffHunk ? trim(comment.diffHunk, comment.line, comment.after) : undefined,
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
