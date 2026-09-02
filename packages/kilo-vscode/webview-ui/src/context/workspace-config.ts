/**
 * Effective configs of workspaces other than the config context's directory.
 *
 * The config context loads one directory — the settings scope. A session in
 * an Agent Manager worktree runs against that worktree's effective config,
 * which can carry its own project-level settings, so controls that must show
 * what applies to the session read it from here instead. Entries are cached
 * per directory and dropped on every config message: the global config is
 * shared by all workspaces, so any change to it makes them stale.
 */

import { createSignal } from "solid-js"
import type { ExtensionMessage, WebviewMessage } from "../types/messages"

export interface WorkspaceConfigEntry {
  config: unknown
  projectConfig: unknown
}

interface PendingRequest {
  directory: string
  sessionID: string | undefined
  requestID: number
  post: (message: WebviewMessage) => void
}

const [entries, setEntries] = createSignal<Record<string, WorkspaceConfigEntry>>({})
const pending = new Map<string, PendingRequest>()
let counter = 0

function send(request: PendingRequest): void {
  request.post({
    type: "requestWorkspaceConfig",
    requestID: request.requestID,
    ...(request.sessionID !== undefined ? { sessionID: request.sessionID } : {}),
  })
}

/** Re-issue every in-flight request under a new ID so responses to the old ones are ignored. */
function restartPending(): void {
  for (const [directory, request] of pending) {
    const next = { ...request, requestID: ++counter }
    pending.set(directory, next)
    send(next)
  }
}

/** Feed extension messages into the store. Returns true when consumed. */
export function handleWorkspaceConfigMessage(message: ExtensionMessage): boolean {
  switch (message.type) {
    case "configLoaded":
    case "configUpdated":
    case "globalConfigLoaded":
      setEntries({})
      restartPending()
      return false
    case "workspaceConfigLoaded": {
      const found = [...pending].find(([, request]) => request.requestID === message.requestID)
      if (!found) return true
      const [directory] = found
      pending.delete(directory)
      // A failed lookup is not cached: the control falls back to the config
      // context until the next config message triggers a fresh request.
      if (message.error) return true
      setEntries((prev) => ({
        ...prev,
        [directory]: { config: message.config, projectConfig: message.projectConfig },
      }))
      return true
    }
    default:
      return false
  }
}

/** Reactive read of the cached effective config of a workspace. */
export function workspaceConfigEntry(directory: string): WorkspaceConfigEntry | undefined {
  return entries()[directory]
}

/** Request a workspace's config unless it is cached or a request is in flight. */
export function requestWorkspaceConfig(
  directory: string,
  sessionID: string | undefined,
  post: (message: WebviewMessage) => void,
): void {
  if (pending.has(directory) || entries()[directory]) return
  const request: PendingRequest = { directory, sessionID, requestID: ++counter, post }
  pending.set(directory, request)
  send(request)
}

/** Test-only: clear cached entries and in-flight bookkeeping. */
export function resetWorkspaceConfigStore(): void {
  setEntries({})
  pending.clear()
  counter = 0
}
