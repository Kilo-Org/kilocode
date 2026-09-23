import { Effect, Schema } from "effect"
import type { SessionID } from "@/session/schema"
import { AutonomousAgents } from "./agents"
import type { AutonomousModels } from "./models"
import { AutonomousRunner } from "./runner"
import { AutonomousScheduler } from "./scheduler"
import { AutonomousState } from "./state"

/** Cloud planner: objective → acceptance criteria + task DAG. Read-only; never edits. */
export namespace AutonomousPlanner {
  export const PlannedTask = Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    description: Schema.String,
    type: AutonomousState.TaskType,
    complexity: AutonomousState.Complexity,
    dependsOn: Schema.Array(Schema.String),
    relevantFiles: Schema.Array(Schema.String),
    acceptanceCriteria: Schema.Array(Schema.String),
    risk: AutonomousState.Risk,
    preferredModelClass: AutonomousState.ModelClass,
  })

  export const Plan = Schema.Struct({
    goal_summary: Schema.String,
    acceptance_criteria: Schema.Array(Schema.Struct({ id: Schema.String, description: Schema.String })),
    tasks: Schema.Array(PlannedTask),
    risks: Schema.Array(Schema.String),
  })
  export type Plan = typeof Plan.Type

  export class Invalid extends Schema.TaggedErrorClass<Invalid>()("AutonomousPlanInvalid", {
    message: Schema.String,
  }) {}

  export const validate = (plan: Plan) => {
    if (plan.tasks.length === 0) return ["The plan has no tasks."]
    return AutonomousScheduler.validate(plan.tasks.map((t) => ({ id: t.id, dependsOn: [...t.dependsOn] }))).map((p) => p.message)
  }

  export function toTasks(plan: Plan, maxAttempts: number): AutonomousState.Task[] {
    return plan.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      type: t.type,
      status: "pending",
      complexity: t.complexity,
      dependsOn: [...t.dependsOn],
      relevantFiles: [...t.relevantFiles],
      acceptanceCriteria: [...t.acceptanceCriteria],
      risk: { ...t.risk },
      preferredModelClass: t.preferredModelClass,
      attempts: 0,
      maxAttempts,
      escalated: false,
      failures: [],
    }))
  }

  export function text(state: AutonomousState.Info, input?: { findings?: string[]; newWork?: string[] }) {
    const lines = [`Objective:\n${state.objective}`]
    if (state.tasks.length) {
      lines.push(
        `Previous plan (revision ${state.revision}). Keep completed task ids unchanged:\n` +
          state.tasks
            .map((t) => `- ${t.id} [${t.status}] ${t.title}${t.result ? ` — ${t.result.summary}` : ""}`)
            .join("\n"),
      )
    }
    if (state.criteria.length) {
      lines.push(
        `Acceptance criteria so far:\n` +
          state.criteria.map((c) => `- ${c.id} [${c.status}] ${c.description}${c.reason ? ` — ${c.reason}` : ""}`).join("\n"),
      )
    }
    if (input?.newWork?.length) lines.push(`Goal checker asks for:\n${input.newWork.map((w) => `- ${w}`).join("\n")}`)
    if (input?.findings?.length) lines.push(`Open review findings:\n${input.findings.map((f) => `- ${f}`).join("\n")}`)
    return lines.join("\n\n")
  }

  /** Plan or replan. Retries once with the validation errors when the DAG is invalid. */
  export const plan = Effect.fn("AutonomousPlanner.plan")(function* (input: {
    parent: SessionID
    state: AutonomousState.Info
    model: AutonomousModels.Ref
    maxAttempts: number
    replan?: { findings?: string[]; newWork?: string[] }
  }) {
    let text = AutonomousPlanner.text(input.state, input.replan)
    let cost = 0
    const tokens = { input: 0, output: 0 }
    let errors: string[] = []
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = yield* AutonomousRunner.run({
        parent: input.parent,
        title: input.replan ? "Autonomous replan" : "Autonomous plan",
        agent: AutonomousAgents.PLANNER,
        model: input.model,
        schema: Plan,
        text,
        retries: 1,
      })
      cost += out.cost
      tokens.input += out.tokens.input
      tokens.output += out.tokens.output
      errors = validate(out.value)
      if (errors.length === 0) {
        const tasks = toTasks(out.value, input.maxAttempts)
        return { plan: out.value, tasks, cost, tokens }
      }
      text = `${AutonomousPlanner.text(input.state, input.replan)}\n\nYour previous plan was rejected:\n${errors.map((e) => `- ${e}`).join("\n")}\nFix the task graph and return the full plan again.`
    }
    return yield* new Invalid({ message: errors.join("; ") })
  })
}
