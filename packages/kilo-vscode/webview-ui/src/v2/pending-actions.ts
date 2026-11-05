// The delivery choices for a prompt while the agent runs: steer the running turn now, queue it until the turn ends,
// or stop everything (running tools too) and send it now.
import type { DataPendingStatus } from "@opencode/client/solid"

export type SendMode = "steer" | "queue" | "now"
export type PendingAction = "now" | "steer" | "queue" | "edit" | "delete"

type Key = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey">
type Last = { type: string; status?: string; content?: readonly { type: string; state?: { status: string } }[] }

/** The delivery a composer keystroke asks for. The modifiers only change a send while the session runs. */
export function sendMode(event: Key, running: boolean, mac = isMac()): SendMode {
  if (!running) return "steer"
  if (mac ? event.metaKey : event.ctrlKey) return "now"
  if (event.altKey) return "queue"
  return "steer"
}

export function sendShortcuts(mac = isMac()) {
  return mac ? { steer: "↵", queue: "⌥↵", now: "⌘↵" } : { steer: "Enter", queue: "Alt+Enter", now: "Ctrl+Enter" }
}

/**
 * Whether a steer has to stop the current model call to reach the model now. That is the case while the model
 * thinks or writes: the next step boundary only comes after the whole response. A running tool or compaction is not
 * stopped; the steer is delivered when it finishes, which is the next step boundary. `last` is the newest message.
 */
export function steerInterrupts(last: Last | undefined): boolean {
  if (last?.type === "compaction") return last.status !== "running"
  if (last?.type !== "assistant") return true
  return !last.content?.some((item) => item.type === "tool" && item.state?.status === "running")
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
