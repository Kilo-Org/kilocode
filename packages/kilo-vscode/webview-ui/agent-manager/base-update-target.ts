import type { SessionInfo } from "@opencode/client"

/** The session an update runs in, with the model and agent that session uses. */
export type BaseUpdateTarget = {
  sessionId?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  agent?: string
}

/**
 * The visible session as the update target, but only when it already belongs to the worktree being updated. An
 * unrelated or missing session leaves the host to pick one.
 */
export function baseUpdateTarget(input: {
  worktreeId: string
  session: SessionInfo | undefined
  sessionWorktreeId: string | null | undefined
}): BaseUpdateTarget {
  if (!input.session || input.sessionWorktreeId !== input.worktreeId) return {}
  const model = input.session.model
  return {
    sessionId: input.session.id,
    ...(model ? { model: { providerID: model.providerID, modelID: model.id } } : {}),
    ...(model?.variant && model.variant !== "default" ? { variant: model.variant } : {}),
    ...(input.session.agent ? { agent: input.session.agent } : {}),
  }
}