import { createHash } from "crypto"

/**
 * Candidate secret values and their salted digests.
 *
 * When the agent obtains the contents of a credential file, the session state keeps a salted hash of
 * every value-like token in it — never the values. A later outbound action is checked by hashing the
 * tokens of its arguments / payload and looking for a match. The extraction is deliberately
 * conservative and explainable: assignment right-hand sides, JSON string values and long opaque
 * tokens, minus things that are obviously not secrets (paths, plain words, ports, e-mail addresses,
 * bare URLs). Encoded or transformed values are out of reach by design and documented as such.
 */
export namespace SecretValues {
  export const MIN_LENGTH = 8
  export const MAX_TEXT = 256 * 1024
  export const MAX_VALUES = 4000

  const ASSIGNMENT = /^\s*(?:export\s+)?["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*[=:]\s*(.+?)\s*,?\s*$/
  const JSON_PAIR = /"([^"\\]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  const LONG_TOKEN = /[A-Za-z0-9_\-+/=.:~]{16,}/g
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const SPLIT = /[\s&=:;,"'()[\]{}<>|]+/
  const WORDS = /^(true|false|null|undefined|none|yes|no|localhost|production|development|staging|test)$/i

  function strip(value: string) {
    let text = value.trim()
    const quoted =
      (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
      (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
    if (quoted) return text.slice(1, -1)
    // dotenv: an unquoted value ends at ` #`.
    const comment = text.indexOf(" #")
    if (comment > 0) text = text.slice(0, comment).trim()
    return text
  }

  /** Could this token be a secret? Filters out the common non-secret shapes. */
  export function plausible(value: string): boolean {
    if (value.length < MIN_LENGTH) return false
    if (/^[A-Za-z]+$/.test(value) && value.length < 20) return false
    if (/^\d+$/.test(value) && value.length < 16) return false
    if (/^(\/|\.{1,2}\/|~\/|[A-Za-z]:\\)/.test(value)) return false
    if (/^https?:\/\//i.test(value) && !/[@?#]/.test(value)) return false
    if (EMAIL.test(value)) return false
    if (WORDS.test(value)) return false
    return true
  }

  /** Candidate secret values in a file's text. Bounded; order-insensitive. */
  export function extract(text: string): string[] {
    const out = new Set<string>()
    const body = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text
    for (const line of body.split(/\r?\n/)) {
      const assignment = line.match(ASSIGNMENT)
      if (assignment) {
        const value = strip(assignment[2]!)
        if (plausible(value)) out.add(value)
      }
      for (const pair of line.matchAll(JSON_PAIR)) {
        const value = pair[2]!
        if (plausible(value)) out.add(value)
      }
      for (const token of line.matchAll(LONG_TOKEN)) {
        if (plausible(token[0])) out.add(token[0])
      }
      if (out.size >= MAX_VALUES) break
    }
    return [...out]
  }

  /** Tokens of a command argument or payload that could carry a value (whole string included). */
  export function tokens(text: string): string[] {
    const out = new Set<string>()
    const add = (value: string) => {
      const clean = strip(value)
      if (clean.length >= MIN_LENGTH) out.add(clean)
    }
    add(text)
    for (const part of text.split(SPLIT)) add(part)
    for (const token of text.matchAll(LONG_TOKEN)) add(token[0])
    const assignment = text.match(ASSIGNMENT)
    if (assignment) add(assignment[2]!)
    return [...out]
  }

  /** Salted digest of a value; the salt is per session so digests are not comparable across sessions. */
  export function digest(salt: string, value: string): string {
    return createHash("sha256").update(salt).update("\0").update(value).digest("hex").slice(0, 32)
  }
}
