import type { OpenCodeClient } from "@opencode/client"

export interface PromoteHandoffInput {
  client: OpenCodeClient
  sessionId: string
  directory: string
  branch: string
}

export function handoffText(input: Omit<PromoteHandoffInput, "client" | "sessionId">): string {
  return [
    "<system-reminder>",
    "This session was moved to a git worktree.",
    `Use this as the current working directory: ${input.directory}`,
    `The worktree branch is: ${input.branch}`,
    "</system-reminder>",
  ].join("\n")
}

export async function recordPromotionHandoff(input: PromoteHandoffInput): Promise<void> {
  await input.client.session.synthetic(
    { sessionID: input.sessionId, text: handoffText(input) },
  )
}