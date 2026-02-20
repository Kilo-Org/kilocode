/** Escape characters that are special inside double-quoted shell strings. */
function escapeShell(value: string): string {
  return value.replace(/["$`\\]/g, "\\$&")
}

/** Build the platform-appropriate command string for running a setup script. */
export function buildSetupCommand(
  script: string,
  env: { worktreePath: string; repoPath: string },
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    // Windows cmd.exe: double quotes in set values don't need escaping the same way,
    // but we escape for the call argument
    return `set "WORKTREE_PATH=${env.worktreePath}" && set "REPO_PATH=${env.repoPath}" && call "${script}"`
  }
  const wt = escapeShell(env.worktreePath)
  const repo = escapeShell(env.repoPath)
  const path = escapeShell(script)
  return `WORKTREE_PATH="${wt}" REPO_PATH="${repo}" sh "${path}"`
}
