import { expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { AutonomousState } from "@/kilocode/autonomous/state"
import { AutonomousWorker } from "@/kilocode/autonomous/worker"
import { reply } from "../../lib/llm-server"
import { it, setup } from "./fixture"

const model = { providerID: "test", modelID: "coder" }

it.instance(
  "records the worker result and detects changed files from git",
  Effect.gen(function* () {
    const run = yield* setup()
    const state = AutonomousState.create({ sessionID: run.root.id, objective: "Add greeting" })
    state.criteria.push({ id: "ac1", description: "greet exists", status: "open" })
    const task: AutonomousState.Task = {
      id: "t1",
      title: "add greet",
      description: "create greet.ts",
      type: "implementation",
      status: "running",
      complexity: 1,
      dependsOn: [],
      relevantFiles: ["greet.ts"],
      acceptanceCriteria: ["ac1"],
      risk: {},
      preferredModelClass: "local-coder",
      attempts: 1,
      maxAttempts: 2,
      escalated: false,
      failures: [{ attempt: 0, stage: "check", fingerprint: "x", message: "tests failed earlier", modelClass: "local-coder" }],
    }
    state.tasks.push(task)
    const file = path.join(run.directory, "greet.ts")
    yield* run.llm.push(
      reply().tool("write", { filePath: file, content: "export const greet = () => 'hello'\n" }),
      reply().tool("StructuredOutput", { status: "completed", summary: "added greet", changedFiles: [], assumptions: [], unresolved: [] }),
    )
    const out = yield* AutonomousWorker.run({ parent: run.root.id, dir: run.directory, state, task, model })
    expect(out.result.status).toBe("completed")
    expect(out.result.changedFiles).toEqual(["greet.ts"])
    expect(task.result?.summary).toBe("added greet")
    const hits = yield* run.llm.hits
    const first = JSON.stringify(hits[0]?.body.messages)
    expect(first).toContain("Task t1: add greet")
    expect(first).toContain("ac1: greet exists")
    expect(first).toContain("tests failed earlier")
    expect(JSON.stringify(hits[0]?.body.tools)).toContain('"write"')
  }),
  { git: true },
  30_000,
)
