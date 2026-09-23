import type { AutonomousConfig } from "./config"
import type { AutonomousState } from "./state"

/** Cloud usage is limited per task and per goal; local usage is only recorded. */
export namespace AutonomousBudget {
  export type Charge = {
    modelClass: AutonomousState.ModelClass
    taskID?: string
    cost: number
    tokens?: { input?: number; output?: number }
  }

  export const cloud = (modelClass: AutonomousState.ModelClass) => modelClass === "cloud-reasoner"

  export function charge(state: AutonomousState.Info, input: Charge) {
    const bucket = cloud(input.modelClass) ? state.budget.cloud : state.budget.local
    const add = (u: AutonomousState.Usage) => {
      u.cost += input.cost
      u.calls += 1
      u.input += input.tokens?.input ?? 0
      u.output += input.tokens?.output ?? 0
    }
    add(bucket)
    if (input.taskID && cloud(input.modelClass)) {
      const per = state.budget.perTask[input.taskID] ?? { cost: 0, calls: 0, input: 0, output: 0 }
      add(per)
      state.budget.perTask[input.taskID] = per
    }
    return state
  }

  /** Reason the next cloud call must not happen, or undefined when allowed. */
  export function reason(state: AutonomousState.Info, cfg: AutonomousConfig.Info, taskID?: string) {
    const b = cfg.budget
    const goal = state.budget.cloud
    if (goal.cost >= b.cloud_goal_max_usd) return `Cloud budget for the goal reached ($${goal.cost.toFixed(2)} of $${b.cloud_goal_max_usd}).`
    if (goal.calls >= b.max_cloud_calls_per_goal) return `Cloud call limit for the goal reached (${goal.calls} of ${b.max_cloud_calls_per_goal}).`
    if (!taskID) return undefined
    const per = state.budget.perTask[taskID]
    if (!per) return undefined
    if (per.cost >= b.cloud_task_max_usd) return `Cloud budget for task ${taskID} reached ($${per.cost.toFixed(2)} of $${b.cloud_task_max_usd}).`
    if (per.calls >= b.max_cloud_calls_per_task) return `Cloud call limit for task ${taskID} reached (${per.calls} of ${b.max_cloud_calls_per_task}).`
    return undefined
  }

  export const allow = (state: AutonomousState.Info, cfg: AutonomousConfig.Info, taskID?: string) =>
    reason(state, cfg, taskID) === undefined

  export const total = (state: AutonomousState.Info) => state.budget.cloud.cost + state.budget.local.cost
}
