import { AutonomousBudget } from "./budget"
import type { AutonomousConfig } from "./config"
import type { AutonomousModels } from "./models"
import type { AutonomousState } from "./state"

/** Deterministic model routing. Reasoning goes to the cloud, implementation stays local. */
export namespace AutonomousRouter {
  export type Decision =
    | { ok: true; modelClass: AutonomousState.ModelClass; model: AutonomousModels.Ref; reason: string }
    | { ok: false; reason: string }

  export const risky = (task: Pick<AutonomousState.Task, "risk">) =>
    task.risk.security === true || task.risk.auth === true || task.risk.schema === true || task.risk.infra === true

  export function classify(task: AutonomousState.Task, cfg: AutonomousConfig.Info): { modelClass: AutonomousState.ModelClass; reason: string } {
    if (task.escalated) return { modelClass: "cloud-reasoner", reason: "escalated after repeated failures" }
    if (task.preferredModelClass === "cloud-reasoner") return { modelClass: "cloud-reasoner", reason: "planner requested cloud reasoning" }
    if (risky(task)) return { modelClass: "cloud-reasoner", reason: "task carries a risk flag" }
    if (task.type === "research") return { modelClass: "cloud-reasoner", reason: "research needs reasoning" }
    if (task.complexity <= cfg.routing.local_small_max_complexity) return { modelClass: "local-small", reason: `complexity ${task.complexity}` }
    if (task.complexity <= cfg.routing.local_coder_max_complexity) return { modelClass: "local-coder", reason: `complexity ${task.complexity}` }
    return { modelClass: "cloud-reasoner", reason: `complexity ${task.complexity} above local limit` }
  }

  export function route(input: {
    task: AutonomousState.Task
    state: AutonomousState.Info
    cfg: AutonomousConfig.Info
    models: AutonomousModels.Map
  }): Decision {
    const pick = classify(input.task, input.cfg)
    if (pick.modelClass === "cloud-reasoner") {
      const blocked = AutonomousBudget.reason(input.state, input.cfg, input.task.id)
      if (blocked) return { ok: false, reason: blocked }
    }
    return { ok: true, ...pick, model: input.models[pick.modelClass] }
  }
}
