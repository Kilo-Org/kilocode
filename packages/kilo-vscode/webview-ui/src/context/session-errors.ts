import type { Message } from "../types/messages"

type Entry = { id: string; error?: Message["error"] }
type Error = NonNullable<Message["error"]>

function sameError(a: Message, b: Message) {
  if (!a.error || !b.error || a.error.name !== b.error.name) return false
  if (a.parentID !== b.parentID) return false
  return JSON.stringify(a.error.data) === JSON.stringify(b.error.data)
}

export function withoutResolvedSessionErrors(current: Message[], incoming: Message[]) {
  const events = new Set(incoming.map((msg) => msg.sessionErrorID).filter((id): id is string => !!id))
  return current.filter((msg) => {
    if (!msg.sessionErrorID) return true
    if (events.has(msg.sessionErrorID)) return false
    return !incoming.some((next) => !next.sessionErrorID && sameError(msg, next))
  })
}

export function preserveSessionErrors(current: Message[], incoming: Message[]) {
  const ids = new Set(incoming.map((msg) => msg.id))
  const errors = withoutResolvedSessionErrors(current, incoming).filter((msg) => msg.sessionErrorID && !ids.has(msg.id))
  return [...incoming, ...errors]
}

export function errorIDs(messages: Entry[]) {
  return messages.filter((msg) => !!msg.error).map((msg) => msg.id)
}

export function visibleError(messages: Entry[], hidden: (id: string) => boolean): Error | undefined {
  return messages.find((msg) => msg.error && msg.error.name !== "MessageAbortedError" && !hidden(msg.id))?.error
}
