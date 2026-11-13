import type { SessionMessageInfo } from "@opencode/client"

/**
 * Child session IDs of the subagent tool parts in one session, in call order. The transcript palette uses these so
 * agents spawned by the open session get sibling-aware identicons, including before their session info has loaded.
 */
export function sessionChildren(messages: readonly SessionMessageInfo[]) {
  const ids: string[] = []
  for (const message of messages) {
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool" || part.name !== "subagent") continue
      if (part.state.status === "streaming") continue
      const id = part.state.metadata?.sessionID
      if (typeof id !== "string" || ids.includes(id)) continue
      ids.push(id)
    }
  }
  return ids
}
