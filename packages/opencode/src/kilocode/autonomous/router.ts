import { AutonomousBudget } from "./budget"
import type { AutonomousConfig } from "./config"
import type { AutonomousModels } from "./models"
import type { AutonomousState } from "./state"
import { AutonomousStats } from "./stats"

/** Deterministic model routing. Reasoning goes to the cloud, implementation stays local. */
export namespace AutonomousRouter {
  export type Decision =
    | { ok: true; modelClass: AutonomousState.ModelClass; model: AutonomousModels.Ref; reason: string }
    | { ok: false; reason: string }

  export const risky = (task: Pick<AutonomousState.Task, "risk">) =>
    task.risk.security === true || task.risk.auth === true || task.risk.schema === true || task.risk.infra === true

  /** Minimum recorded runs before history changes a routing decision. */
  export const MIN_RUNS = 5
  /** Below this success rate a local class is skipped for that complexity. */
  export const MIN_RATE = 0.5

  const base = (task: AutonomousState.Task, cfg: AutonomousConfig.Info): { modelClass: AutonomousState.ModelClass; reason: string } => {
    if (task.escalated) return { modelClass: "cloud-reasoner", reason: "escalated after repeated failures" }
    if (task.preferredModelClass === "cloud-reasoner" && cfg.routing.planner_cloud) return { modelClass: "cloud-reasoner", reason: "planner requested cloud reasoning" }
    if (risky(task)) return { modelClass: "cloud-reasoner", reason: "task carries a risk flag" }
    if (task.type === "research") return { modelClass: "cloud-reasoner", reason: "research needs reasoning" }
    if (task.complexity <= cfg.routing.local_small_max_complexity) return { modelClass: "local-small", reason: `complexity ${task.complexity}` }
    if (task.complexity <= cfg.routing.local_coder_max_complexity) return { modelClass: "local-coder", reason: `complexity ${task.complexity}` }
    return { modelClass: "cloud-reasoner", reason: `complexity ${task.complexity} above local limit` }
  }

  const weak = (stats: AutonomousStats.Info | undefined, modelClass: AutonomousState.ModelClass, complexity: number) => {
    const c = AutonomousStats.get(stats, modelClass, complexity)
    if (!c || c.runs < MIN_RUNS) return undefined
    const rate = c.ok / c.runs
    return rate < MIN_RATE ? rate : undefined
  }

  /** Deterministic rules first; history only ever moves a task up to a stronger class. */
  export function classify(
    task: AutonomousState.Task,
    cfg: AutonomousConfig.Info,
    stats?: AutonomousStats.Info,
  ): { modelClass: AutonomousState.ModelClass; reason: string } {
    const pick = base(task, cfg)
    if (pick.modelClass === "cloud-reasoner") return pick
    const pct = (rate: number) => `${Math.round(rate * 100)}%`
    if (pick.modelClass === "local-small") {
      const rate = weak(stats, "local-small", task.complexity)
      if (rate === undefined) return pick
      const coder = weak(stats, "local-coder", task.complexity)
      if (coder === undefined) return { modelClass: "local-coder", reason: `local-small succeeded ${pct(rate)} at complexity ${task.complexity}` }
      return { modelClass: "cloud-reasoner", reason: `local classes succeeded ${pct(rate)} and ${pct(coder)} at complexity ${task.complexity}` }
    }
    const rate = weak(stats, "local-coder", task.complexity)
    if (rate === undefined) return pick
    return { modelClass: "cloud-reasoner", reason: `local-coder succeeded ${pct(rate)} at complexity ${task.complexity}` }
  }

  export function route(input: {
    task: AutonomousState.Task
    state: AutonomousState.Info
    cfg: AutonomousConfig.Info
    models: AutonomousModels.Map
    stats?: AutonomousStats.Info
  }): Decision {
    const pick = classify(input.task, input.cfg, input.stats)
    if (pick.modelClass === "cloud-reasoner") {
      const blocked = AutonomousBudget.reason(input.state, input.cfg, input.task.id)
      if (blocked) return { ok: false, reason: blocked }
    }
    return { ok: true, ...pick, model: input.models[pick.modelClass] }
  }
}
