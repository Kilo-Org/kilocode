import type { AgentManagerSendInitialMessage, SendMessageRequest } from "../src/types/messages"

interface VariantSession {
  getSessionAgent: (sessionID: string) => string
  setSessionVariant: (sessionID: string, providerID: string, modelID: string, value: string, agent?: string) => void
}

export function initialMessage(ev: AgentManagerSendInitialMessage): SendMessageRequest | undefined {
  if (!ev.text) return undefined
  return {
    type: "sendMessage",
    text: ev.text,
    sessionID: ev.sessionId,
    providerID: ev.providerID,
    modelID: ev.modelID,
    agent: ev.agent,
    variant: ev.variant,
    files: ev.files,
  }
}

export function initialVariant(ev: AgentManagerSendInitialMessage, agent: string) {
  if (!ev.providerID || !ev.modelID || !ev.variant) return undefined
  return {
    sessionID: ev.sessionId,
    providerID: ev.providerID,
    modelID: ev.modelID,
    agent: ev.agent ?? agent,
    value: ev.variant,
  }
}

export function seedInitialVariant(session: VariantSession, ev: AgentManagerSendInitialMessage) {
  const state = initialVariant(ev, session.getSessionAgent(ev.sessionId))
  if (!state) return
  session.setSessionVariant(state.sessionID, state.providerID, state.modelID, state.value, state.agent)
}
