import type { SessionStatusInfo } from "../../types/messages"

export function taskRunning(status: string | undefined) {
  return status === "pending" || status === "running"
}

/**
 * True when a task card is a background task. The streamed input carries the
 * flag from the first part update, while a promoted task only gains the state
 * metadata flag later, so the input wins when both are present.
 */
export function taskBackground(
  input: Record<string, unknown> | undefined,
  part: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
) {
  if (input?.background === true) return true
  return (part?.background ?? metadata?.background) === true
}

/**
 * Auto-open a task card only once it is running and not a background task.
 * While the call is pending the streamed input cannot yet tell a background
 * task from a foreground one, and a background card must never open on its own.
 */
export function taskAutoOpen(status: string | undefined, background: boolean) {
  return status === "running" && !background
}

/**
 * Avatar state for a Task card. The child session's live status wins, because
 * a background Task tool part completes as soon as the child is started while
 * the child keeps working. Finished and waiting children keep a static glyph.
 */
export function taskAvatarStatus(
  id: string | undefined,
  tool: string | undefined,
  status: Record<string, SessionStatusInfo>,
) {
  if (id && (status[id]?.type === "busy" || status[id]?.type === "retry")) return "running" as const
  if (taskRunning(tool)) return "running" as const
  return undefined
}

export function childForeground(
  id: string | undefined,
  part: Record<string, unknown> | undefined,
  state: Record<string, unknown> | undefined,
  status: Record<string, SessionStatusInfo>,
  latest: boolean,
) {
  if (!id || !latest) return false
  if (part?.background === true || state?.background === true) return false
  return status[id]?.type === "busy" || status[id]?.type === "retry"
}

export function showChildPromotion(
  id: string | undefined,
  part: Record<string, unknown> | undefined,
  state: Record<string, unknown> | undefined,
  status: Record<string, SessionStatusInfo>,
  enabled: boolean | undefined,
  readonly: boolean | undefined,
  latest: boolean,
) {
  return enabled === true && !readonly && childForeground(id, part, state, status, latest)
}

export function taskVisible(open: boolean | undefined, id: string | undefined) {
  return open ? id : undefined
}

export function taskResult(output: string | undefined, id: string | undefined) {
  if (id || typeof output !== "string") return
  const match = /<task_result>\s*([\s\S]*?)\s*<\/task_result>/.exec(output)
  return match?.[1] ?? output
}
