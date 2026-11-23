import type { Message, ModelSelection, SessionInfo } from "../types/messages"
import { resolveInfoPrefs, resolveMessagePrefs } from "./session-preferences"
import { variantKey } from "./session-variant-store"

interface Store {
  agentSelections: Record<string, string>
  sessionOverrides: Record<string, Record<string, ModelSelection>>
  variantSelections: Record<string, string>
}

/**
 * Recovers a session's agent, per-agent picks and effort from server session
 * info and message history, filling only what the scope has not chosen.
 */
export function createSessionRecovery(opts: {
  store: Store
  select: (id: string, agent: string) => void
  pick: (id: string, agent: string, model: ModelSelection) => void
  variant: (key: string, value: string) => void
  agent: (id: string) => string
  names: () => Set<string>
}) {
  function fill(id: string, agent: string, model: ModelSelection, variant: string) {
    if (!opts.store.sessionOverrides[id]?.[agent]) opts.pick(id, agent, model)
    const key = variantKey(model, agent, id)
    if (opts.store.variantSelections[key] === undefined) opts.variant(key, variant)
  }

  function messages(id: string, list: Message[], names = opts.names()) {
    const prefs = resolveMessagePrefs(list, names)
    if (prefs.agent && !opts.store.agentSelections[id]) opts.select(id, prefs.agent)
    const entries = new Map(Object.entries(prefs.picks))
    if (prefs.unattributed) {
      // Attribute it to the agent this scope resolves to, as readers do.
      const owner = opts.agent(id)
      const existing = entries.get(owner)
      if (!existing || prefs.unattributed.seq < existing.seq) entries.set(owner, prefs.unattributed)
    }
    for (const [agent, pick] of entries) fill(id, agent, pick.model, pick.variant)
  }

  // Server session info names the agent and model a session last ran with, so
  // a reopened session shows them before its history loads.
  function info(session: SessionInfo, names = opts.names()) {
    const prefs = resolveInfoPrefs(session, names)
    if (!prefs) return
    if (!opts.store.agentSelections[session.id]) opts.select(session.id, prefs.agent)
    if (prefs.model) fill(session.id, prefs.agent, prefs.model, prefs.variant)
  }

  return { messages, info }
}
