// Hand-rolled because the only XML we need to read is the merged junit.xml
// we produce ourselves plus verbatim bun junit output. Adding fast-xml-parser
// (or any other XML dep) for ~70 lines of attribute walking is not worth it.

export namespace JunitDurations {
  export type Map = Record<string, number>

  // Walk a merged junit.xml body and return per-file wall-clock seconds.
  // The runner writes one top-level <testsuite> per test file directly under
  // <testsuites>, with `name="path/to/file.test.ts"`. Nested describe blocks
  // also emit <testsuite>, but they live inside the per-file suite, so each
  // top-level suite is skipped past as a whole (safe because the runner
  // XML-escapes `<` inside failure messages, so no raw tag appears in text).
  //
  // The duration is the SUM of the suite's <testcase time="..."> values, not
  // its own `time` attribute: bun writes `time="0"` on the file-level suite in
  // practice (verified against every Windows artifact of runs 31657477161 and
  // 31703950716 — 1070 files ran and only 111 carried a nonzero suite time),
  // so reading the attribute silently threw away ~90% of the history and left
  // the sharder balancing on file size. The attribute is still used as a
  // fallback, which is what the runner's own synthetic failure entries carry.
  //
  // Repeated keys accumulate rather than overwrite. One file can legitimately
  // produce several suites in a merged report — `TestSplit` runs a heavy file
  // as several `-t`-filtered processes, each emitting its own suite for the
  // same path — and the file's weight is the total of its parts.
  //
  // Bun's junit reporter prefixes suite names with the cwd it was invoked
  // from (e.g. `test/kilocode/foo.test.ts` on POSIX, `test\kilocode\foo.test.ts`
  // on Windows), while the runner's candidate list is cwd-relative and
  // unprefixed (`kilocode/foo.test.ts`). Strip a single leading `test/` or
  // `test\` and normalize any remaining backslashes to forward slashes so
  // both bun entries and the synthetic failure entries written by the
  // runner (which use the unprefixed form) land in the same map keyed by
  // candidate path.
  export function parse(content: string): Map {
    const out: Map = {}

    let cursor = skipIgnorable(content, 0)
    if (!content.startsWith("<testsuites", cursor)) return out
    const rootOpenEnd = content.indexOf(">", cursor)
    if (rootOpenEnd < 0) return out
    if (content[rootOpenEnd - 1] === "/") return out
    const rootCloseStart = content.indexOf("</testsuites>", rootOpenEnd + 1)
    if (rootCloseStart < 0) return out

    cursor = rootOpenEnd + 1
    while (cursor < rootCloseStart) {
      const open = content.indexOf("<testsuite", cursor)
      if (open < 0 || open >= rootCloseStart) break
      const tagEnd = content.indexOf(">", open)
      if (tagEnd < 0 || tagEnd >= rootCloseStart) break

      const head = content.slice(open + "<testsuite".length, tagEnd)
      const selfClose = head.trimEnd().endsWith("/")
      const attrText = (selfClose ? head.trimEnd().slice(0, -1) : head).trim()
      const attrs = parseAttrs(attrText)
      const end = selfClose ? tagEnd + 1 : spanEnd(content, tagEnd + 1)

      const name = attrs["name"]
      if (name?.endsWith(".test.ts")) {
        const body = selfClose ? "" : content.slice(tagEnd + 1, end)
        const cases = sumCases(body)
        const time = cases > 0 ? cases : Number(attrs["time"])
        if (Number.isFinite(time) && time > 0) {
          const key = normalize(name)
          out[key] = (out[key] ?? 0) + time
        }
      }

      cursor = end > cursor ? end : cursor + 1
    }

    return out
  }

