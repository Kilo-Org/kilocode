import type { Message, SessionStatusInfo } from "../types/messages"

export interface MessageTurn {
  id: string
  user: Message
  assistant: Message[]
  partial?: boolean
}

function key(msg: Message) {
  return msg.parentID ?? msg.id
}

function partial(messages: Message[]): MessageTurn {
  const first = messages[0]!
  const id = first.parentID ?? `${first.id}:partial`
  return {
    id,
    user: {
      id,
      sessionID: first.sessionID,
      role: "user",
      createdAt: first.createdAt,
      time: first.time,
    },
    assistant: messages,
    partial: true,
  }
}

function partials(messages: Message[]): MessageTurn[] {
  return messages
    .reduce<Message[][]>((groups, msg) => {
      const prev = groups[groups.length - 1]
      if (!prev || key(prev[0]!) !== key(msg)) {
        groups.push([msg])
        return groups
      }
      prev.push(msg)
      return groups
    }, [])
    .map(partial)
}

export function messageTurns(messages: Message[], boundary?: string): MessageTurn[] {
  const result: MessageTurn[] = []
  const lead: Message[] = []
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
    const turn = msg.parentID ? by.get(msg.parentID) : undefined
    if (turn) {
      turn.assistant.push(msg)
      continue
    }
    const last = result[result.length - 1]
    if (last) {
      last.assistant.push(msg)
      continue
    }
    lead.push(msg)
  }

  if (lead.length === 0) return result
  return [...partials(lead), ...result]
}

function sameMessages(a: Message[], b: Message[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// Keep virtua's item keys stable across prepends; Solid's adapter keys by data object identity.
export function stableMessageTurns(next: MessageTurn[], prev: MessageTurn[] = []): MessageTurn[] {
  if (prev.length === 0) return next
  const by = new Map(prev.map((turn) => [turn.user.id, turn]))
  return next.map((turn) => {
    const old = by.get(turn.user.id)
    if (!old) return turn
    if (old.partial !== turn.partial) return turn
    if (!turn.partial && old.user !== turn.user) return turn
    if (!sameMessages(old.assistant, turn.assistant)) return turn
    return old
  })
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
