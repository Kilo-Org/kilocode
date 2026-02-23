/**
 * Generate a valid git branch name from a prompt.
 */
export function generateBranchName(prompt: string): string {
  const sanitized = prompt
    .slice(0, 50)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")

  return `${sanitized || "kilo"}-${Date.now()}`
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
