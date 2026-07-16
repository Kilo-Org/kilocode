import { createEffect, type Accessor } from "solid-js"
import { remoteSessions } from "./navigate"

type Bridge = {
  postMessage(message: { type: "agentManager.openSessions"; sessionIDs: string[] }): void
}

type VisibleBridge = {
  postMessage(message: { type: "agentManager.visibleSession"; sessionID: string | null }): void
}

type Managed = { id: string; worktreeId: string | null }

export function visible(id: string | undefined, blocked: boolean): string | null {
  if (blocked || !id?.startsWith("ses")) return null
  return id
}

export function reportRemoteSessions(
  vscode: Bridge,
  local: Accessor<string[]>,
  managed: Accessor<Managed[]>,
  pending: (id: string) => boolean,
): void {
  createEffect(() => {
    vscode.postMessage({
      type: "agentManager.openSessions",
      sessionIDs: remoteSessions(local(), managed(), pending),
    })
  })
}

// Report the actually displayed real session id, or null when a terminal,
// review, pending, or empty tab is shown. Drives only visible presence;
// retained attached tabs are unaffected.
export function reportVisibleSession(vscode: VisibleBridge, visible: Accessor<string | null>): void {
  createEffect(() => {
    vscode.postMessage({ type: "agentManager.visibleSession", sessionID: visible() })
  })
}
