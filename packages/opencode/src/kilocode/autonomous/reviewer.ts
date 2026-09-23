import { Effect, Schema } from "effect"
import type { SessionID } from "@/session/schema"
import { AutonomousAgents } from "./agents"
import type { AutonomousModels } from "./models"
import { AutonomousRunner } from "./runner"
import { AutonomousShell } from "./shell"
import type { AutonomousState } from "./state"
import type { AutonomousVerifier } from "./verifier"

/** Read-only reviewer over a task's diff. Blocking findings fail the task. */
export namespace AutonomousReviewer {
  export const Finding = Schema.Struct({
    id: Schema.String,
    type: Schema.String,
    file: Schema.optional(Schema.String),
    description: Schema.String,
    blocking: Schema.Boolean,
  })

  export const Review = Schema.Struct({
    ok: Schema.Boolean,
    severity: Schema.Literals(["none", "low", "medium", "high"]),
    findings: Schema.Array(Finding),
    confidence: Schema.Number,
  })
  export type Review = typeof Review.Type

  export const DIFF_LIMIT = 40_000

  export const diff = (dir: string, files?: string[]) =>
    Effect.gen(function* () {
      const tracked = yield* AutonomousShell.git(["diff", "HEAD", "--", ...(files ?? [])], dir)
      const untracked = yield* AutonomousShell.git(["ls-files", "--others", "--exclude-standard", "--", ...(files ?? [])], dir)
      const extra: string[] = []
      for (const file of untracked.stdout.split("\n").filter((f) => f.trim().length)) {
        const body = yield* Effect.promise(() => Bun.file(`${dir}/${file}`).text()).pipe(Effect.catch(() => Effect.succeed("")))
        extra.push(`--- /dev/null\n+++ b/${file}\n${body.split("\n").map((l) => `+${l}`).join("\n")}`)
      }
      return AutonomousShell.truncate([tracked.stdout, ...extra].filter((s) => s.trim().length).join("\n"), DIFF_LIMIT)
    })

  export function text(input: {
    task: AutonomousState.Task
    state: AutonomousState.Info
    diff: string
    checks?: AutonomousVerifier.Report
    summary?: string
  }) {
    const criteria = input.state.criteria.filter((c) => input.task.acceptanceCriteria.includes(c.id))
    const lines = [
      `Task ${input.task.id}: ${input.task.title}`,
      input.task.description,
      criteria.length ? `Acceptance criteria:\n${criteria.map((c) => `- ${c.id}: ${c.description}`).join("\n")}` : "",
      input.summary ? `Worker summary:\n${input.summary}` : "",
      input.checks ? `Mechanical checks:\n${input.checks.results.map((r) => `- ${r.check.command}: ${r.skipped ? "skipped" : r.ok ? "passed" : "failed"}`).join("\n")}` : "",
      `Diff:\n${input.diff || "(no changes)"}`,
    ]
    return lines.filter((l) => l.length).join("\n\n")
  }

  export const review = Effect.fn("AutonomousReviewer.review")(function* (input: {
    parent: SessionID
    dir: string
    state: AutonomousState.Info
    task: AutonomousState.Task
    model: AutonomousModels.Ref
    checks?: AutonomousVerifier.Report
  }) {
    const files = input.task.result?.changedFiles ?? []
    const body = yield* diff(input.dir, files.length ? files : undefined)
    const out = yield* AutonomousRunner.run({
      parent: input.parent,
      title: `Autonomous review ${input.task.id}`,
      agent: AutonomousAgents.REVIEWER,
      model: input.model,
      schema: Review,
      text: text({ task: input.task, state: input.state, diff: body, checks: input.checks, summary: input.task.result?.summary }),
      retries: 1,
    })
    const blocking = out.value.findings.filter((f) => f.blocking)
    return { review: out.value, blocking, cost: out.cost, tokens: out.tokens }
  })

  export const describe = (findings: readonly { file?: string; description: string }[]) =>
    findings.map((f) => `${f.file ? `${f.file}: ` : ""}${f.description}`).join("\n")
}
