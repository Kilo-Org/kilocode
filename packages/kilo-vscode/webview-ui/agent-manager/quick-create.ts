import { createSignal } from "solid-js"
import type { CreateWorktreeRequest } from "../src/types/messages/agent-manager"

/** A quick create in flight. Its request ID ties setup messages to this create rather than to a concurrent one. */
export interface QuickCreate {
  requestId: string
  project: string
  /** Open the dialog for a setup blocker. */
  blocked: (projectId: string) => void
  /** The create finished or failed for another reason. */
  done: () => void
}

/** Track one quick create at a time and post its request with the marker the setup reply names. */
export function createQuickCreate(deps: {
  post: (message: CreateWorktreeRequest) => void
  blocked: (projectId: string) => void
}) {
  const [quick, setQuick] = createSignal<QuickCreate>()
  const start = (projectId: string, baseBranch?: string) => {
    const requestId = crypto.randomUUID()
    setQuick({
      requestId,
      project: projectId,
      blocked: (id) => {
        setQuick(undefined)
        deps.blocked(id)
      },
      done: () => setQuick(undefined),
    })
    deps.post({
      type: "agentManager.createWorktree",
      projectId,
      requestId,
      ...(baseBranch ? { baseBranch } : {}),
    })
  }
  return { quick, start }
}
