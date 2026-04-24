import { GitOps } from "../agent-manager/GitOps"
import { resolveLocalDiffTarget } from "../review-utils"

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

export async function resolveGitChangesTarget(message: Record<string, unknown>, dir: string) {
  if (message.type !== "requestGitChangesContext") return message
  if (typeof message.contextDirectory === "string" || typeof message.gitChangesBase === "string") return message

  const target = await resolveLocalDiffTarget(ops(), () => undefined, dir)
  if (!target) return { ...message, contextDirectory: dir }
  return { ...message, contextDirectory: target.directory, gitChangesBase: target.baseBranch }
}
