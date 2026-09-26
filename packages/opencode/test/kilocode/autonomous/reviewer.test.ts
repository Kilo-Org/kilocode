import { expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { AutonomousReviewer } from "@/kilocode/autonomous/reviewer"
import { AutonomousState } from "@/kilocode/autonomous/state"
import { reply } from "../../lib/llm-server"
import { it, setup } from "./fixture"

const model = { providerID: "test", modelID: "coder" }
const task = (): AutonomousState.Task => ({
  id: "t1",
  title: "add greet",
  description: "create greet.ts",
  type: "implementation",
  status: "verifying",
  complexity: 1,
  dependsOn: [],
  relevantFiles: [],
  acceptanceCriteria: ["ac1"],
  risk: {},
  preferredModelClass: "local-coder",
  attempts: 1,
  maxAttempts: 2,
  escalated: false,
  failures: [],
  result: { status: "completed", summary: "added greet", changedFiles: ["greet.ts"], assumptions: [], unresolved: [] },
})

it.instance(
  "sends the diff and returns blocking findings",
  Effect.gen(function* () {
    const run = yield* setup()
    yield* Effect.promise(() => Bun.write(path.join(run.directory, "greet.ts"), "export const greet = () => 'hello'\n"))
    const state = AutonomousState.create({ sessionID: run.root.id, objective: "Add greeting" })
    state.criteria.push({ id: "ac1", description: "greet exists", status: "open" })
    const t = task()
    yield* run.llm.push(
      reply().tool("StructuredOutput", {
        ok: false,
        severity: "high",
        findings: [
          { id: "f1", type: "bug", file: "greet.ts", description: "returns hello instead of Hello", blocking: true },
          { id: "f2", type: "style", description: "nit", blocking: false },
        ],
        confidence: 0.9,
      }),
    )
    const out = yield* AutonomousReviewer.review({ parent: run.root.id, dir: run.directory, state, task: t, model })
    expect(out.review.ok).toBe(false)
    expect(out.blocking.map((f) => f.id)).toEqual(["f1"])
    const hits = yield* run.llm.hits
    const body = JSON.stringify(hits[0]?.body.messages)
    expect(body).toContain("+++ b/greet.ts")
    expect(body).toContain("Worker summary")
    expect(JSON.stringify(hits[0]?.body.tools)).not.toContain('"edit"')
  }),
  { git: true },
  30_000,
)

it.instance(
  "passes a clean review",
  Effect.gen(function* () {
    const run = yield* setup()
    const state = AutonomousState.create({ sessionID: run.root.id, objective: "x" })
    yield* run.llm.push(reply().tool("StructuredOutput", { ok: true, severity: "none", findings: [], confidence: 0.8 }))
    const out = yield* AutonomousReviewer.review({ parent: run.root.id, dir: run.directory, state, task: task(), model })
    expect(out.review.ok).toBe(true)
    expect(out.blocking).toEqual([])
  }),
  { git: true },
  30_000,
)
