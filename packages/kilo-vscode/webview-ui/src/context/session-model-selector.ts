import type { ModelSelection } from "../types/messages"

type Deps = {
  current: () => string | undefined
  agent: (session?: string) => string
  selected: (session?: string) => ModelSelection | null
  variant: (session?: string) => string | undefined
  apply: (agent: string, selection: ModelSelection, session?: string) => void
  set: (session: string, selection: ModelSelection) => void
  carry: (selection: ModelSelection, value: string | undefined, agent: string, session?: string) => void
  hide: (session: string) => void
}

export function createModelSelector(deps: Deps) {
  const select = (providerID: string, modelID: string, sessionID?: string) => {
    const session = sessionID ?? deps.current()
    const agent = deps.agent(session)
    const current = deps.selected(session)
    const value = current ? deps.variant(session) : undefined
    const selection = { providerID, modelID }
    deps.apply(agent, selection, session)
    deps.carry(selection, value, agent, session)
    if (session) deps.hide(session)
  }
  const session = (sessionID: string, providerID: string, modelID: string) => {
    // Session overrides must not mutate the per-mode selection while a new
    // Agent Manager session is still being assigned its agent.
    const agent = deps.agent(sessionID)
    const current = deps.selected(sessionID)
    const value = current ? deps.variant(sessionID) : undefined
    const selection = { providerID, modelID }
    deps.set(sessionID, selection)
    deps.carry(selection, value, agent, sessionID)
  }
  return { select, session }
}
