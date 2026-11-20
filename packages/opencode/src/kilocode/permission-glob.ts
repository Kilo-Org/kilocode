// Translate a legacy Kilo Code `fileRegex` pattern into permission wildcard globs.
//
// Must stay aligned with the Kotlin translator in
// packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/migration/LegacyMigrationConverters.kt
// (`fileRegexToGlobs`): the CLI and the plugin both migrate the same legacy modes and
// must grant the same file restrictions.

const MAX_ARMS = 32

// Characters the glob syntax cannot express; a plain `?` is still handled as an atom suffix.
const UNSUPPORTED = /[*+{}[\]^$?]/

/**
 * Translate a legacy `fileRegex` pattern into permission wildcard globs.
 *
 * Returns null when the pattern uses a construct that the glob syntax cannot express,
 * so the caller can report it instead of writing an unmatched rule.
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

  const arms = [
    ...new Set(
      parsed[0].map((arm) => {
        let glob = arm
        if (!anchoredStart && !glob.startsWith("*")) glob = `*${glob}`
        if (!anchoredEnd && !glob.endsWith("*")) glob = `${glob}*`
        return glob
      }),
    ),
  ]

  if (arms.length === 0 || arms.some((arm) => arm.length === 0)) return null
  if (arms.some((arm) => arm.endsWith(" *"))) return null
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
