import { Effect } from "effect"
import type { SessionID } from "@/session/schema"
import { AutonomousAgents } from "./agents"
import type { AutonomousModels } from "./models"
import { AutonomousRunner } from "./runner"
import { AutonomousShell } from "./shell"
import { AutonomousState } from "./state"

/** Runs one task in a worker child session and records the result on the task. */
export namespace AutonomousWorker {
  /** Paths from `git status --porcelain`; renames and copies yield the new path. */
  export function porcelain(out: string) {
    return out
      .split("\n")
      .filter((l) => l.length > 3)
      .map((l) => {
        const path = l.slice(3)
        const arrow = /^[RC]/.test(l.slice(0, 2)) ? path.indexOf(" -> ") : -1
        return (arrow >= 0 ? path.slice(arrow + 4) : path).trim()
      })
      .filter((p) => p.length > 0)
  }

  export const changed = (dir: string) =>
    AutonomousShell.git(["status", "--porcelain", "--untracked-files=all"], dir).pipe(
      Effect.map((r) => (r.code === 0 ? porcelain(r.stdout) : [])),
    )

  export function text(task: AutonomousState.Task, state: AutonomousState.Info, opts?: { repair?: string }) {
    const criteria = state.criteria.filter((c) => task.acceptanceCriteria.includes(c.id))
    const lines = [
      `Task ${task.id}: ${task.title}`,
      task.description,
      `Overall objective (context only, do not do more than the task):\n${state.objective}`,
    ]
    if (criteria.length) lines.push(`Acceptance criteria:\n${criteria.map((c) => `- ${c.id}: ${c.description}`).join("\n")}`)
    if (task.relevantFiles.length) lines.push(`Relevant files:\n${task.relevantFiles.map((f) => `- ${f}`).join("\n")}`)
    const done = state.tasks.filter((t) => t.status === "completed" && task.dependsOn.includes(t.id))
    if (done.length) lines.push(`Already done by earlier tasks:\n${done.map((t) => `- ${t.id}: ${t.result?.summary ?? t.title}`).join("\n")}`)
    if (task.failures.length) {
      lines.push(
        `Previous attempts failed. Do not repeat these mistakes:\n` +
          task.failures.slice(-3).map((f) => `- attempt ${f.attempt} (${f.stage}): ${AutonomousShell.truncate(f.message, 1500)}`).join("\n"),
      )
    }
    if (opts?.repair) lines.push(`Repair instructions:\n${opts.repair}`)
    return lines.join("\n\n")
  }

  export const run = Effect.fn("AutonomousWorker.run")(function* (input: {
    parent: SessionID
    dir: string
    state: AutonomousState.Info
    task: AutonomousState.Task
    model: AutonomousModels.Ref
    agent?: string
    repair?: string
  }) {
    const before = new Set(yield* changed(input.dir))
    const out = yield* AutonomousRunner.run({
      parent: input.parent,
      title: `Autonomous task ${input.task.id}: ${input.task.title}`,
      agent: input.agent ?? AutonomousAgents.WORKER,
      model: input.model,
      schema: AutonomousState.Result,
      text: text(input.task, input.state, { repair: input.repair }),
      retries: 1,
    })
    const after = yield* changed(input.dir)
    const detected = after.filter((f) => !before.has(f))
    const files = new Set([...out.value.changedFiles, ...detected])
    const result: AutonomousState.Result = {
      status: out.value.status,
      summary: out.value.summary,
      changedFiles: [...files],
      assumptions: [...out.value.assumptions],
      unresolved: [...out.value.unresolved],
      ...(out.value.confidence != null ? { confidence: out.value.confidence } : {}),
    }
    input.task.result = result
    return { result, cost: out.cost, tokens: out.tokens, sessionID: out.sessionID }
  })
}
