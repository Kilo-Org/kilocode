// The single way a webview reveals a subagent session. The Agent Manager shows subagents in its inspector beside the
// parent chat; the sidebar and a subagent editor tab ask the host for a read-only editor tab of the child session.
import type { SubagentTarget, ToHost } from "../../../src/protocol"

export type SubagentSurface = "inspector" | "tab"

/** The window event the Agent Manager inspector listens to. */
export const OPEN_SUBAGENT_EVENT = "agentManager.openSubagent"

export function openSubagent(
  input: SubagentTarget & { surface: SubagentSurface; post: (message: ToHost) => void },
) {
  if (!input.sessionID) return
  const target = { sessionID: input.sessionID, title: input.title, parentSessionID: input.parentSessionID }
  if (input.surface === "inspector") {
    window.dispatchEvent(new CustomEvent(OPEN_SUBAGENT_EVENT, { detail: target }))
    return
  }
  input.post({ type: "openSubagent", ...target })
}
