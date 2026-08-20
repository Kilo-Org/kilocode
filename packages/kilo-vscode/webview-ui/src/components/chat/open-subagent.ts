/**
 * Single entry point for revealing a sub-agent session.
 *
 * Agent Manager shows sub-agents in its shared right-hand inspector, the
 * sidebar opens them as an editor tab. Both the task card and the background
 * agent strip route through here so the two surfaces cannot drift apart.
 */

import type { WebviewMessage } from "../../types/messages"

interface OpenSubagent {
  sessionID: string
  title?: string
  parentSessionID?: string
  /** True inside Agent Manager, where the inspector replaces the editor tab. */
  worktree: boolean
  post: (message: WebviewMessage) => void
}

export function openSubagent(input: OpenSubagent) {
  if (!input.sessionID) return
  if (input.worktree) {
    window.dispatchEvent(
      new CustomEvent("agentManager.openSubagent", {
        detail: { sessionID: input.sessionID, title: input.title, parentSessionID: input.parentSessionID },
      }),
    )
    return
  }
  input.post({
    type: "openSubAgentViewer",
    sessionID: input.sessionID,
    title: input.title,
    parentSessionID: input.parentSessionID,
  })
}
