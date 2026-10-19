/**
 * Match repository paths against exact, regex, or simple glob patterns.
 */

function esc(text: string): string {
  return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}

function glob(pattern: string): RegExp {
  // `**/` matches zero or more directories, a bare `**` matches anything, and `*` stays inside one
  // path segment. Translate to placeholders first, so a later `*` pass cannot rewrite an inserted `.*`.
  const source = esc(pattern)
    .replace(/\*\*\//g, "\u0000dir\u0000")
    .replace(/\*\*/g, "\u0000any\u0000")
    .replace(/\*/g, "\u0000star\u0000")
    .replaceAll("\u0000dir\u0000", "(?:.*/)?")
    .replaceAll("\u0000any\u0000", ".*")
    .replaceAll("\u0000star\u0000", "[^/]*")

  return new RegExp(`^${source}$`)
}

export function match(path: string, pattern: string): boolean {
  if (path === pattern) return true

  if (pattern.startsWith("^") || pattern.includes("\\")) {
    return new RegExp(pattern).test(path)
  }

  if (pattern.includes("*")) {
    return glob(pattern).test(path)
  }

  return false
}

export function matches(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => match(path, pattern))
}
