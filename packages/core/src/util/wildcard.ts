export * as Wildcard from "./wildcard"

export function match(input: string, pattern: string) {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"

  return new RegExp("^" + escaped + "$", process.platform === "win32" ? "si" : "s").test(normalized)
}

// kilocode_change start - pattern specificity scoring for granular auto-approve
// Higher score = more specific pattern. Used to prefer specific rules over broad ones.
export function specificity(pattern: string): number {
  const normalized = pattern.replaceAll("\\", "/")
  // Exact path (no wildcards) gets highest score
  if (!normalized.includes("*") && !normalized.includes("?")) {
    return 1000 + normalized.split("/").length * 10 + normalized.length
  }
  // Directory-specific patterns (e.g., src/**/*.ts) score higher than root-level (*)
  let score = 0
  const parts = normalized.split("/")
  for (const part of parts) {
    if (part === "**") score += 5
    else if (part.includes("*")) score += 10
    else if (part.includes("?")) score += 15
    else score += 50 // literal directory name
  }
  // Extension-specific patterns score higher
  if (normalized.includes(".")) score += 20
  return score
}
// kilocode_change end
