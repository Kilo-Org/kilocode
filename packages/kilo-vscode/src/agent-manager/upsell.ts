import type { ProjectContexts } from "./project/contexts"
import { canonicalizePath } from "./project/paths"
import type { RevealDeps } from "./reveal-session"

export type UpsellDeps = Omit<RevealDeps, "post"> & {
  post: (message: Parameters<RevealDeps["post"]>[0] | { type: "agentManager.openUpsellTab"; projectId: string }) => void
  error: (message: string) => void
}

export async function openUpsellTab(directory: string | undefined, contexts: ProjectContexts, deps: UpsellDeps) {
  const target = directory ? contexts.byDirectory(canonicalizePath(directory)) : undefined
  if (!target) {
    deps.open()
    deps.error("Agent Manager could not find this chat's project. Add the project in Agent Manager and try again.")
    return false
  }
  if (contexts.active()?.id !== target.id) {
    contexts.activate(target.id)
    deps.activate(target)
    deps.projects()
  }
  deps.open()
  await deps.state()
  if (contexts.active() !== target) return false
  if (!(await deps.ready()) || contexts.active() !== target) return false
  deps.post({ type: "agentManager.openUpsellTab", projectId: target.id })
  return true
}
