import type {
  AgentManagerSendInitialMessage,
  FileAttachment,
  SendCommandRequest,
  SendMessageRequest,
} from "../src/types/messages"
import { formatBrowserFeedback } from "../../src/shared/browser-feedback"

interface VariantSession {
  getSessionAgent: (sessionID: string) => string
  setSessionVariant: (sessionID: string, providerID: string, modelID: string, value: string, agent?: string) => void
}

interface PromptSession {
  sendCommand: (
    command: string,
    args: string,
    providerID?: string,
    modelID?: string,
    files?: FileAttachment[],
    draftID?: string,
    context?: string,
    origin?: string | null,
    overrides?: { agent?: string; model?: string; variant?: string; messageID?: string },
    projectId?: string,
  ) => boolean
  submit: (input: SendMessageRequest) => void
}

/**
 * Build the command request for a new worktree whose first prompt is a slash
 * command. The command runs on the just-created session instead of sending
 * literal text.
 */
export function initialCommand(ev: AgentManagerSendInitialMessage): SendCommandRequest | undefined {
  if (!ev.command) return undefined
  return {
    type: "sendCommand",
    ...(ev.projectId ? { projectId: ev.projectId } : {}),
    command: ev.command,
    arguments: ev.arguments ?? "",
    sessionID: ev.sessionId,
    providerID: ev.providerID,
    modelID: ev.modelID,
    agent: ev.agent,
    variant: ev.variant,
    files: ev.files,
  }
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

/**
 * Dispatch a new worktree's first prompt as a command when it is one, or as a
 * plain message otherwise.
 */
export function dispatchInitialPrompt(session: PromptSession, ev: AgentManagerSendInitialMessage): void {
  const command = initialCommand(ev)
  if (command) {
    session.sendCommand(
      command.command,
      command.arguments,
      command.providerID,
      command.modelID,
      command.files,
      undefined,
      undefined,
      command.sessionID,
      { agent: command.agent, variant: command.variant },
      command.projectId,
    )
    return
  }
  const message = initialMessage(ev)
  if (message) session.submit(message)
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
