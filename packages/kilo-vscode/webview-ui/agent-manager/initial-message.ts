import type { AgentManagerSendInitialMessage, SendMessageRequest } from "../src/types/messages"
import { formatBrowserFeedback } from "../../src/shared/browser-feedback"

interface VariantSession {
  getSessionAgent: (sessionID: string) => string
  setSessionVariant: (sessionID: string, providerID: string, modelID: string, value: string, agent?: string) => void
}

export function initialMessage(ev: AgentManagerSendInitialMessage): SendMessageRequest | undefined {
  if (!ev.text) return undefined
  const text = ev.browserFeedback ? `${formatBrowserFeedback(ev.browserFeedback.references)}\n\n${ev.text}` : ev.text
  return {
    type: "sendMessage",
    ...(ev.projectId ? { projectId: ev.projectId } : {}),
    text,
    sessionID: ev.sessionId,
    providerID: ev.providerID,
    modelID: ev.modelID,
    agent: ev.agent,
    variant: ev.variant,
    files: ev.files,
    browserFeedback: ev.browserFeedback,
  }
}

export function initialVariant(ev: AgentManagerSendInitialMessage, agent: string) {
  if (!ev.providerID || !ev.modelID || ev.variant === undefined) return undefined
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
