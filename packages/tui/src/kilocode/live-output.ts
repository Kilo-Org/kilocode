export const STALL_GRACE_MS = 3000
const STALL_MAX_MS = 30_000

export function liveReasoningCode(done: boolean) {
  return {
    drawUnstyledText: true,
    streaming: !done,
  }
}

export function liveAssistantMarkdown(done: boolean) {
  return {
    streaming: !done,
  }
}

export type Delta = {
  sessionID: string
  messageID: string
  partID: string
  field: string
  delta: string
}

export function queue(pending: Map<string, Delta[]>, item: Delta) {
  const list = pending.get(item.partID)
  if (list) {
    list.push(item)
    return
  }
  pending.set(item.partID, [item])
}

export function take(pending: Map<string, Delta[]>, partID: string) {
  const list = pending.get(partID) ?? []
  pending.delete(partID)
  return list
}

export function drop(pending: Map<string, Delta[]>, sessionID: string) {
  for (const [id, items] of pending) {
    if (items[0]?.sessionID === sessionID) pending.delete(id)
  }
}

export function apply(text: string, items: Delta[]) {
  if (text.length > 0) return text
  let next = text
  for (const item of items) next += item.delta
  return next
}

export function live(status?: { type: string }) {
  return status?.type === "busy" || status?.type === "retry"
}

export function wait(attempt: number, grace = STALL_GRACE_MS) {
  return Math.min(grace * 2 ** attempt, STALL_MAX_MS)
}

export function mark(input: {
  status?: { type: string }
  last?: { id: string; role: string; time?: object }
  parts: Array<{ id: string; type: string; text?: string; state?: { status?: string } }>
}) {
  const time = input.last?.time
  const done = time && "completed" in time ? time.completed : undefined
  const parts = input.parts.map((part) => {
    if ("text" in part && (part.type === "text" || part.type === "reasoning"))
      return `${part.id}:${part.text?.length ?? 0}`
    if (part.state?.status) return `${part.id}:${part.state.status}`
    return part.id
  })
  return [input.status?.type, input.last?.id, input.last?.role, done, ...parts].join("|")
}
