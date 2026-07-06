import type { Message, Part, SessionInfo, SessionStatusInfo } from "../types/messages"

export type RevertBoundary = Pick<NonNullable<SessionInfo["revert"]>, "messageID" | "partID">

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

function isCompact(msg: Message, parts?: (msg: Message) => Message["parts"]) {
  return msg.role === "user" && (parts?.(msg) ?? msg.parts)?.some((part) => part.type === "compaction")
}

function target(messages: Message[], index: number, id: string, parts?: (msg: Message) => Message["parts"]) {
  const parent = messages.findIndex((msg) => msg.id === id)
  for (let i = index - 1; i > parent; i -= 1) {
    const msg = messages[i]
    if (msg && isCompact(msg, parts)) return msg.id
  }
  return id
}

function visibleMessage(id: string, revert?: RevertBoundary) {
  if (!revert || id < revert.messageID) return true
  return id === revert.messageID && !!revert.partID
}

export function visibleParts(id: string, parts: Part[], revert?: RevertBoundary) {
  if (!revert || id < revert.messageID) return parts
  if (id !== revert.messageID || !revert.partID) return []
  const idx = parts.findIndex((part) => part.id === revert.partID)
  return idx < 0 ? [] : parts.slice(0, idx)
}

export function messageTurns(
  messages: Message[],
  revert?: RevertBoundary,
  parts?: (msg: Message) => Message["parts"],
): MessageTurn[] {
  const result: MessageTurn[] = []
  const lead: Message[] = []
  const by = new Map<string, { turn: MessageTurn; index: number }>()
  const projected = (msg: Message) => visibleParts(msg.id, parts?.(msg) ?? msg.parts ?? [], revert)
  let compact: { turn: MessageTurn; index: number } | undefined

  for (const msg of messages) {
    if (!visibleMessage(msg.id, revert)) continue
    if (msg.role === "user") {
      const turn = { id: msg.id, user: msg, assistant: [] }
      const item = { turn, index: result.length }
      result.push(turn)
      by.set(msg.id, item)
      if (isCompact(msg, projected)) compact = item
      continue
    }

    if (msg.role !== "assistant") continue
    const parent = msg.parentID ? by.get(msg.parentID) : undefined
    if (parent) {
      const turn = compact && parent.index < compact.index ? compact.turn : parent.turn
      turn.assistant.push(msg)
      continue
    }
    if (msg.parentID) {
      if (compact) {
        compact.turn.assistant.push(msg)
        continue
      }
      lead.push(msg)
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

export function visibleMessages(
  messages: Message[],
  revert?: RevertBoundary,
  parts?: (msg: Message) => Message["parts"],
): Message[] {
  return messageTurns(messages, revert, parts).flatMap((turn) =>
    turn.partial ? turn.assistant : [turn.user, ...turn.assistant],
  )
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

function active(messages: Message[], status: SessionStatusInfo, parts?: (msg: Message) => Message["parts"]) {
  let latest = true
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (!msg || msg.role !== "assistant") continue
    const resumable = msg.finish === "tool-calls" || msg.finish === "unknown"
    const running = latest && status.type !== "idle" && resumable
    latest = false
    if (typeof msg.time?.completed === "number" && !running) continue
    if (msg.error) continue
    if (msg.finish && !resumable) continue
    if (!msg.parentID) break
    const id = target(messages, i, msg.parentID, parts)
    const parent = messages.find((item) => item.id === id)
    if (!parent) return id
    if (parent.role === "user") return parent.id
    break
  }

  return undefined
}

function done(messages: Message[], parts?: (msg: Message) => Message["parts"]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (!msg || msg.role !== "assistant" || !msg.parentID) continue
    if (typeof msg.time?.completed === "number") return target(messages, i, msg.parentID, parts)
    if (msg.error) return target(messages, i, msg.parentID, parts)
    if (msg.finish && !["tool-calls", "unknown"].includes(msg.finish)) return target(messages, i, msg.parentID, parts)
  }
  return undefined
}

function pending(messages: Message[], parts?: (msg: Message) => Message["parts"]) {
  const users = messages.filter((msg) => msg.role === "user")
  const id = done(messages, parts)
  if (!id) return users[0]?.id

  const idx = users.findIndex((msg) => msg.id === id)
  return users[idx + 1]?.id
}

// Find the user message whose turn the server is actively processing.
// Any user message after this one is "queued" (waiting for its turn).
export function activeUserMessageID(
  messages: Message[],
  status: SessionStatusInfo,
  parts?: (msg: Message) => Message["parts"],
) {
  const id = active(messages, status, parts)
  if (id) return id
  if (status.type === "idle") return undefined
  return pending(messages, parts)
}

export function queuedUserMessageIDs(
  messages: Message[],
  status: SessionStatusInfo,
  parts?: (msg: Message) => Message["parts"],
) {
  if (status.type === "idle") return []
  const users = messages.filter((msg) => msg.role === "user")
  const running = active(messages, status, parts)
  if (running) {
    const idx = users.findIndex((msg) => msg.id === running)
    if (idx < 0) return users.map((msg) => msg.id)
    return users.slice(idx + 1).map((msg) => msg.id)
  }
  const id = pending(messages, parts)
  const idx = id ? users.findIndex((msg) => msg.id === id) : -1
  if (idx < 0) return []
  return users.slice(idx + 1).map((msg) => msg.id)
}

export function partitionTurns(turns: MessageTurn[], ids: ReadonlySet<string>, queued: ReadonlySet<string>) {
  const visible = turns.filter((turn) => !queued.has(turn.user.id))
  const waiting = turns.filter((turn) => queued.has(turn.user.id))
  const idx = visible.findIndex((turn) => ids.has(turn.user.id))
  if (idx === -1) return { virtual: visible, direct: [] as MessageTurn[], queued: waiting }
  return { virtual: visible.slice(0, idx), direct: visible.slice(idx), queued: waiting }
}
