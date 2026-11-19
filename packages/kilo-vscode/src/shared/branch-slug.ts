/**
 * Sanitize a string into a valid git branch name segment.
 * Keeps lowercase alphanumeric chars and hyphens, collapses runs, strips edges.
 * Shared so the New Worktree dialog can preview the branch the host derives
 * from a worktree name.
 */
export function sanitizeBranchName(name: string, maxLength = 50): string {
  return name
    .slice(0, maxLength)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
}
