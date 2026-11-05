// The delivery choices for a prompt while the agent runs: steer it into the running turn at the next step boundary,
// queue it until the turn ends, or stop the current response and send it now.
import type { DataPendingStatus } from "@opencode/client/solid"

export type SendMode = "steer" | "queue" | "now"
export type PendingAction = "now" | "steer" | "queue" | "edit" | "delete"

type Key = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey">

/** The delivery a composer keystroke asks for. The modifiers only change a send while the session runs. */
export function sendMode(event: Key, running: boolean, mac = isMac()): SendMode {
  if (!running) return "steer"
  if (mac ? event.metaKey : event.ctrlKey) return "now"
  if (event.altKey) return "queue"
  return "steer"
}

export function sendShortcuts(mac = isMac()) {
  return { queue: mac ? "⌥Enter" : "Alt+Enter", now: mac ? "⌘Enter" : "Ctrl+Enter" }
}

/** The controls of one pending prompt. Edit needs a text-only prompt, because the composer holds text only. */
export function pendingActions(status: DataPendingStatus, editable: boolean): PendingAction[] {
  const edit: PendingAction[] = editable ? ["edit"] : []
  if (status === "queued") return ["steer", ...edit, "delete"]
  // The next idle boundary already promotes a starting prompt, so there is nothing to stop for it.
  if (status === "starting") return ["queue", ...edit, "delete"]
  return ["now", "queue", ...edit, "delete"]
}

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
}
