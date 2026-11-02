export type Violation = { file: string; rule: string; message: string }
export type Entry = { count: number; owner: string; reason: string }

export const HIGHER_LAYERS = [
  "@opencode/core",
  "@opencode/protocol",
  "@opencode/server",
  "@opencode/client",
  "@opencode/cli",
  "@opencode/tui",
  "@opencode/sdk",
]

export function isPackage(specifier: string, pkg: string) {
  return specifier === pkg || specifier.startsWith(`${pkg}/`)
}

export function isInternalAlias(specifier: string) {
  return specifier === "@/" || specifier.startsWith("@/")
}

export function isKiloPackage(specifier: string) {
  return specifier.startsWith("@kilocode/") || isPackage(specifier, "@opencode-ai/ui")
}

export function importSpecifiers(text: string) {
  const specifiers: string[] = []
  for (const match of text.matchAll(/\b(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) {
    if (match[1]) specifiers.push(match[1])
  }
  return specifiers
}

export function forbiddenDirection(specifier: string, forbidden: string[]) {
  if (isInternalAlias(specifier)) return "internal alias (@/)"
  if (forbidden.some((pkg) => isPackage(specifier, pkg))) return "higher layer package"
  if (isKiloPackage(specifier)) return "Kilo package"
  return null
}

export function ratchet(
  rule: string,
  hits: Map<string, number>,
  allowedSites: Record<string, Entry>,
  messages: {
    unclassified: (count: number) => string
    drift: (file: string, expected: number, count: number) => string
    stale: (file: string) => string
  },
) {
  const violations: Violation[] = []

  for (const [file, count] of hits) {
    const expected = allowedSites[file]
    if (!expected) {
      violations.push({ file, rule, message: messages.unclassified(count) })
    } else if (expected.count !== count) {
      violations.push({ file, rule, message: messages.drift(file, expected.count, count) })
    }
  }

  for (const file of Object.keys(allowedSites)) {
    if (!hits.has(file)) {
      violations.push({ file, rule, message: messages.stale(file) })
    }
  }

  return violations
}
