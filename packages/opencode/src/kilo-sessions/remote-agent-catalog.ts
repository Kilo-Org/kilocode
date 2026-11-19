import type { Agent } from "@/agent/agent"
import { RemoteCommand } from "@/kilo-sessions/remote-command"
import z from "zod"

// The agents a remote client can start a session or send a turn with. The list
// is resolved in the requested directory, so project agents (`.kilo/agents`)
// are included the same way `kilo agent list` includes them.
export namespace RemoteAgentCatalog {
  export const MAX_AGENTS = 128
  export const MAX_NAME_LENGTH = 256
  export const MAX_DESCRIPTION_LENGTH = 1_000

  // `directory` is a relative path under the launch directory, resolved like
  // create_session's `directory`. Without it, a session-scoped request uses the
  // session's directory and a sessionless request uses the launch directory.
  export const Request = z
    .object({
      protocolVersion: z.literal(1),
      directory: z.string().min(1).max(RemoteCommand.MAX_STRING_LENGTH).optional(),
    })
    .strict()

  export const Info = z
    .object({
      name: z.string().min(1).max(MAX_NAME_LENGTH),
      displayName: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    })
    .strict()
  export type Info = z.infer<typeof Info>

  export const Response = z
    .object({
      protocolVersion: z.literal(1),
      agents: z.array(Info).max(MAX_AGENTS),
    })
    .strict()
  export type Response = z.infer<typeof Response>

  // Keeps the agents the TUI offers as a session agent: not subagent-only and
  // not hidden. An over-long description is shortened instead of dropping the
  // agent; an agent whose name does not fit the wire is dropped.
  export function build(items: ReadonlyArray<Agent.Info>): Response {
    const agents = items
      .filter((item) => item.mode !== "subagent" && item.hidden !== true)
      .flatMap((item) => {
        const parsed = Info.safeParse({
          name: item.name,
          ...(item.displayName ? { displayName: item.displayName } : {}),
          ...(item.description ? { description: item.description.slice(0, MAX_DESCRIPTION_LENGTH) } : {}),
        })
        return parsed.success ? [parsed.data] : []
      })
      .slice(0, MAX_AGENTS)
    return { protocolVersion: 1, agents }
  }
}
