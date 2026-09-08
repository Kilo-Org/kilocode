export namespace GoalInstructions {
  export const help =
    "Use /goal <objective> to keep working toward a goal in this session. Work uses model credits. Complete means reported by the working model, not independently verified. The model uses goal_report to report completion or a blocker with a reason. No progress without an explicit report, or errors, pause the goal. /goal pause stops, /goal resume continues (or restarts a complete goal), and /goal clear explicitly removes the saved objective and reason. Stop or a new message pauses active work. Active goals become paused after a backend restart; complete goals stay complete."

  export function prompt(text: string) {
    return `Continue working toward this session goal:\n\n${text}\n\nUse the existing conversation and take the next useful step. Proceed autonomously with safe, reversible decisions instead of asking clarification questions. The question tool is unavailable during active goal execution, including delegated work. Do not repeat completed work or status-only reports. If the goal is met, call goal_report with status complete and a concrete reason, then give your final response. If a genuine blocker prevents safe progress, call goal_report with status blocked and the blocker reason, then stop instead of asking the user. Only the root Goal worker can call goal_report; delegated workers must return their findings to the root. Completion is your report, not independent verification. Keep all existing permission and scope limits.`
  }
}
