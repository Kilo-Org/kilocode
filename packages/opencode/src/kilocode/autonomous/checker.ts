import { Effect, Schema } from "effect"
import type { SessionID } from "@/session/schema"
import { AutonomousAgents } from "./agents"
import type { AutonomousModels } from "./models"
import { AutonomousReviewer } from "./reviewer"
import { AutonomousRunner } from "./runner"
import type { AutonomousState } from "./state"

/** Goal checker: re-reads the original objective and criteria against the actual diff. */
export namespace AutonomousChecker {
  export const Check = Schema.Struct({
    complete: Schema.Boolean,
    criteria: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        status: Schema.Literals(["satisfied", "unsatisfied"]),
        evidence: Schema.optional(Schema.String),
        reason: Schema.optional(Schema.String),
      }),
    ),
    new_work: Schema.Array(Schema.String),
  })
  export type Check = typeof Check.Type

  export function text(state: AutonomousState.Info, diff: string) {
    return [
      `Objective:\n${state.objective}`,
      `Acceptance criteria:\n${state.criteria.map((c) => `- ${c.id}: ${c.description}`).join("\n")}`,
      `Tasks:\n${state.tasks.map((t) => `- ${t.id} [${t.status}] ${t.title}${t.result ? ` — ${t.result.summary}` : ""}`).join("\n")}`,
      `Diff of all changes:\n${diff || "(no changes)"}`,
    ].join("\n\n")
  }

  /** Apply the verdict to state.criteria. Returns true when every criterion is satisfied. */
  export function apply(state: AutonomousState.Info, check: Check) {
    for (const c of state.criteria) {
      const hit = check.criteria.find((x) => x.id === c.id)
      if (!hit) {
        c.status = "unsatisfied"
        c.reason = "not assessed by the checker"
        continue
      }
      c.status = hit.status
      if (hit.evidence) c.evidence = hit.evidence
      if (hit.reason) c.reason = hit.reason
    }
    return check.complete && state.criteria.every((c) => c.status === "satisfied")
  }

  export const check = Effect.fn("AutonomousChecker.check")(function* (input: {
    parent: SessionID
    dir: string
    state: AutonomousState.Info
    model: AutonomousModels.Ref
    /** Hard step and USD caps for the child session. */
    steps?: number
    maxCost?: number
  }) {
    const diff = yield* AutonomousReviewer.diff(input.dir)
    const out = yield* AutonomousRunner.run({
      parent: input.parent,
      title: "Autonomous goal check",
      agent: AutonomousAgents.CHECKER,
      model: input.model,
      schema: Check,
      text: text(input.state, diff),
      retries: 1,
      steps: input.steps,
      maxCost: input.maxCost,
    })
    const complete = apply(input.state, out.value)
    return { check: out.value, complete, cost: out.cost, tokens: out.tokens }
  })
}
