import type { Message } from "../types/messages"

export function cycleAgent(input: {
  agents: Array<{ name: string; mode?: string; hidden?: boolean }>
  scope?: string
  direction: 1 | -1
  selected: (scope?: string) => string
  select: (name: string, scope?: string) => void
}) {
  const available = input.agents.filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  if (available.length <= 1) return
  const index = available.findIndex((agent) => agent.name === input.selected(input.scope))
  const raw = index + input.direction
  const next = raw < 0 ? available.length - 1 : raw >= available.length ? 0 : raw
  const name = available[next]?.name
  if (name) input.select(name, input.scope)
  return name
}

export function resolveSessionAgent(messages: Message[], names: Set<string>): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const name = messages[i]?.agent?.trim()
    if (!name) continue
    if (!names.has(name)) continue
    return name
  }
}

export function resolvePromptAgent(input: {
  sessionID?: string
  selections: Record<string, string>
  pending: string | null
}) {
  if (input.sessionID) {
    const sel = input.selections[input.sessionID]
    if (sel) return sel
    // Only fall back to the pending selection for draft scopes, not real server
    // sessions. A server session with no stored selection must keep its own agent
    // rather than be flipped to the stale/default pending agent.
    if (!input.sessionID.startsWith("ses_")) {
      return input.pending ?? undefined
    }
    return undefined
  }
  return input.pending ?? undefined
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
