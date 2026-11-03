const RULES = [
  "Proceed autonomously with safe, reversible decisions instead of asking clarification questions.",
  "The question tool is unavailable during active goal execution.",
  "Do not repeat completed work or status-only reports.",
  "A background process or subagent that is still running suspends the goal until it finishes; the goal shows as waiting until then and no further goal turn runs in between.",
  "If the goal is met, call goal_report with status complete and a concrete reason, then give your final response.",
  "If a genuine blocker prevents safe progress, call goal_report with status blocked and the blocker reason, then stop instead of asking the user.",
  "Only the root Goal worker can call goal_report; delegated workers must return their findings to the root.",
  "Completion is your report, not independent verification. Keep all existing permission and scope limits.",
]

export namespace GoalInstructions {
  export function prompt(text: string) {
    return [
      "Continue working toward this session goal:",
      "",
      text,
      "",
      "Use the existing conversation and take the next useful step.",
      ...RULES,
    ].join("\n")
  }

  export function kickoff(text: string) {
    return [
      "A session goal was set:",
      "",
      text,
      "",
      "Start working toward it now. Take the next useful step in this turn.",
      ...RULES,
    ].join("\n")
  }

  export function resumed(text: string) {
    return ["The user resumed this session goal:", "", text, "", "Take the next useful step.", ...RULES].join("\n")
  }
}