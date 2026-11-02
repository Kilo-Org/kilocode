import type { SessionMessage } from "@opencode/schema/session-message"

/**
 * Tool calls that are not progress: goal control and reporting, questions, and status-only bookkeeping. A completed
 * call of any other tool counts as useful work for the goal.
 */
const CONTROL = new Set(["goal", "goal_report", "question", "todowrite", "suggest", "board_post", "board_read"])

const BOOKKEEPING = new Set(["cancel_wakeup", "cron_list", "cron_delete"])

export type Progress = {
  readonly success: number
  readonly failure: number
  /** A real user message landed after the goal turn started; the goal continues after that turn, as v1 did. */
  readonly preempted: boolean
  /** Assistant steps in this goal turn. A report is valid from any of them. */
  readonly assistants: ReadonlySet<string>
  readonly last?: SessionMessage.Assistant
}

export function evaluate(messages: ReadonlyArray<SessionMessage.Info>, goalID: string): Progress {
  const start = messages.findLastIndex(
    (message) => (message.type === "user" || message.type === "synthetic") && message.metadata?.goalID === goalID,
  )
  let success = 0
  let failure = 0
  let preempted = false
  let last: SessionMessage.Assistant | undefined
  const assistants = new Set<string>()
  for (const message of messages.slice(start + 1)) {
    if (message.type === "user" || message.type === "synthetic") {
      preempted = true
      continue
    }
    if (message.type === "assistant") {
      assistants.add(message.id)
      last = message
    }
  }
  for (const message of messages.slice(start + 1)) {
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool" || CONTROL.has(part.name) || BOOKKEEPING.has(part.name)) continue
      if (part.state.status === "error") {
        failure++
        continue
      }
      if (part.state.status !== "completed") continue
      const exit = part.state.metadata?.exit
      if (part.name === "shell" && typeof exit === "number" && exit !== 0) {
        failure++
        continue
      }
      success++
    }
  }
  return { success, failure, preempted, assistants, last }
}

/** Why a turn did not make progress, or undefined when it did. */
export function blocked(progress: Progress) {
  if (progress.last?.error) return "The goal turn failed. Review the conversation before resuming."
  if (progress.failure > 0) return "A step failed. Review the conversation before resuming."
  if (progress.success > 0) return undefined
  if (progress.preempted) return undefined
  return "No successful action or explicit completion report. Review the conversation before resuming."
}