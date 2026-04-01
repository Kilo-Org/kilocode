import friendlyWords from "friendly-words"

const MAX_ATTEMPTS = 10
const FALLBACK_MAX_SUFFIX = 100

/**
 * Sanitize a string into a valid git branch name segment.
 * Keeps lowercase alphanumeric chars and hyphens, collapses runs, strips edges.
 */
export function sanitizeBranchName(name: string, maxLength = 50): string {
  return name
    .slice(0, maxLength)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
}

/**
 * Generate a natural two-word branch name (e.g. "ambitious-keyboard") using
 * the friendly-words package.  Checks `existingBranches` to avoid collisions,
 * falling back to a numeric suffix and ultimately a timestamp.
 */
export function generateBranchName(_prompt: string, existingBranches: string[] = []): string {
  const predicates = friendlyWords.predicates as string[]
  const objects = friendlyWords.objects as string[]
  const existing = new Set(existingBranches.map((b) => b.toLowerCase()))

  const random = () => {
    const predicate = predicates[Math.floor(Math.random() * predicates.length)]
    const object = objects[Math.floor(Math.random() * objects.length)]
    return `${predicate}-${object}`
  }

  // Try up to MAX_ATTEMPTS unique two-word combos
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const candidate = random()
    if (!existing.has(candidate)) return candidate
  }

  // Append numeric suffix 0–99
  const base = random()
  for (let n = 0; n < FALLBACK_MAX_SUFFIX; n++) {
    const candidate = `${base}-${n}`
    if (!existing.has(candidate)) return candidate
  }

  // Last resort: timestamp
  return `${base}-${Date.now()}`
}

/**
 * Compute the branch name and display label for a version in a multi-version group.
 * Returns undefined values when no custom name is provided (falls back to auto-generated).
 */
export function versionedName(
  base: string | undefined,
  index: number,
  total: number,
): { branch: string | undefined; label: string | undefined } {
  if (!base) return { branch: undefined, label: undefined }
  if (total > 1 && index > 0) {
    return {
      branch: `${base}_v${index + 1}`,
      label: `${base} v${index + 1}`,
    }
  }
  return { branch: base, label: base }
}
