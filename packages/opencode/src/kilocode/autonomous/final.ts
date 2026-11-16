import { Effect } from "effect"
import type { SessionID } from "@/session/schema"
import { AutonomousAgents } from "./agents"
import type { AutonomousModels } from "./models"
import { AutonomousReviewer } from "./reviewer"
import { AutonomousRunner } from "./runner"
import type { AutonomousState } from "./state"
import type { AutonomousVerifier } from "./verifier"

/** Final gate: mechanical checks on the whole tree, no blocking findings, all criteria met, then one final review. */
export namespace AutonomousFinal {
  export function gate(state: AutonomousState.Info, checks: AutonomousVerifier.Report): string[] {
    const out: string[] = []
    if (!checks.ok) out.push(`Mechanical checks fail: ${checks.results.filter((r) => !r.ok).map((r) => r.check.command).join(", ")}`)
    const blocking = state.findings.filter((f) => f.blocking && !f.resolved)
    if (blocking.length) out.push(`${blocking.length} blocking review finding(s) are unresolved`)
    const unmet = state.criteria.filter((c) => c.status !== "satisfied")
    if (unmet.length) out.push(`Unmet criteria: ${unmet.map((c) => c.id).join(", ")}`)
    const failed = state.tasks.filter((t) => t.status === "failed" || t.status === "blocked")
    if (failed.length) out.push(`Failed or blocked tasks: ${failed.map((t) => t.id).join(", ")}`)
    const open = state.tasks.filter((t) => t.status !== "completed" && t.status !== "failed" && t.status !== "blocked")
    if (open.length) out.push(`Open tasks: ${open.map((t) => t.id).join(", ")}`)
    return out
  }

  export const modelClass = (state: AutonomousState.Info, threshold: number): AutonomousState.ModelClass =>
    state.tasks.some((t) => t.complexity >= threshold) || state.escalations > 0 ? "cloud-reasoner" : "local-coder"

  export function text(state: AutonomousState.Info, diff: string) {
    return [
      `Objective:\n${state.objective}`,
      `Acceptance criteria (all reported satisfied by the goal checker):\n${state.criteria.map((c) => `- ${c.id}: ${c.description}${c.evidence ? ` — ${c.evidence}` : ""}`).join("\n")}`,
      `Tasks:\n${state.tasks.map((t) => `- ${t.id} [${t.status}] ${t.title}`).join("\n")}`,
      `Complete diff:\n${diff || "(no changes)"}`,
    ].join("\n\n")
  }

  export const review = Effect.fn("AutonomousFinal.review")(function* (input: {
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
      title: "Autonomous final review",
      agent: AutonomousAgents.FINAL,
      model: input.model,
      schema: AutonomousReviewer.Review,
      text: text(input.state, diff),
      retries: 1,
      steps: input.steps,
      maxCost: input.maxCost,
    })
    const blocking = out.value.findings.filter((f) => f.blocking)
    return { review: out.value, blocking, cost: out.cost, tokens: out.tokens }
  })
}
