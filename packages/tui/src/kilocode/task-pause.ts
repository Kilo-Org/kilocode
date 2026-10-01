// A user interrupt from a subagent view pauses the parent's task instead of
// ending it. The server marks the paused child session in its metadata while
// the pause is live; the subagent footer and the parent's task card read it.
import type { Session } from "@kilocode/sdk/v2"

// Must match `KEY` in packages/opencode/src/kilocode/tool/task-pause.ts.
export const KEY = "kilo.task"

type Target = Pick<Session, "metadata"> | undefined

/** Whether the subagent's task is paused awaiting the user. */
export function paused(session: Target) {
  const value = session?.metadata?.[KEY]
  return !!value && typeof value === "object" && "status" in value && value.status === "paused"
}

/** Task card line for a paused task; foreground tasks can also be sent to the background. */
export function detail(foreground: boolean, key: string | undefined) {
  const base = "Interrupted — waiting for you"
  if (!foreground) return base
  return `${base} · ${key || "ctrl+b"} background`
}

export * as KiloTaskPause from "./task-pause"
