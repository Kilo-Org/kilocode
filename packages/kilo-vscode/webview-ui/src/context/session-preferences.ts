import type { Message, ModelSelection } from "../types/messages"

export interface MessagePrefs {
  agent?: string
  model?: ModelSelection
  variant?: string
}

export function resolveMessagePrefs(messages: Message[], names: Set<string>): MessagePrefs {
  const prefs: MessagePrefs = {}
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    if (!prefs.agent) {
      const agent = msg.agent?.trim()
      if (agent && names.has(agent)) prefs.agent = agent
    }
    if (!prefs.model && msg.role === "user" && msg.model?.providerID && msg.model.modelID) {
      prefs.model = { providerID: msg.model.providerID, modelID: msg.model.modelID }
      prefs.variant = msg.model.variant
    }
    if (prefs.agent && prefs.model) break
  }
  return prefs
}
