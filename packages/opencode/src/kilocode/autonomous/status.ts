import { AutonomousBudget } from "./budget"
import type { AutonomousState } from "./state"

/** Plain-text status rendering for `/goal status`, `/goal tasks`, `/goal budget`. */
export namespace AutonomousStatus {
  const bar = (done: number, total: number, width = 20) => {
    const filled = total === 0 ? 0 : Math.round((done / total) * width)
    return `[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${done}/${total}`
  }

  const money = (n: number) => `$${n.toFixed(4)}`

  export function render(state: AutonomousState.Info) {
    const done = state.tasks.filter((t) => t.status === "completed").length
    const lines = [
      `Autonomous goal: ${state.status}${state.reason ? ` — ${state.reason}` : ""}`,
      state.objective,
      state.summary ? `Summary: ${state.summary}` : "",
      `Progress ${bar(done, state.tasks.length)}  revision ${state.revision}, escalations ${state.escalations}`,
      state.criteria.length ? `Criteria:\n${state.criteria.map((c) => `  ${mark(c.status)} ${c.id} ${c.description}`).join("\n")}` : "",
      tasks(state),
      budget(state),
      state.final ? `Final review: ${state.final.review ? "passed" : "failed"} (${state.final.modelClass}) ${state.final.summary}` : "",
    ]
    return lines.filter((l) => l.length).join("\n")
  }

  const mark = (status: string) => (status === "satisfied" || status === "completed" ? "[x]" : status === "unsatisfied" || status === "failed" || status === "blocked" ? "[!]" : "[ ]")

  export function tasks(state: AutonomousState.Info) {
    if (!state.tasks.length) return "Tasks: none yet"
    return (
      "Tasks:\n" +
      state.tasks
        .map((t) => {
          const deps = t.dependsOn.length ? ` after ${t.dependsOn.join(",")}` : ""
          const route = t.route ? ` via ${t.route.modelClass}` : ""
          const tries = t.attempts ? ` (${t.attempts} attempt${t.attempts === 1 ? "" : "s"}${t.escalated ? ", escalated" : ""})` : ""
          return `  ${mark(t.status)} ${t.id} ${t.title} — ${t.status}${deps}${route}${tries}`
        })
        .join("\n")
    )
  }

  export function budget(state: AutonomousState.Info) {
    const c = state.budget.cloud
    const l = state.budget.local
    return `Usage: cloud ${c.calls} calls ${money(c.cost)} (${c.input} in / ${c.output} out), local ${l.calls} calls ${money(l.cost)} (${l.input} in / ${l.output} out), total ${money(AutonomousBudget.total(state))}`
  }

  export const help =
    "Autonomous goal engine. /goal <objective> plans the work, runs it task by task with local models, verifies with checks and a reviewer, escalates repeated failures to the cloud model, and finishes only after a goal check and final review. /goal status, /goal tasks, /goal budget show progress; /goal pause, /goal resume, /goal clear control it."
}
