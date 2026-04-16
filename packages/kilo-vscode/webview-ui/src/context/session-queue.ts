import type { Message, SessionStatusInfo } from "../types/messages"

// Find the user message whose turn the server is actively processing.
// Any user message after this one is "queued" (waiting for its turn).
export function activeUserMessageID(messages: Message[], status: SessionStatusInfo) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (typeof msg.time?.completed === "number") continue
    if (msg.finish && !["tool-calls", "unknown"].includes(msg.finish)) continue
    if (!msg.parentID) break
    const parent = messages.find((item) => item.id === msg.parentID)
    if (parent?.role === "user") return parent.id
    break
  }

  if (status.type === "idle") return undefined

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].id
  }

  return undefined
}
