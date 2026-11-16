import { PLATFORM } from "./constants"

/**
 * Build the `session.create` request body for a new Agent Manager session,
 * in either a worktree or the caller's directory.
 *
 * Pure helper — no vscode imports. Extracted to keep AgentManagerProvider.ts
 * under its line cap; see tests/unit/agent-manager-arch.test.ts.
 */
export function sessionCreateBody(input: {
  directory: string
  metadata: Record<string, unknown>
  agent?: string
  title?: string
  sandboxInheritanceToken?: string
}) {
  return {
    directory: input.directory,
    platform: PLATFORM,
    metadata: input.metadata,
    ...(input.title ? { title: input.title } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.sandboxInheritanceToken ? { sandboxInheritanceToken: input.sandboxInheritanceToken } : {}),
  }
}
