import type { SessionStatusInfo } from "../../types/messages"

export function taskRunning(status: string | undefined) {
  return status === "pending" || status === "running"
}

export function childForeground(
  id: string | undefined,
  part: Record<string, unknown> | undefined,
  state: Record<string, unknown> | undefined,
  status: Record<string, SessionStatusInfo>,
) {
  if (!id) return false
  if (part?.background === true || state?.background === true) return false
  return status[id]?.type === "busy" || status[id]?.type === "retry"
}

export function showChildPromotion(
  id: string | undefined,
  part: Record<string, unknown> | undefined,
  state: Record<string, unknown> | undefined,
  status: Record<string, SessionStatusInfo>,
  readonly: boolean | undefined,
) {
  return !readonly && childForeground(id, part, state, status)
}

export function taskVisible(open: boolean | undefined, id: string | undefined) {
  return open ? id : undefined
}

export function taskResult(output: string | undefined, id: string | undefined) {
  if (id || typeof output !== "string") return
  const match = /<task_result>\s*([\s\S]*?)\s*<\/task_result>/.exec(output)
  return match?.[1] ?? output
}
