import { promptWhenSafe } from "./managed-delivery"
import type { KiloClient } from "@kilocode/sdk/v2/client"

export interface PromoteHandoffInput {
  client: KiloClient
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
  await promptWhenSafe(input.client, {
    sessionId: input.sessionId,
    directory: input.directory,
    text: handoffText(input),
    extra: { noReply: true, synthetic: true },
  })
}
