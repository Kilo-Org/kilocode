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
  const payload = {
    sessionID: input.sessionId,
    directory: input.directory,
    noReply: true,
    parts: [
      {
        type: "text",
        text: handoffText(input),
        synthetic: true,
      },
    ],
  } as Parameters<KiloClient["session"]["promptAsync"]>[0]

  await input.client.session.promptAsync(payload, { throwOnError: true })
}
