import type { OpenCodeClient } from "@opencode/client"

export interface ForkHandoffInput {
  client: OpenCodeClient
  sessionId: string
  directory?: string
}

export function forkText(input: Pick<ForkHandoffInput, "directory">): string {
  return [
    "<system-reminder>",
    "This session was forked from an existing session in the current repository or worktree.",
    ...(input.directory
      ? [
          `Use this as the current working directory: ${input.directory}`,
          "For this fork, this location supersedes any earlier repository or worktree location retained in the copied context.",
        ]
      : []),
    "The prior conversation context was retained intentionally.",
    "The user may continue the same task, explore an alternative approach, or provide new instructions.",
    "Follow the user's next instruction as the direction for this fork, using retained context when relevant.",
    "</system-reminder>",
  ].join("\n")
}

export async function recordForkHandoff(input: ForkHandoffInput): Promise<void> {
  // Admit the note without resuming: it reaches the model with the next instruction and must not start a reply.
  await input.client.session.synthetic({
    sessionID: input.sessionId,
    text: forkText(input),
    resume: false,
  })
}
