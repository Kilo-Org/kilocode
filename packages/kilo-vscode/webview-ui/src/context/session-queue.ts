import type { Message, SessionStatusInfo } from "../types/messages"

function active(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (typeof msg.time?.completed === "number") continue
    if (msg.error) continue
    if (msg.finish && !["tool-calls", "unknown"].includes(msg.finish)) continue
    if (!msg.parentID) break
    const parent = messages.find((item) => item.id === msg.parentID)
    if (parent?.role === "user") return parent.id
    break
  }

  return undefined
}

function pending(messages: Message[]) {
  const done = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i]
      if (msg.role !== "assistant") continue
      if (typeof msg.time?.completed === "number") return i
      if (msg.error) return i
      if (msg.finish && !["tool-calls", "unknown"].includes(msg.finish)) return i
    }
    return -1
  })()

  for (let i = done + 1; i < messages.length; i += 1) {
    if (messages[i].role === "user") return messages[i].id
  }

  return undefined
}

// Find the user message whose turn the server is actively processing.
// Any user message after this one is "queued" (waiting for its turn).
export function activeUserMessageID(messages: Message[], status: SessionStatusInfo) {
  const id = active(messages)
  if (id) return id
  if (status.type === "idle") return undefined
  return pending(messages)
}

export function queuedUserMessageIDs(messages: Message[], status: SessionStatusInfo) {
  if (status.type === "idle") return []
  const users = messages.filter((msg) => msg.role === "user")
  const id = active(messages) ?? pending(messages)
  const idx = id ? users.findIndex((msg) => msg.id === id) : -1
  if (idx < 0) return []
  return users.slice(idx + 1).map((msg) => msg.id)
}
