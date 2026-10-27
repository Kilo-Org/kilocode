/**
 * A streamed tool input is a JSON object that grows one fragment at a time.
 * `partial` returns the top-level fields that are complete so far. A value
 * whose key is in `live` also comes back while its string is still open, so
 * long content can show as it streams. Nested values count only once complete,
 * and open keys, literals, and non-live strings are left out, so a field never
 * shows a half-written file path.
 */
export function partial(raw: string, live: ReadonlySet<string>): Record<string, unknown> | undefined {
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
  // The open top-level string is a key.
  key: boolean
  expect: "key" | "colon" | "value" | "comma"
  // The last top-level key.
  name: string
  start: number
  // Prefix length that ends after the last complete top-level value.
  safe: number
  // A top-level string value is open.
  open: boolean
  // A top-level literal (number, true, false, null) is open.
  lit: boolean
  // Index of the backslash of a \u escape that may still be incomplete.
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
