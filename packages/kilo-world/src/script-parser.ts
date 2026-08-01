export type Action = {
  verb: string
  args: string[]
}

/**
 * Parse a ;-separated script of browser actions.
 *
 * The parser is quote-aware: `;` inside `'…'`, `"…"`, or `` `…` `` is preserved
 * as a regular character. Inside quoted strings, a backslash only escapes
 * the active quote character or another backslash, so ordinary Windows path
 * separators are preserved. Unquoted whitespace separates tokens.
 *
 * JavaScript passed to `evaluate --js` must be quoted when it contains
 * whitespace or semicolons. `--js-file` accepts one path token.
 */
export function parseScript(text: string): Action[] {
  const actions: Action[] = []
  let verb: string | null = null
  let args: string[] = []
  let current = ""
  let quote: '"' | "'" | "`" | null = null
  let escape = false
  let started = false

  const flushToken = () => {
    if (!started) return
    if (verb === null) {
      verb = current
    } else {
      args.push(current)
    }
    current = ""
    started = false
  }
  const flushVerb = () => {
    flushToken()
    if (verb !== null) {
      actions.push({ verb, args })
      verb = null
      args = []
    }
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      current += ch
      escape = false
      started = true
      continue
    }
    if (quote) {
      if (ch === "\\") {
        const next = text[i + 1]
        if (next === quote || next === "\\") {
          escape = true
          started = true
          continue
        }
        current += ch
        started = true
        continue
      }
      if (ch === quote) {
        // closing quote — do not include it in the token
        quote = null
        continue
      }
      current += ch
      started = true
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      // opening quote — do not include the quote char in the token
      quote = ch
      started = true
      continue
    }
    if (ch === ";") {
      flushToken()
      flushVerb()
      continue
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      flushToken()
      continue
    }
    current += ch
    started = true
  }
  if (escape) throw new Error("unterminated escape in script")
  if (quote !== null) throw new Error("unterminated quote in script")
  flushToken()
  flushVerb()
  return actions
}
