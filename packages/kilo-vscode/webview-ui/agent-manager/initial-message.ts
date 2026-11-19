/**
 * The first prompt of a new worktree.
 *
 * The host asks the panel to send it after it created the worktree and its session. The prompt goes through the v2
 * client of that worktree's store: the session is switched to the requested agent and model first, then the prompt is
 * admitted, or the slash command is run. The panel stores nothing itself for this; the events update the store.
 */
import type { ModelRef } from "@opencode/client"
import { waitForModel } from "@opencode/client/kilocode/model-startup"
import type { AgentManagerSendInitialMessage } from "../src/types/messages/agent-manager"
import type { V2 } from "../src/v2/scope"
import { parseCommandModel } from "../src/components/settings/agent-behaviour/command-model"

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
export async function dispatchInitialPrompt(
  store: V2,
  ev: AgentManagerSendInitialMessage,
  signal?: AbortSignal,
): Promise<void> {
  const command = initialCommand(ev)
  const message = initialMessage(ev)
  if (!command && !message) return
  const model = initialModel(ev)
  const location = { directory: store.directory }
  const commands = command ? await store.api.command.list({ location }, { signal }) : undefined
  const own = parseCommandModel(commands?.data.find((item) => item.name === command?.name)?.model)
  await waitForModel(store.api, {
    location,
    model: own
      ? { providerID: own.providerID, id: own.modelID }
      : (model ?? store.data.session.get(ev.sessionId)?.model),
    signal,
  })
  signal?.throwIfAborted()
  if (ev.agent) await store.api.session.switchAgent({ sessionID: ev.sessionId, agent: ev.agent }, { signal })
  if (model && !own) await store.api.session.switchModel({ sessionID: ev.sessionId, model }, { signal })
  signal?.throwIfAborted()
  if (command) {
    await store.api.session.command(command, { signal })
    return
  }
  if (message)
    await store.data.session.prompt({
      ...message,
      ...(signal ? { prepare: async () => signal.throwIfAborted() } : {}),
    })
}
