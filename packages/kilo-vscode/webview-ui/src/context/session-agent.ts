import type { Message } from "../types/messages"

export function resolveSessionAgent(messages: Message[], names: Set<string>): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const name = messages[i]?.agent?.trim()
    if (!name) continue
    if (!names.has(name)) continue
    return name
  }
}

export function draftAgentSelection(selections: Record<string, string>, draft: string, pending: string | null) {
  if (selections[draft]) return undefined
  return pending ?? undefined
}

export function createDraftAgentSeed(opts: {
  selections: () => Record<string, string>
  pending: () => string | null
  active: (draft: string) => boolean
  set: (draft: string, agent: string) => void
  drop: (draft: string) => void
}) {
  const seeded = new Set<string>()
  return {
    seed(draft: string) {
      const agent = draftAgentSelection(opts.selections(), draft, opts.pending())
      if (!agent) return
      opts.set(draft, agent)
      seeded.add(draft)
    },
    promote(draft: string) {
      seeded.delete(draft)
    },
    prune(draft?: string) {
      if (!draft || opts.active(draft) || !seeded.delete(draft)) return
      opts.drop(draft)
    },
  }
}
