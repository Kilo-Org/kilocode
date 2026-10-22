export const PATCH_LIMIT = 256 * 1024

const WINDOW = 3
const LIMIT = 8 * 1024
const encoder = new TextEncoder()

type Row = { text: string; old: number; next: number; eof?: boolean }
type Hunk = {
  old: { line: number; end: number }
  next: { line: number; end: number }
  rows: Row[]
}

export function oid(value: unknown): value is string {
  return typeof value === "string" && /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(value)
}

function coordinate(start: string, count = "1") {
  const line = Number(start)
  const size = Number(count)
  if (!Number.isSafeInteger(line + size) || (size > 0 && line < 1)) return undefined
  const first = size === 0 ? line + 1 : line
  if (!Number.isSafeInteger(first + size)) return undefined
  return { line: first, end: first + size }
}

function header(text: string, previous?: Hunk): Hunk | undefined {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(text)
  if (!match) return undefined
  const old = coordinate(match[1]!, match[2])
  const next = coordinate(match[3]!, match[4])
  if (!old || !next || (old.line === old.end && next.line === next.end)) return undefined
  if (previous && (old.line < previous.old.end || next.line < previous.next.end)) return undefined
  return { old, next, rows: [] }
}

function complete(hunk: Hunk): boolean {
  return hunk.old.line === hunk.old.end && hunk.next.line === hunk.next.end
}

function append(hunk: Hunk, text: string): boolean {
  if (text === "\\ No newline at end of file") {
    const last = hunk.rows.at(-1)
    if (!last || last.eof) return false
    last.eof = true
    return true
  }
  const mark = text[0]
  if (mark !== " " && mark !== "+" && mark !== "-") return false
  hunk.rows.push({ text, old: hunk.old.line, next: hunk.next.line })
  if (mark !== "+") hunk.old.line++
  if (mark !== "-") hunk.next.line++
  return hunk.old.line <= hunk.old.end && hunk.next.line <= hunk.next.end
}

export function parse(value: string, counts?: { additions: number; deletions: number }) {
  if (value.length > PATCH_LIMIT || encoder.encode(value).length > PATCH_LIMIT) return undefined
  const lines = value.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const hunks: Hunk[] = []
  let files = 0
  for (const text of lines) {
    const current = hunks.at(-1)
    if (text.startsWith("@@")) {
      if (current && !complete(current)) return undefined
      const hunk = header(text, current)
      if (!hunk) return undefined
      hunks.push(hunk)
      continue
    }
    if (current) {
      if (!append(current, text)) return undefined
      continue
    }
    if (text.startsWith("diff --git ")) {
      if (++files > 1) return undefined
      continue
    }
    if (
      !/^(?:index |--- |\+\+\+ |(?:old|new) mode |(?:new|deleted) file mode |(?:dis)?similarity index |(?:rename|copy) (?:from|to) )/.test(
        text,
      )
    ) {
      return undefined
    }
  }
  const last = hunks.at(-1)
  if (!last || !complete(last)) return undefined
  const additions = hunks.reduce((total, hunk) => total + hunk.rows.filter((row) => row.text[0] === "+").length, 0)
  const deletions = hunks.reduce((total, hunk) => total + hunk.rows.filter((row) => row.text[0] === "-").length, 0)
  if (counts && (counts.additions !== additions || counts.deletions !== deletions)) return undefined
  return { hunks, additions, deletions }
}

function window(rows: Row[]) {
  const first = rows.at(0)!
  const removed = rows.filter((row) => row.text[0] !== "+").length
  const added = rows.filter((row) => row.text[0] !== "-").length
  const old = first.old - (removed === 0 ? 1 : 0)
  const next = first.next - (added === 0 ? 1 : 0)
  const text = rows.map((row) => row.text + (row.eof ? "\n\\ No newline at end of file" : "")).join("\n")
  return `@@ -${old},${removed} +${next},${added} @@\n${text}`
}

export function preview(patch: NonNullable<ReturnType<typeof parse>>, line: number, side: "additions" | "deletions") {
  if (!Number.isSafeInteger(line) || line < 1) return undefined
  const key = side === "deletions" ? "old" : "next"
  const skip = side === "deletions" ? "+" : "-"
  for (const [index, hunk] of patch.hunks.entries()) {
    const target = hunk.rows.findIndex((row) => row[key] === line && row.text[0] !== skip)
    if (target < 0) continue
    let start = Math.max(0, target - WINDOW)
    let end = Math.min(hunk.rows.length, target + WINDOW + 1)
    while (true) {
      const value = window(hunk.rows.slice(start, end))
      if (encoder.encode(value).length <= LIMIT) {
        return {
          patch: value,
          line,
          side,
          top: index > 0 || start > 0,
          bottom: index < patch.hunks.length - 1 || end < hunk.rows.length,
        }
      }
      if (start === target && end === target + 1) return undefined
      if (target - start >= end - target - 1) {
        start++
        continue
      }
      end--
    }
  }
  return undefined
}
