/**
 * Project-level configs of workspaces other than the config context's directory.
 *
 * The config context loads one directory — the settings scope. A session in
 * an Agent Manager worktree runs against that worktree's project file, which
 * can pin routing on its own, so controls that must show what applies to the
 * session read it from here and lay it over the (shared, always current)
 * global config. Entries are cached per directory and marked stale on every
 * config message: they stay visible while the refresh is in flight, and a
 * failed refresh keeps the previous entry — the next popover open retries.
 */

import { createSignal } from "solid-js"
import type { ExtensionMessage, WebviewMessage } from "../types/messages"

export interface WorkspaceConfigEntry {
  projectConfig: unknown
  stale?: true
}

interface PendingRequest {
  directory: string
  requestID: number
  post: (message: WebviewMessage) => void
}

const [entries, setEntries] = createSignal<Record<string, WorkspaceConfigEntry>>({})
const pending = new Map<string, PendingRequest>()
let counter = 0

function send(request: PendingRequest): void {
  request.post({ type: "requestWorkspaceConfig", requestID: request.requestID, directory: request.directory })
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
      setEntries((prev) =>
        Object.fromEntries(Object.entries(prev).map(([directory, entry]) => [directory, { ...entry, stale: true }])),
      )
      restartPending()
      return false
    case "workspaceConfigLoaded": {
      // Matched by request ID: the store keys by the directory the request was
      // made for, and a reply to a superseded request is ignored.
      const found = [...pending].find(([, request]) => request.requestID === message.requestID)
      if (!found) return true
      const [directory] = found
      pending.delete(directory)
      if (message.error) return true
      setEntries((prev) => ({ ...prev, [directory]: { projectConfig: message.projectConfig } }))
      return true
    }
    default:
      return false
  }
}

/** Reactive read of the cached project config of a workspace. */
export function workspaceConfigEntry(directory: string): WorkspaceConfigEntry | undefined {
  return entries()[directory]
}

/**
 * Request a workspace's project config unless a fresh entry is cached or a
 * request is in flight. Stale entries stay visible while they refresh.
 */
export function requestWorkspaceConfig(directory: string, post: (message: WebviewMessage) => void): void {
  if (pending.has(directory)) return
  const entry = entries()[directory]
  if (entry && !entry.stale) return
  const request: PendingRequest = { directory, requestID: ++counter, post }
  pending.set(directory, request)
  send(request)
}

/** Test-only: clear cached entries and in-flight bookkeeping. */
export function resetWorkspaceConfigStore(): void {
  setEntries({})
  pending.clear()
  counter = 0
}
