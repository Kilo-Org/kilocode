import { expect } from "bun:test"
import { Effect } from "effect"
import { AutonomousPlanner } from "@/kilocode/autonomous/planner"
import { AutonomousState } from "@/kilocode/autonomous/state"
import { reply } from "../../lib/llm-server"
import { it, setup } from "./fixture"

const model = { providerID: "test", modelID: "cloud" }
const plan = (tasks: unknown[]) => ({
  goal_summary: "Add a greeting",
  acceptance_criteria: [{ id: "ac1", description: "greet() returns hello" }],
  tasks,
  risks: [],
})
const task = (id: string, dependsOn: string[] = []) => ({
  id,
  title: id,
  description: `do ${id}`,
  type: "implementation",
  complexity: 1,
  dependsOn,
  relevantFiles: ["src/a.ts"],
  acceptanceCriteria: ["ac1"],
  risk: {},
  preferredModelClass: "local-coder",
})

it.instance(
  "accepts a valid plan and converts it to tasks",
  Effect.gen(function* () {
    const run = yield* setup()
    yield* run.llm.push(reply().tool("StructuredOutput", plan([task("t1"), task("t2", ["t1"])])))
    const state = AutonomousState.create({ sessionID: run.root.id, objective: "Add a greeting" })
    const out = yield* AutonomousPlanner.plan({ parent: run.root.id, state, model, maxAttempts: 2 })
    expect(out.tasks.map((t) => [t.id, t.status, t.maxAttempts])).toEqual([
      ["t1", "pending", 2],
      ["t2", "pending", 2],
    ])
    expect(out.plan.acceptance_criteria[0]?.id).toBe("ac1")
    const hits = yield* run.llm.hits
    expect(hits).toHaveLength(1)
    expect(hits[0]?.body.model).toBe("cloud")
    expect(JSON.stringify(hits[0]?.body.messages)).toContain("Add a greeting")
    expect(JSON.stringify(hits[0]?.body.tools)).not.toContain('"edit"')
  }),
  30_000,
)

it.instance(
  "retries once with the validation error when the DAG is invalid",
  Effect.gen(function* () {
    const run = yield* setup()
    yield* run.llm.push(
      reply().tool("StructuredOutput", plan([task("t1", ["missing"])])),
      reply().tool("StructuredOutput", plan([task("t1")])),
    )
    const state = AutonomousState.create({ sessionID: run.root.id, objective: "x" })
    const out = yield* AutonomousPlanner.plan({ parent: run.root.id, state, model, maxAttempts: 2 })
    expect(out.tasks.map((t) => t.id)).toEqual(["t1"])
    const hits = yield* run.llm.hits
    expect(hits).toHaveLength(2)
    expect(JSON.stringify(hits[1]?.body.messages)).toContain("unknown task")
  }),
  30_000,
)

it.instance(
  "fails when the plan stays invalid",
  Effect.gen(function* () {
    const run = yield* setup()
    yield* run.llm.push(reply().tool("StructuredOutput", plan([])), reply().tool("StructuredOutput", plan([])))
    const state = AutonomousState.create({ sessionID: run.root.id, objective: "x" })
    const exit = yield* Effect.exit(AutonomousPlanner.plan({ parent: run.root.id, state, model, maxAttempts: 2 }))
    expect(String(exit)).toContain("AutonomousPlanInvalid")
  }),
  30_000,
)
