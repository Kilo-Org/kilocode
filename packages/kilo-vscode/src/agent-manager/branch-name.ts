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
