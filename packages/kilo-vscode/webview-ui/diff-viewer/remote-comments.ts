import type { AnnotationSide } from "@pierre/diffs"
import type { PRComment } from "../agent-manager/pr/pr-types"
import type { WorktreeFileDiff } from "../src/types/messages"

export type RemoteSide = "additions" | "deletions"

type PatchLine = {
  mark: " " | "+" | "-"
  hunk: number
  text: string
  old: number
  next: number
}

type Patch = {
  lines: PatchLine[]
}

type Source = {
  text: string
  offsets: number[]
}

export interface RemoteCommentAnchor {
  file: string
  side: AnnotationSide
  line: number
  comments: PRComment[]
}

export interface RemoteCommentMap {
  anchors: Map<string, RemoteCommentAnchor[]>
  pending: Map<string, PRComment[]>
  outside: PRComment[]
}

export type RemoteLocation = "inline" | "outside" | "pending"

function parsePatch(value: string): Patch | undefined {
  const result: PatchLine[] = []
  let hunk = -1
  let old = 0
  let next = 0
  for (const [index, raw] of value.split("\n").entries()) {
    const match = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (match) {
      hunk = index
      old = Number(match[1])
      next = Number(match[3])
      continue
    }
    const mark = raw[0]
    if (hunk < 0 || (mark !== " " && mark !== "+" && mark !== "-")) continue
    result.push({ mark, hunk, text: raw.slice(1).replace(/\r$/, ""), old, next })
    if (mark !== "+") old += 1
    if (mark !== "-") next += 1
  }
  if (result.length === 0) return undefined
  return { lines: result }
}

function lineAt(source: Source, target: number): string | undefined {
  while (source.offsets.length <= target) {
    const start = source.offsets[source.offsets.length - 1]!
    if (start >= source.text.length) break
    const end = source.text.indexOf("\n", start)
    source.offsets.push(end < 0 ? source.text.length + 1 : end + 1)
  }
  const start = source.offsets[target - 1]
  if (start === undefined || start >= source.text.length) return undefined
  return source.text.slice(start, source.offsets[target]! - 1).replace(/\r$/, "")
}

function sideFromPatch(comment: PRComment, patch: Patch): RemoteSide | undefined {
  if (comment.side) return comment.side
  const line = comment.originalLine ?? comment.line ?? comment.startLine
  if (line === undefined) return undefined

  const additions = patch.lines.some((item) => item.next === line && item.mark === "+")
  const deletions = patch.lines.some((item) => item.old === line && item.mark === "-")
  if (additions === deletions) return undefined
  return deletions ? "deletions" : "additions"
}

function matchingLine(patch: Patch | undefined, side: RemoteSide, line: number, text: string) {
  return patch?.lines.find((item) => {
    if (side === "additions" && item.next !== line) return false
    if (side === "deletions" && item.old !== line) return false
    if (side === "additions" && item.mark !== "+" && item.mark !== " ") return false
    if (side === "deletions" && item.mark !== "-" && item.mark !== " ") return false
    return item.text === text
  })
}

function matchesPatch(
  comment: PRComment,
  diff: WorktreeFileDiff,
  side: RemoteSide,
  line: number,
  source: Source,
  hunk: Patch | undefined,
  visible: Patch | undefined,
): boolean {
  if (comment.diffHunk && !hunk) return false
  if (diff.patch && !visible) return false
  const text = lineAt(source, line)
  if (text === undefined || (visible && !matchingLine(visible, side, line, text))) return false
  if (!hunk) return true
  const origin = comment.originalLine ?? line
  const target = matchingLine(hunk, side, origin, text)
  if (!target) return false
  for (const item of hunk.lines) {
    if (item.hunk !== target.hunk) continue
    if (side === "additions" && item.mark === "-") continue
    if (side === "deletions" && item.mark === "+") continue
    const position = side === "additions" ? item.next : item.old
    if (lineAt(source, position + line - origin) !== item.text) return false
  }
  return true
}

function safeAnchor(
  comment: PRComment,
  diff: WorktreeFileDiff,
  visible: Patch | undefined,
  cache: Map<string, Source>,
): RemoteCommentAnchor | undefined {
  if (!comment.file || comment.outdated || diff.kind === "image" || diff.summarized === true || diff.failed)
    return undefined
  const hunk = comment.diffHunk ? parsePatch(comment.diffHunk) : undefined
  const side = comment.side ?? sideFromPatch(comment, hunk ?? visible ?? { lines: [] })
  if (!side) return undefined
  const line = comment.line ?? comment.startLine
  if (line === undefined || !Number.isInteger(line) || line < 1) return undefined

  const key = `${diff.file}:${side}`
  const source = cache.get(key) ?? { text: side === "deletions" ? diff.before : diff.after, offsets: [0] }
  cache.set(key, source)
  if (!matchesPatch(comment, diff, side, line, source, hunk, visible)) return undefined

  return { file: diff.file, side, line, comments: [comment] }
}

export function mapRemoteComments(comments: PRComment[], diffs: WorktreeFileDiff[]): RemoteCommentMap {
  const files = new Map(diffs.map((diff) => [diff.file, diff]))
  const anchors = new Map<string, RemoteCommentAnchor[]>()
  const pending = new Map<string, PRComment[]>()
  const outside: PRComment[] = []
  const seen = new Set<string>()
  const patches = new Map<string, Patch | undefined>()
  const cache = new Map<string, Source>()
  const patch = (diff: WorktreeFileDiff) => {
    if (!patches.has(diff.file)) patches.set(diff.file, diff.patch ? parsePatch(diff.patch) : undefined)
    return patches.get(diff.file)
  }

  for (const comment of comments) {
    if (seen.has(comment.threadId)) continue
    seen.add(comment.threadId)
    const diff = !comment.unmapped && comment.file ? files.get(comment.file) : undefined
    const line = comment.line ?? comment.startLine
    if (
      diff?.summarized === true &&
      !diff.failed &&
      diff.kind !== "image" &&
      !comment.outdated &&
      line !== undefined &&
      Number.isInteger(line) &&
      line > 0
    ) {
      const list = pending.get(diff.file) ?? []
      list.push(comment)
      pending.set(diff.file, list)
      continue
    }
    const anchor = diff ? safeAnchor(comment, diff, patch(diff), cache) : undefined
    if (!anchor) {
      outside.push(comment)
      continue
    }

    const list = anchors.get(anchor.file) ?? []
    const existing = list.find((item) => item.side === anchor.side && item.line === anchor.line)
    if (existing) existing.comments.push(comment)
    else list.push(anchor)
    anchors.set(anchor.file, list)
  }

  return { anchors, pending, outside }
}

export function remoteLocation(map: RemoteCommentMap, file: string, threadId: string): RemoteLocation {
  if (map.pending.get(file)?.some((comment) => comment.threadId === threadId)) return "pending"
  const anchors = map.anchors.get(file) ?? []
  return anchors.some((anchor) => anchor.comments.some((comment) => comment.threadId === threadId))
    ? "inline"
    : "outside"
}
