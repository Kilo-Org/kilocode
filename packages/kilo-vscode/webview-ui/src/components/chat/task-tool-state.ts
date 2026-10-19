import type { SessionStatusInfo } from "../../types/messages"

export function taskRunning(status: string | undefined) {
  return status === "pending" || status === "running"
}

/**
 * Auto-open a task card only when it is not a background task. Every task now
 * runs in the background, so task cards stay collapsed and never open on their
 * own.
 */
export function taskAutoOpen(status: string | undefined, background: boolean) {
  return status === "running" && !background
}

/**
 * The open state to persist for a card the user has not controlled, or
 * undefined to leave the stored value alone. A background card collapses and
 * must stay collapsed, so that collapse is stored too instead of leaving an
 * earlier open value behind.
 */
export function taskStoredOpen(auto: boolean, background: boolean, touched: boolean) {
  if (touched) return undefined
  if (auto) return true
  if (background) return false
  return undefined
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

/**
 * True when a Task part is a background child. Every task runs in the
 * background now, so only an explicit legacy false flag opts out. The streamed
 * input carries the flag from the first part update; part metadata wins over
 * state metadata.
 */
export function taskBackground(
  input: Record<string, unknown> | undefined,
  part: Record<string, unknown> | undefined,
  state: Record<string, unknown> | undefined,
) {
  if (input?.background === false || part?.background === false || state?.background === false) return false
  return true
}

export function taskVisible(open: boolean | undefined, id: string | undefined) {
  return open ? id : undefined
}

export function taskResult(output: string | undefined, id: string | undefined) {
  if (id || typeof output !== "string") return
  const match = /<task_result>\s*([\s\S]*?)\s*<\/task_result>/.exec(output)
  return match?.[1] ?? output
}
