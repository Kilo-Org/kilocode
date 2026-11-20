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
export async function dispatchInitialPrompt(
  store: V2,
  ev: AgentManagerSendInitialMessage,
  signal?: AbortSignal,
): Promise<void> {
  const model = initialModel(ev)
  if (model && ev.worktreeId && (ev.text || ev.command)) {
    await waitForModel(store, model, signal)
    signal?.throwIfAborted()
  }
  if (ev.agent) await store.api.session.switchAgent({ sessionID: ev.sessionId, agent: ev.agent })
  if (model) await store.api.session.switchModel({ sessionID: ev.sessionId, model })
  const command = initialCommand(ev)
  if (command) {
    await store.api.session.command(command)
    return
  }
  const message = initialMessage(ev)
  if (message) await store.data.session.prompt(message)
}

async function waitForModel(store: V2, model: ModelRef, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const catalog = store.data.location.model
  const ready = Promise.withResolvers<void>()
  // The worktree's data layer invalidates this resource on model.updated; sync joins its refresh.
  const check = () =>
    catalog
      .sync()
      .then(() => {
        if (catalog.list()?.some((row) => row.enabled && row.providerID === model.providerID && row.id === model.id)) {
          ready.resolve()
        }
      })
      .catch(ready.reject)
  const off = store.data.on("model.updated", check)
  const timeout = setTimeout(() => ready.reject(new DOMException("", "TimeoutError")), 30_000)
  const abort = () => ready.reject(signal?.reason)
  signal?.addEventListener("abort", abort)
  try {
    void check()
    await ready.promise
  } finally {
    off()
    clearTimeout(timeout)
    signal?.removeEventListener("abort", abort)
  }
}
