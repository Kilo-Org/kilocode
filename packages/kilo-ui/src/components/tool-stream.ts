export type ChangeCount = { additions: number; deletions: number }

/** Streamed fields that count while their string is still open. */
const LIVE = new Set(["content", "command", "oldString", "newString", "patchText"])
/** Fields whose streamed text is large: only their strings feed the count, so they never reach the card. */
const HIDDEN = new Set(["content", "oldString", "newString", "patchText", "edits"])
/** Tools whose complete input can show a change count before the final diff arrives. */
const COUNTED = new Set(["write", "edit", "patch"])
const CHARS = 2400

const INTERVAL = 50
const MAX_INTERVAL = 400
const CHUNK = 32_000

/**
 * The input a card may show for a tool that is still streaming, plus the
 * provisional change count derived from it. Large text fields stay hidden and
 * only feed the count, so a card never renders a half-written file body.
 */
export function streamedTool(tool: string, raw: string): { input: Record<string, unknown>; changes?: ChangeCount } {
  const input = partial(raw, LIVE)
  if (!input) return { input: {} }
  return { input: shape(input), changes: inputChanges(tool, input) }
}

/**
 * A provisional count from a complete tool input. It can differ from the final
 * diff because of context, `replaceAll`, or formatting, and the final diff
 * replaces it at completion.
 */
export function inputChanges(tool: string, input: Record<string, unknown>): ChangeCount | undefined {
  if (!COUNTED.has(tool)) return undefined
  if (tool === "write") {
    const content = input.content
    return typeof content === "string" ? { additions: lines(content), deletions: 0 } : undefined
  }
  if (tool === "edit") {
    const before = input.oldString
    const after = input.newString
    if (typeof before !== "string" && typeof after !== "string") return undefined
    return {
      additions: lines(typeof after === "string" ? after : ""),
      deletions: lines(typeof before === "string" ? before : ""),
    }
  }
  const text = input.patchText
  return typeof text === "string" ? patchCount(text) : undefined
}

/** Re-parsing the whole accumulated input is linear, so the interval grows with it. */
export function streamInterval(size: number) {
  return Math.min(MAX_INTERVAL, INTERVAL * Math.max(1, Math.floor(size / CHUNK)))
}

function shape(input: Record<string, unknown>) {
  const shown: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (HIDDEN.has(key)) continue
    shown[key] = typeof value === "string" && value.length > CHARS ? value.slice(0, CHARS) : value
  }
  return shown
}

/** Count lines like a final diff: a trailing newline does not start a new line. */
function lines(text: string) {
  if (!text) return 0
  let count = text.endsWith("\n") ? 0 : 1
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) count++
  return count
}

/**
 * Count change lines in a streamed patch. The `***` and `@@` markers do not
 * start with `+` or `-`, so every change line counts, including one whose
 * content itself begins with `--` or `++`.
 */
function patchCount(text: string): ChangeCount {
  let additions = 0
  let deletions = 0
  for (const line of text.split("\n")) {
    if (line.startsWith("+")) additions++
    else if (line.startsWith("-")) deletions++
  }
  return { additions, deletions }
}

/**
 * A streamed tool input is a JSON object that grows one fragment at a time.
 * `partial` returns the top-level fields that are complete so far. A value
 * whose key is in `live` also comes back while its string is still open, so a
 * long content field counts as it streams. Nested values count only once
 * complete, and open keys, literals, and non-live strings are left out, so a
 * card never shows a half-written file path.
 */
function partial(raw: string, live: ReadonlySet<string>): Record<string, unknown> | undefined {
  const text = raw.trimStart()
  if (!text.startsWith("{")) return undefined

  const scan: Scan = {
    depth: 0,
    str: false,
    esc: false,
    key: false,
    expect: "key",
    name: "",
    start: 0,
    safe: 1,
    open: false,
    lit: false,
    uni: -1,
  }
  for (let i = 0; i < text.length; i++) {
    if (scan.str) {
      inside(scan, text, i)
      continue
    }
    if (outside(scan, text, i)) return record(text.slice(0, i + 1))
  }
  return finish(scan, text, live)
}

type Scan = {
  depth: number
  str: boolean
  esc: boolean
  /** The open top-level string is a key. */
  key: boolean
  expect: "key" | "colon" | "value" | "comma"
  /** The last top-level key. */
  name: string
  start: number
  /** Prefix length that ends after the last complete top-level value. */
  safe: number
  /** A top-level string value is open. */
  open: boolean
  /** A top-level literal (number, true, false, null) is open. */
  lit: boolean
  /** Index of the backslash of a `\u` escape that may still be incomplete. */
  uni: number
}

function inside(scan: Scan, text: string, i: number) {
  const c = text[i]
  if (scan.esc) {
    scan.esc = false
    if (c === "u") scan.uni = i - 1
    return
  }
  if (c === "\\") {
    scan.esc = true
    return
  }
  if (c !== '"') return
  scan.str = false
  if (scan.depth !== 1) return
  if (scan.key) {
    scan.name = (parse(text.slice(scan.start, i + 1)) as string | undefined) ?? ""
    scan.expect = "colon"
    return
  }
  scan.safe = i + 1
  scan.open = false
  scan.expect = "comma"
}

/** Returns true when the top-level object closes. */
function outside(scan: Scan, text: string, i: number) {
  const c = text[i]
  if (c === '"') {
    scan.str = true
    if (scan.depth !== 1) return false
    scan.start = i
    scan.key = scan.expect === "key"
    scan.open = !scan.key
    return false
  }
  if (c === "{" || c === "[") {
    scan.depth++
    return false
  }
  if (c === "}" || c === "]") {
    scan.depth--
    if (scan.depth === 0) return true
    if (scan.depth === 1) {
      scan.safe = i + 1
      scan.expect = "comma"
    }
    return false
  }
  if (scan.depth === 1) top(scan, c, i)
  return false
}

function top(scan: Scan, c: string, i: number) {
  const space = c === " " || c === "\n" || c === "\r" || c === "\t"
  if (scan.lit && (c === "," || space)) {
    scan.safe = i
    scan.lit = false
    scan.expect = "comma"
  }
  if (c === ":") scan.expect = "value"
  if (c === ",") scan.expect = "key"
  if (!space && scan.expect === "value" && c !== ":") scan.lit = true
}

function finish(scan: Scan, text: string, live: ReadonlySet<string>) {
  if (!(scan.str && scan.open && scan.depth === 1 && live.has(scan.name))) {
    return record(text.slice(0, scan.safe) + "}")
  }
  // Close the open live string. Drop an escape that is not complete yet.
  const cut = scan.esc ? text.length - 1 : scan.uni >= 0 && scan.uni + 6 > text.length ? scan.uni : text.length
  return record(text.slice(0, cut) + '"}')
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function record(text: string) {
  const value = parse(text)
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
