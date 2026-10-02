import type { ModelSelection } from "../types/messages"

export function createModelSelector(deps: {
  current: () => string
  agent: (sessionID?: string) => string
  selected: (sessionID?: string) => ModelSelection | null
  variant: (sessionID?: string) => string | undefined
  apply: (agent: string, selection: ModelSelection, id: string) => void
  set: (id: string, agent: string, selection: ModelSelection) => void
  carry: (selection: ModelSelection, value: string | undefined, agent: string, sessionID?: string) => void
  hide: (sessionID?: string) => void
}) {
  const select = (providerID: string, modelID: string, sessionID?: string) => {
    const session = sessionID ?? deps.current()
    const agent = deps.agent(session)
    const value = deps.variant(session)
    const selection = { providerID, modelID }
    deps.apply(agent, selection, session)
    deps.carry(selection, value, agent, session)
    if (session) deps.hide(session)
  }

  const session = (sessionID: string, providerID: string, modelID: string) => {
    const agent = deps.agent(sessionID)
    const value = deps.variant(sessionID)
    const selection = { providerID, modelID }
    // Session allocations must not mutate per-mode picks or push recents.
    deps.set(sessionID, agent, selection)
    deps.carry(selection, value, agent, sessionID)
  }

  return { select, session }
}
