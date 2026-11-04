import type { JsonValue } from "@opencode/client"

/**
 * Build the `session.create` request body for a new Agent Manager session, in either a worktree or the caller's
 * directory. The platform marker tells the server which surface owns the session.
 */
export function sessionCreateBody(input: {
  directory: string
  metadata?: Record<string, JsonValue>
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
}) {
  return {
    location: { directory: input.directory },
    metadata: { ...input.metadata, kilocode: { platform: "agent-manager" } },
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.model
      ? {
          model: {
            id: input.model.modelID,
            providerID: input.model.providerID,
            ...(input.model.variant ? { variant: input.model.variant } : {}),
          },
        }
      : {}),
  }
}