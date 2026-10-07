import type { Message, ModelSelection, SessionInfo } from "../types/messages"
import { DEFAULT_VARIANT } from "./session-variant-store"

export interface MessagePrefs {
  agent?: string
  /** agent -> latest user message model + variant for that agent */
  picks: Record<string, { model: ModelSelection; variant: string; seq: number }>
  /** Latest user message that names no valid agent, attributed to the session's current agent */
  unattributed?: { model: ModelSelection; variant: string; seq: number }
}

/**
 * Derives per-agent model picks from message history, walking backwards so
 * each agent keeps the model of its own latest user message.
 */
export function resolveMessagePrefs(messages: Message[], names: Set<string>): MessagePrefs {
  const picks: Record<string, { model: ModelSelection; variant: string; seq: number }> = {}
  let unattributed: MessagePrefs["unattributed"]
  let agent: string | undefined
  for (let i = messages.length - 1, seq = 0; i >= 0; i--, seq++) {
    const msg = messages[i]
    if (!msg) continue
    const name = msg.agent?.trim()
    const valid = name && names.has(name) ? name : undefined
    if (!agent && valid) agent = valid
    if (msg.role !== "user" || !msg.model?.providerID || !msg.model.modelID) continue
    const model = { providerID: msg.model.providerID, modelID: msg.model.modelID }
    const variant = msg.model.variant ?? DEFAULT_VARIANT
    if (valid) {
      if (!picks[valid]) picks[valid] = { model, variant, seq }
      continue
    }
    if (!unattributed) unattributed = { model, variant, seq }
  }
  return { agent, picks, unattributed }
}

/**
 * The agent, model and effort a server session last ran with, so a reopened
 * session shows them before its history loads. Unknown agents yield nothing,
 * and a model is only attributed to the agent that ran it.
 */
export function resolveInfoPrefs(info: Pick<SessionInfo, "agent" | "model">, names: Set<string>) {
  const agent = info.agent?.trim()
  if (!agent || !names.has(agent)) return undefined
  if (!info.model?.providerID || !info.model.modelID) return { agent }
  return {
    agent,
    model: { providerID: info.model.providerID, modelID: info.model.modelID },
    variant: info.model.variant ?? DEFAULT_VARIANT,
  }
}
