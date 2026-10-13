/**
 * Match repository paths against exact, regex, or simple glob patterns.
 */

function esc(text: string): string {
  return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}

function glob(pattern: string): RegExp {
  const source = pattern
    .split("**")
    .map((part) => part.split("*").map(esc).join("[^/]*"))
    .join(".*")

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
