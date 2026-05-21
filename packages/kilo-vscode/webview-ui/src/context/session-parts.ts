import type { Part } from "../types/messages"

function stream(part: Part): part is Extract<Part, { type: "text" | "reasoning" }> {
  return part.type === "text" || part.type === "reasoning"
}

function newer(local: Part, snapshot: Part): Part {
  if (local.type !== snapshot.type) return snapshot
  if (!stream(local) || !stream(snapshot)) return snapshot
  if (snapshot.time?.end !== undefined) return snapshot
  if (local.text.length <= snapshot.text.length) return snapshot
  if (!local.text.startsWith(snapshot.text)) return snapshot
  return local
}

export function sameParts(local: Part[] = [], snapshot: Part[] = []): boolean {
  if (local.length !== snapshot.length) return false
  for (const [i, part] of snapshot.entries()) {
    const current = local[i]!
    if (current.id !== part.id || current.type !== part.type) return false
    if (!stream(current) || !stream(part)) continue
    if (current.text !== part.text) return false
    if (current.time?.end !== part.time?.end) return false
  }
  return true
}

/**
 * Reconcile snapshots may be older than in-flight streaming deltas. Preserve
 * only appended streamed tail parts and open prefix extensions while still
 * accepting snapshots that heal older removals and completed corrections.
 */
export function mergeParts(local: Part[], snapshot: Part[], since: number): Part[] {
  const by = new Map(snapshot.map((part) => [part.id, part]))
  const last = snapshot.reduce<string | undefined>((id, part) => (!id || part.id > id ? part.id : id), undefined)
  for (const part of local) {
    const current = by.get(part.id)
    if (current) {
      by.set(part.id, newer(part, current))
      continue
    }
    if (!last || !stream(part) || part.id <= last) continue
    if (part.time?.start === undefined || part.time.start < since) continue
    by.set(part.id, part)
  }
  return [...by.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
