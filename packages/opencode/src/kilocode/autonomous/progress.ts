import { AutonomousModels } from "./models"
import type { AutonomousRepair } from "./repair"
import type { AutonomousState } from "./state"

/** One-line progress messages posted into the goal's session while the engine runs. */
export namespace AutonomousProgress {
  const LIST = 8

  const money = (n: number) => `$${n.toFixed(2)}`
  const where = (cls: AutonomousState.ModelClass) => (cls === "cloud-reasoner" ? "cloud" : "local")
  const first = (text: string) => text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? ""
  const clip = (text: string, n = 240) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

  /** Position of a task in the plan, e.g. `2/7`. */
  const pos = (state: AutonomousState.Info, task: AutonomousState.Task) =>
    `${state.tasks.findIndex((t) => t.id === task.id) + 1}/${state.tasks.length}`

  const spent = (state: AutonomousState.Info) => `cloud ${money(state.budget.cloud.cost)}, ${state.budget.local.calls} local calls`

  export function plan(state: AutonomousState.Info, title: string) {
    const lines = state.tasks.map(
      (t, i) => `${i + 1}. ${t.title} (complexity ${t.complexity}${t.dependsOn.length ? `, after ${t.dependsOn.join(", ")}` : ""})`,
    )
    return [
      `${title}: ${state.tasks.length} tasks, ${state.criteria.length} acceptance criteria. Spent so far: ${spent(state)}.`,
      ...(state.summary ? [clip(state.summary, 400)] : []),
      ...lines,
    ].join("\n")
  }

  export function start(
    state: AutonomousState.Info,
    task: AutonomousState.Task,
    route: { modelClass: AutonomousState.ModelClass; model: AutonomousModels.Ref; reason: string },
  ) {
    const attempt = task.attempts > 1 ? `, attempt ${task.attempts}` : ""
    return `Task ${pos(state, task)} started: ${task.title}\nModel: ${AutonomousModels.format(route.model)} (${where(route.modelClass)}, ${route.reason}${attempt})`
  }

  export function worked(task: AutonomousState.Task, result: AutonomousState.Result) {
    const files = result.changedFiles.length
      ? `Changed: ${result.changedFiles.slice(0, LIST).join(", ")}${result.changedFiles.length > LIST ? ` and ${result.changedFiles.length - LIST} more` : ""}`
      : "No files changed."
    return `Task ${task.id} worker finished: ${clip(first(result.summary))}\n${files}\nRunning checks and review.`
  }

  export function done(state: AutonomousState.Info, task: AutonomousState.Task) {
    const finished = state.tasks.filter((t) => t.status === "completed").length
    return `Task ${pos(state, task)} done: ${task.title}. ${finished} of ${state.tasks.length} tasks complete. Spent so far: ${spent(state)}.`
  }

  const NEXT: Record<AutonomousRepair.Action, string> = {
    retry: "retrying locally",
    escalate: "escalating to the cloud model",
    fail: "giving up on this task",
  }

  export function failed(
    state: AutonomousState.Info,
    task: AutonomousState.Task,
    stage: AutonomousState.Stage,
    message: string,
    decision: AutonomousRepair.Decision,
  ) {
    return `Task ${pos(state, task)} ${stage} failed: ${clip(first(message))}\nNext: ${NEXT[decision.action]} (${decision.reason}).`
  }

  export function outcome(status: AutonomousState.GoalStatus) {
    if (status === "completed") return "Goal completed"
    if (status === "paused") return "Goal paused"
    if (status === "blocked") return "Goal blocked"
    if (status === "failed") return "Goal failed"
    return `Goal ${status}`
  }
}