  // Index just past the `</testsuite>` closing the suite whose body starts at
  // `from`, counting nested opens so a file suite's describe blocks don't end
  // the span early. Unbalanced input (a truncated artifact) yields the end of
  // the content, which drops the tail rather than looping.
  function spanEnd(content: string, from: number): number {
    let i = from
    let depth = 1
    while (depth > 0) {
      const open = content.indexOf("<testsuite", i)
      const close = content.indexOf("</testsuite>", i)
      if (close < 0) return content.length
      if (open >= 0 && open < close) {
        const tagEnd = content.indexOf(">", open)
        if (tagEnd < 0) return content.length
        if (!content.slice(open, tagEnd).trimEnd().endsWith("/")) depth++
        i = tagEnd + 1
        continue
      }
      depth--
      i = close + "</testsuite>".length
    }
    return i
  }

  // Total of every `<testcase time="...">` in a suite body, nested describes
  // included. `[^>]*` cannot run past the tag because bun escapes `>` in
  // attribute values, and a `<testcase` inside a failure message is escaped
  // too, so no text content is mistaken for markup.
  function sumCases(body: string): number {
    let total = 0
    const re = /<testcase\b[^>]*?\stime="([^"]*)"/g
    let match: RegExpExecArray | null
    while ((match = re.exec(body))) {
      const time = Number(match[1])
      if (Number.isFinite(time) && time > 0) total += time
    }
    return total
  }

  // Bun's junit reporter prefixes suite names with the cwd it was invoked
  // from and uses the OS-native separator (`test/kilocode/foo.test.ts` on
  // POSIX, `test\kilocode\foo.test.ts` on Windows). The runner's candidate
  // list is always forward-slash after its `.replaceAll("\\", "/")` pass.
  // Drop the leading `test/` (or `test\`) prefix and normalize any
  // remaining backslashes to forward slashes so both bun entries and the
  // synthetic failure entries written by the runner land in the same map
  // keyed by candidate path.
  function normalize(name: string): string {
    let n = name
    if (n.startsWith("test/") || n.startsWith("test\\")) {
      n = n.slice("test/".length)
    }
    return n.replaceAll("\\", "/")
  }

  // Skip XML prolog (`<?xml ...?>`), comments (`<!-- ... -->`), DOCTYPE
  // declarations, and whitespace. Stops at the first real markup or EOF.
  function skipIgnorable(content: string, from: number): number {
    let i = from
    while (i < content.length) {
      while (i < content.length && isSpace(content[i])) i++
      if (i >= content.length) break
      if (content[i] !== "<") break
      if (content.startsWith("<?", i)) {
        const end = content.indexOf("?>", i + 2)
        i = end < 0 ? content.length : end + 2
        continue
      }
      if (content.startsWith("<!--", i)) {
        const end = content.indexOf("-->", i + 4)
        i = end < 0 ? content.length : end + 3
        continue
      }
      if (content.startsWith("<!", i)) {
        const end = content.indexOf(">", i + 2)
        i = end < 0 ? content.length : end + 1
        continue
      }
      break
    }
    return i
  }

  // Parse `name="value" name2="value2"` into a flat map. Values are
  // double-quoted (junit never uses single quotes in our inputs); entity
  // decoding is intentionally skipped because file paths and `time` numbers
  // never contain entities and we never read user-controlled text.
  function parseAttrs(text: string): Record<string, string> {
    const out: Record<string, string> = {}
    let i = 0
    while (i < text.length) {
      while (i < text.length && isSpace(text[i])) i++
      if (i >= text.length) break
      const nameStart = i
      while (i < text.length && !isSpace(text[i]) && text[i] !== "=" && text[i] !== ">") i++
      const name = text.slice(nameStart, i)
      while (i < text.length && isSpace(text[i])) i++
      if (text[i] !== "=") break
      i++
      while (i < text.length && isSpace(text[i])) i++
      if (text[i] !== '"') break
      i++
      const valueStart = i
      while (i < text.length && text[i] !== '"') i++
      out[name] = text.slice(valueStart, i)
      i++
    }
    return out
  }

  function isSpace(c: string): boolean {
    return c === " " || c === "\t" || c === "\n" || c === "\r"
  }
}
