// Translate a legacy Kilo Code `fileRegex` pattern into permission wildcard globs.
//
// Must stay aligned with the Kotlin translator in
// packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/migration/LegacyMigrationConverters.kt
// (`fileRegexToGlobs`): the CLI and the plugin both migrate the same legacy modes and
// must grant the same file restrictions.

const MAX_ARMS = 32

// Characters the glob syntax cannot express; a plain `?` is still handled as an atom suffix.
const UNSUPPORTED = /[*+{}[\]^$?]/

// An arm made only of digits becomes an integer-like JSON key, which JavaScript enumerates
// before `"*"`: the catch-all deny would then win and refuse the files the mode allowed.
const DIGITS = /^\d+$/

// An arm that names a home-relative path. `Permission.fromConfig` runs every configured
// pattern through `expand()`, which rewrites `~`, `~/...` and `$HOME...` to an absolute path
// under the user's home directory. The file permissions ask with a workspace-relative path,
// so such an arm does not match and the sibling catch-all deny decides instead: the rule stops
// meaning what the legacy pattern meant.
const HOME = /^(?:~(?:\/|$)|\$HOME)/

/**
 * Translate a legacy `fileRegex` pattern into permission wildcard globs.
 *
 * Returns null when the pattern uses a construct that the glob syntax cannot express,
 * when every alternative is empty while both anchors are present, when an arm consists
 * only of digits, or when an arm names a home-relative path, so the caller can report it
 * instead of writing a rule whose meaning changes when the CLI expands it.
 */
export function regexToGlobs(regex: string): string[] | null {
  if (regex.length === 0) return null

  let body = regex
  const anchoredStart = body.startsWith("^")
  if (anchoredStart) body = body.slice(1)

  let anchoredEnd = false
  if (body.endsWith("$") && body.length > 0 && !escaped(body, body.length - 1)) {
    anchoredEnd = true
    body = body.slice(0, -1)
  }
  if (body.length === 0) return null

  const parsed = sequence(body, 0, false)
  if (!parsed) return null

  const raw = parsed[0]

  // An empty alternative matches the empty string, and no path is empty. With both anchors
  // the pattern must consume the whole path, so empty alternatives are dropped and the arms
  // that do name a path are kept: `^(a|)$` and `^(|a)$` both allow `a`. Only when every arm
  // is empty does the pattern match nothing but the empty string, which no glob can express,
  // so the caller must report it. Without both anchors an empty arm is padded to `*`, which
  // is right because that arm then matches the rest of any path.
  const kept = anchoredStart && anchoredEnd ? raw.filter((arm) => arm.length > 0) : raw
  if (kept.length === 0) return null

  const arms = [
    ...new Set(
      kept.map((arm) => {
        let glob = arm
        if (!anchoredStart && !glob.startsWith("*")) glob = `*${glob}`
        if (!anchoredEnd && !glob.endsWith("*")) glob = `${glob}*`
        return glob
      }),
    ),
  ]

  // A pattern ending in `" .*"` is rewritten by `Wildcard.match` into `"( .*)?"`, so an arm
  // ending in ` *` also matches the text before the space. A pattern ending in a literal
  // space (`^docs ` becomes `docs *`) is expressible but is rejected here, so that group
  // asks and the restriction is reported.
  if (arms.some((arm) => arm.endsWith(" *"))) return null
  // See the HOME comment above.
  if (arms.some((arm) => HOME.test(arm))) return null
  if (arms.some((arm) => DIGITS.test(arm))) return null
  return arms
}

function escaped(text: string, index: number): boolean {
  let count = 0
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) count++
  return count % 2 === 1
}

function product(left: string[], right: string[]): string[] | null {
  if (left.length * right.length > MAX_ARMS) return null
  const out: string[] = []
  for (const a of left) for (const b of right) out.push(a + b)
  return out
}

/**
 * Parse a supported regex sequence starting at `start` into glob arms.
 *
 * Returns the arms and the index of the character that stopped the parse: `)` or `|`
 * inside a group, or the end of the text at the top level.
 */
function sequence(text: string, start: number, inGroup: boolean): [string[], number] | null {
  let arms = [""]
  let i = start

  while (i < text.length) {
    const c = text[i]
    if (c === ")" || c === "|") {
      if (!inGroup) return null
      return [arms, i]
    }

    let atom: string[]
    if (c === "\\") {
      const next = text[i + 1]
      if (next == null) return null
      if (/[\p{L}\p{N}\s\\]/u.test(next) || next === "*" || next === "?") return null
      atom = [next]
      i += 2
    } else if (c === ".") {
      if (text[i + 1] === "*") {
        atom = ["*"]
        i += 2
      } else {
        atom = ["?"]
        i += 1
      }
    } else if (c === "(") {
      if (inGroup) return null
      const nested = group(text, i)
      if (!nested) return null
      atom = nested[0]
      i = nested[1]
    } else {
      if (UNSUPPORTED.test(c)) return null
      atom = [c]
      i += 1
    }

    const before = arms
    const merged = product(before, atom)
    if (!merged) return null
    arms = merged

    if (text[i] === "?") {
      const optional = [...new Set([...before, ...merged])]
      if (optional.length > MAX_ARMS) return null
      arms = optional
      i += 1
    }
  }

  return [arms, i]
}

function group(text: string, start: number): [string[], number] | null {
  let arms: string[] = []
  let current = [""]
  let i = start + 1

  while (true) {
    const parsed = sequence(text, i, true)
    if (!parsed) return null
    const merged = product(current, parsed[0])
    if (!merged) return null
    current = merged

    const stop = parsed[1]
    if (stop >= text.length) return null
    const c = text[stop]
    arms.push(...current)
    if (arms.length > MAX_ARMS) return null
    if (c === ")") return [arms, stop + 1]
    if (c !== "|") return null
    current = [""]
    i = stop + 1
  }
}
