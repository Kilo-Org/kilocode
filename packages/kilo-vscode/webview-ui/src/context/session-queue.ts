import type { Message, SessionStatusInfo } from "../types/messages"

export interface MessageTurn {
  id: string
  user: Message
  assistant: Message[]
}

export function messageTurns(messages: Message[], boundary?: string) {
  const result: MessageTurn[] = []
  const by = new Map<string, MessageTurn>()

  for (const msg of messages) {
    if (msg.role === "user") {
      if (boundary && msg.id >= boundary) break
      const turn = { id: msg.id, user: msg, assistant: [] }
      result.push(turn)
      by.set(msg.id, turn)
      continue
    }

    if (msg.role !== "assistant") continue
    const turn = (msg.parentID ? by.get(msg.parentID) : undefined) ?? result[result.length - 1]
    if (turn) turn.assistant.push(msg)
  }

  return result
}

function active(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (!msg || msg.role !== "assistant") continue
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

function done(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (!msg || msg.role !== "assistant") continue
    if (typeof msg.time?.completed === "number") return msg.parentID
    if (msg.error) return msg.parentID
    if (msg.finish && !["tool-calls", "unknown"].includes(msg.finish)) return msg.parentID
  }
  return undefined
}

function pending(messages: Message[]) {
  const users = messages.filter((msg) => msg.role === "user")
  const id = done(messages)
  if (!id) return users[0]?.id

  const idx = users.findIndex((msg) => msg.id === id)
  return users[idx + 1]?.id
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
