/**
 * The first prompt of a new worktree.
 *
 * The host asks the panel to send it after it created the worktree and its session. The prompt goes through the v2
 * client of that worktree's store: the session is switched to the requested agent and model first, then the prompt is
 * admitted, or the slash command is run. The panel stores nothing itself for this; the events update the store.
 */
import type { ModelRef } from "@opencode/client"
import type { AgentManagerSendInitialMessage } from "../src/types/messages/agent-manager"
import type { V2 } from "../src/v2/scope"

type InitialFile = { uri: string; name?: string; mention?: { start: number; end: number; text: string } }

/** The host names files by mime and URL; the v2 prompt takes a URI, and an `@` mention its name and span. */
export function initialFiles(files: AgentManagerSendInitialMessage["files"]): InitialFile[] | undefined {
  if (!files?.length) return undefined
  return files.map((file) => ({
    uri: file.url,
    ...(file.name ? { name: file.name } : {}),
    ...(file.mention ? { mention: file.mention } : {}),
  }))
}

/** The model a first prompt runs on, with the requested reasoning effort. */
export function initialModel(ev: AgentManagerSendInitialMessage): ModelRef | undefined {
  if (!ev.providerID || !ev.modelID) return undefined
  return { id: ev.modelID, providerID: ev.providerID, ...(ev.variant !== undefined ? { variant: ev.variant } : {}) }
}

export function initialCommand(ev: AgentManagerSendInitialMessage) {
  if (!ev.command) return undefined
  return { sessionID: ev.sessionId, name: ev.command, text: ev.arguments ?? "", files: initialFiles(ev.files) }
}

export function initialMessage(ev: AgentManagerSendInitialMessage) {
  if (!ev.text) return undefined
  return { sessionID: ev.sessionId, text: ev.text, files: initialFiles(ev.files) }
}

/**
 * Dispatch a new worktree's first prompt as a command when it is one, or as a plain message otherwise. An empty
 * request leaves the just-created session idle as the host asked (it only wants the busy state cleared).
 */
export async function dispatchInitialPrompt(store: V2, ev: AgentManagerSendInitialMessage): Promise<void> {
  if (ev.agent) await store.api.session.switchAgent({ sessionID: ev.sessionId, agent: ev.agent })
  const model = initialModel(ev)
  if (model) await store.api.session.switchModel({ sessionID: ev.sessionId, model })
  const command = initialCommand(ev)
  if (command) {
    await store.api.session.command(command)
    return
  }
  const message = initialMessage(ev)
  if (message) await store.data.session.prompt(message)
}