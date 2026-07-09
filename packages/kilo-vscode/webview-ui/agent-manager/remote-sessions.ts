import { createEffect, type Accessor } from "solid-js"
import { remoteSessions } from "./navigate"

type Bridge = {
  postMessage(message: { type: "agentManager.openSessions"; sessionIDs: string[] }): void
}

type Managed = { id: string; worktreeId: string | null }

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
