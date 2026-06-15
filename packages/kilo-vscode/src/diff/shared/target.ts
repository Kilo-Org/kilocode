import type { GitOps } from "../../agent-manager/GitOps"
import { resolveBase } from "../../agent-manager/local-diff"

export async function resolveLocalDiffTarget(
  gitOps: GitOps,
  log: (...args: unknown[]) => void,
  root?: string,
): Promise<{ directory: string; baseBranch: string } | undefined> {
  if (!root) {
    log("Local diff: no workspace root")
    return
  }

  const branch = await gitOps.currentBranch(root)
  if (!branch || branch === "HEAD") {
    log("Local diff: detached HEAD or no branch")
    return
  }

  const tracking = await gitOps.resolveTrackingBranch(root, branch)
  const fallback = tracking ? undefined : await gitOps.resolveDefaultBranch(root, branch)
  const raw = tracking || fallback || "HEAD"
  const base = await resolveBase(gitOps, root, raw)

  log(`Local diff: branch=${branch} tracking=${tracking ?? "none"} default=${fallback ?? "none"} base=${base}`)

  return { directory: root, baseBranch: base }
}
