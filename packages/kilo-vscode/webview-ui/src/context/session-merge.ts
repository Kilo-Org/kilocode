import type { Message, MessageLoadMode, Part } from "../types/messages"
import { sameParts } from "./session-parts"
import { withoutResolvedSessionErrors } from "./session-errors"

export function mergeMessages(current: Message[], incoming: Message[], mode: Exclude<MessageLoadMode, "focus">) {
  const kept = withoutResolvedSessionErrors(current, incoming)
  if (mode === "reconcile") {
    // Tail reconcile: incoming is the authoritative newest-N snapshot.
    // Local state may already hold some of those IDs and may also hold
    // newer optimistic entries created after the fetch was taken. Merge
    // by id (server wins on collision) then sort by createdAt so new
    // server messages land in the right position and optimistic tail
    // entries stay at the end.
    const byId = new Map<string, Message>()
    for (const msg of kept) byId.set(msg.id, msg)
    for (const msg of incoming) byId.set(msg.id, msg)
    return [...byId.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }
  const seen = new Set<string>()
  const source = mode === "prepend" ? [...incoming, ...kept] : incoming
  return source.filter((msg) => {
    if (seen.has(msg.id)) return false
    seen.add(msg.id)
    return true
  })
}

// Cheap tail check: same ids in the same order and no visible streamed-part
// correction to apply. It skips store churn when SSE already matches the
// snapshot, but lets reconcile heal part removals and finalized text.
export function sameReconcileShape(
  current: Message[],
  incoming: Message[],
  getParts: (messageID: string) => Part[] | undefined,
): boolean {
  if (current.length !== incoming.length) return false
  for (const [i, n] of incoming.entries()) {
    const c = current[i]!
    if (c.id !== n.id) return false
    if (!sameParts(getParts(c.id) ?? c.parts, n.parts)) return false
  }
  return true
}
