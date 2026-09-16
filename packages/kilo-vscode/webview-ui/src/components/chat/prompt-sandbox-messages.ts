import type {
  ExtensionMessage,
  SandboxDefaultStatusMessage,
  SandboxStatusMessage,
  SandboxStatusErrorMessage,
} from "../../types/messages"
import { applySandboxStates, type SandboxDefaultState, type SandboxState } from "./prompt-input-utils"

type Input = {
  connected: () => boolean
  session: () => string | null | undefined
  pending: (sessionID?: string) => string | undefined
  clear: (sessionID: string | undefined, requestID: string) => void
  defaults: () => SandboxDefaultState | undefined
  setDefault: (state: SandboxDefaultState) => void
  states: () => Record<string, SandboxState>
  setStates: (states: Record<string, SandboxState>) => void
  reset: () => void
  retry: (sessionID: string) => void
  refresh: () => void
  error: (reason: string | undefined) => void
}

function defaults(message: SandboxDefaultStatusMessage, input: Input) {
  const matching = message.requestID !== undefined && message.requestID === input.pending(undefined)
  if (input.session() && !matching) return false
  if (!input.connected()) return true
  if (matching) input.clear(undefined, message.requestID!)
  const current = input.defaults()
  if (!current || current.revision <= message.revision) {
    input.setDefault({
      desired: message.desired,
      enabled: message.enabled,
      available: message.available,
      reason: message.reason,
      revision: message.revision,
    })
  }
  if (matching && !message.available) input.error(message.reason)
  return true
}

function status(message: SandboxStatusMessage, input: Input) {
  const matching = message.requestID !== undefined && message.requestID === input.pending(message.sessionID)
  if (!input.connected()) return true
  const current = input.states()
  if (matching) input.clear(message.sessionID, message.requestID!)
  const next = applySandboxStates(current, message)
  if (next !== current) input.setStates(next)
  const state = next[message.sessionID]
  if (message.sessionID === input.session()) input.reset()
  if (matching && !state.available) input.error(state.reason)
  return true
}

function failure(message: SandboxStatusErrorMessage, input: Input) {
  const matching = message.requestID !== undefined && message.requestID === input.pending(message.sessionID)
  if (!input.connected()) return true
  const current = input.states()
  const state = current[message.sessionID]
  if (matching) input.clear(message.sessionID, message.requestID!)
  if ((state?.revision ?? -1) > message.revision) return true
  if (!message.requestID) {
    const same = state?.directory === message.directory
    input.setStates(
      applySandboxStates(current, {
        sessionID: message.sessionID,
        directory: message.directory,
        enabled: same ? state.enabled : false,
        available: false,
        reason: message.message,
        version: same ? state.version : 0,
        revision: message.revision,
      }),
    )
    if (message.sessionID === input.session()) input.retry(message.sessionID)
  }
  if (matching) input.error(message.message)
  return true
}

export function sandboxMessages(input: Input) {
  return (message: ExtensionMessage) => {
    switch (message.type) {
      case "sandboxDefaultStatus":
        return defaults(message, input)
      case "sandboxStatus":
        return status(message, input)
      case "sandboxStatusError":
        return failure(message, input)
      case "configUpdated":
        input.refresh()
        return true
      default:
        return false
    }
  }
}
