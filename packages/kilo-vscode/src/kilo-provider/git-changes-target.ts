import { GitOps } from "../agent-manager/GitOps"
import { resolveLocalDiffTarget } from "../diff/shared/target"

let shared: GitOps | undefined

function ops(): GitOps {
  if (shared && !shared.disposed) return shared
  shared = new GitOps({ log: () => undefined })
  return shared
}

export function disposeGitChangesTarget(): void {
  shared?.dispose()
  shared = undefined
}

/**
 * The directory and base `@git-changes` diffs. A base the webview names, such as an Agent Manager worktree's parent
 * branch, wins. Otherwise a branch diffs against its tracking or default branch, and a directory without one shows
 * its working tree changes.
 */
export async function resolveGitChangesTarget(input: {
  directory: string
  base?: string
}): Promise<{ directory: string; base?: string }> {
  if (input.base) return input
  const target = await resolveLocalDiffTarget(ops(), () => undefined, input.directory)
  if (!target) return { directory: input.directory }
  return { directory: target.directory, base: target.baseBranch }
}
