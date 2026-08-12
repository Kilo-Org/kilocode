// Hand-rolled because the only XML we need to read is the merged junit.xml
// we produce ourselves plus verbatim bun junit output. Adding fast-xml-parser
// (or any other XML dep) for ~70 lines of attribute walking is not worth it.

export namespace JunitDurations {
  export type Map = Record<string, number>

  // Walk a merged junit.xml body and return per-file wall-clock seconds.
  // The runner writes one top-level <testsuite> per test file directly under
  // <testsuites>, with `name="path/to/file.test.ts"` and `time="..."` attrs.
  // Nested describe blocks also emit <testsuite>, but they live inside the
  // per-file suite — we skip them by jumping to the first </testsuite>
  // after each top-level open tag (safe because the runner XML-escapes `<`
  // inside failure messages, so no raw close tag appears in text content).
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
      const selfClose = head.endsWith("/")
      const attrText = (selfClose ? head.slice(0, -1) : head).trim()
      const attrs = parseAttrs(attrText)
      const name = attrs["name"]
      const time = Number(attrs["time"])
      if (name?.endsWith(".test.ts") && Number.isFinite(time) && time > 0) {
        out[normalize(name)] = time
      }

      const close = content.indexOf("</testsuite>", tagEnd + 1)
      const next = selfClose ? tagEnd + 1 : close < 0 ? -1 : close + "</testsuite>".length
      cursor = next < 0 || next > rootCloseStart ? rootCloseStart : next
    }

    return out
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