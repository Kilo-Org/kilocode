import type { AutonomousState } from "./state"

/** Pure DAG helpers over `state.tasks`. Never touches IO. */
export namespace AutonomousScheduler {
  export type Problem = { taskID: string; message: string }

  /** Unknown or self dependencies and cycles. Empty result means the graph is valid. */
  export function validate(tasks: readonly Pick<AutonomousState.Task, "id" | "dependsOn">[]): Problem[] {
    const ids = new Set(tasks.map((t) => t.id))
    const out: Problem[] = []
    const seen = new Set<string>()
    for (const task of tasks) {
      if (seen.has(task.id)) out.push({ taskID: task.id, message: `Duplicate task id "${task.id}"` })
      seen.add(task.id)
      for (const dep of task.dependsOn) {
        if (dep === task.id) out.push({ taskID: task.id, message: `Task "${task.id}" depends on itself` })
        else if (!ids.has(dep)) out.push({ taskID: task.id, message: `Task "${task.id}" depends on unknown task "${dep}"` })
      }
    }
    if (out.length) return out
    // Kahn's algorithm: anything left after peeling in-degree-0 nodes is in a cycle.
    const degree = new Map(tasks.map((t) => [t.id, t.dependsOn.length]))
    const queue = tasks.filter((t) => t.dependsOn.length === 0).map((t) => t.id)
    const done = new Set<string>()
    while (queue.length) {
      const id = queue.shift()!
      done.add(id)
      for (const t of tasks) {
        if (!t.dependsOn.includes(id)) continue
        const left = (degree.get(t.id) ?? 0) - 1
        degree.set(t.id, left)
        if (left === 0) queue.push(t.id)
      }
    }
    for (const t of tasks) if (!done.has(t.id)) out.push({ taskID: t.id, message: `Task "${t.id}" is part of a dependency cycle` })
    return out
  }

  const settled = (task: AutonomousState.Task) => task.status === "completed"

  /** Pending tasks whose dependencies are all completed, in plan order. */
  export function ready(state: Pick<AutonomousState.Info, "tasks">) {
    const byID = new Map(state.tasks.map((t) => [t.id, t]))
    return state.tasks.filter(
      (t) =>
        (t.status === "pending" || t.status === "ready") &&
        t.dependsOn.every((dep) => {
          const d = byID.get(dep)
          return d ? settled(d) : false
        }),
    )
  }

  /** The task to run now: an in-flight one first, else the first ready task. */
  export function next(state: Pick<AutonomousState.Info, "tasks">) {
    const inflight = state.tasks.find((t) => t.status === "running" || t.status === "verifying" || t.status === "repairing")
    if (inflight) return inflight
    return ready(state)[0]
  }

  /** Mark dependents of failed or blocked tasks as blocked. Returns the ids changed. */
  export function propagate(state: Pick<AutonomousState.Info, "tasks">) {
    const changed: string[] = []
    const dead = new Set(state.tasks.filter((t) => t.status === "failed" || t.status === "blocked").map((t) => t.id))
    for (;;) {
      const before = dead.size
      for (const t of state.tasks) {
        if (dead.has(t.id) || settled(t)) continue
        if (!t.dependsOn.some((d) => dead.has(d))) continue
        t.status = "blocked"
        dead.add(t.id)
        changed.push(t.id)
      }
      if (dead.size === before) return changed
    }
  }

  export const open = (state: Pick<AutonomousState.Info, "tasks">) => state.tasks.filter((t) => !settled(t) && t.status !== "failed" && t.status !== "blocked")

  export const done = (state: Pick<AutonomousState.Info, "tasks">) => state.tasks.every(settled)

  /**
   * Merge a replanned task list: completed and failed tasks are kept as-is,
   * every other task is replaced by the planner's version. New ids are appended.
   */
  export function merge(state: Pick<AutonomousState.Info, "tasks">, planned: AutonomousState.Task[]) {
    const keep = new Map(state.tasks.filter((t) => settled(t) || t.status === "failed").map((t) => [t.id, t]))
    const out: AutonomousState.Task[] = []
    for (const t of planned) {
      const prior = keep.get(t.id)
      out.push(prior ?? { ...t, status: "pending" })
    }
    for (const t of keep.values()) if (!out.some((o) => o.id === t.id)) out.push(t)
    return out
  }
}
