import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AutonomousChecker } from "@/kilocode/autonomous/checker"
import { AutonomousFinal } from "@/kilocode/autonomous/final"
import { AutonomousState } from "@/kilocode/autonomous/state"
import { SessionID } from "@/session/schema"
import { reply } from "../../lib/llm-server"
import { it, setup } from "./fixture"

const model = { providerID: "test", modelID: "cloud" }
const base = () => {
  const state = AutonomousState.create({ sessionID: SessionID.make("ses_checker"), objective: "greet" })
  state.criteria.push({ id: "ac1", description: "greet exists", status: "open" }, { id: "ac2", description: "greet tested", status: "open" })
  return state
}

describe("AutonomousChecker.apply and AutonomousFinal.gate", () => {
  test("marks criteria and treats unassessed ones as unmet", () => {
    const state = base()
    const done = AutonomousChecker.apply(state, {
      complete: true,
      criteria: [{ id: "ac1", status: "satisfied", evidence: "greet.ts" }],
      new_work: [],
    })
    expect(done).toBe(false)
    expect(state.criteria.map((c) => c.status)).toEqual(["satisfied", "unsatisfied"])
    expect(AutonomousFinal.gate(state, { ok: true, results: [] })).toEqual(["Unmet criteria: ac2"])
  })

  test("gate blocks on failing checks, findings and failed tasks", () => {
    const state = base()
    state.criteria.forEach((c) => (c.status = "satisfied"))
    state.findings.push({ id: "f", type: "bug", description: "x", blocking: true, resolved: false })
    state.tasks.push({
      id: "t1",
      title: "t",
      description: "t",
      type: "implementation",
      status: "failed",
      complexity: 3,
      dependsOn: [],
      relevantFiles: [],
      acceptanceCriteria: [],
      risk: {},
      preferredModelClass: "local-coder",
      attempts: 3,
      maxAttempts: 2,
      escalated: true,
      failures: [],
    })
    const reasons = AutonomousFinal.gate(state, { ok: false, results: [{ check: { name: "test", command: "bun test" }, ok: false, code: 1, output: "", ms: 1 }] })
    expect(reasons).toHaveLength(3)
    expect(AutonomousFinal.modelClass(state, 3)).toBe("cloud-reasoner")
    state.tasks[0]!.complexity = 1
    state.escalations = 0
    expect(AutonomousFinal.modelClass(state, 3)).toBe("local-coder")
  })
})

it.instance(
  "checker runs read-only over the full diff and requests new work",
  Effect.gen(function* () {
    const run = yield* setup()
    const state = base()
    state.sessionID = run.root.id
    yield* run.llm.push(
      reply().tool("StructuredOutput", {
        complete: false,
        criteria: [
          { id: "ac1", status: "satisfied", evidence: "ok" },
          { id: "ac2", status: "unsatisfied", reason: "no test" },
        ],
        new_work: ["add greet.test.ts"],
      }),
    )
    const out = yield* AutonomousChecker.check({ parent: run.root.id, dir: run.directory, state, model })
    expect(out.complete).toBe(false)
    expect(out.check.new_work).toEqual(["add greet.test.ts"])
    expect(state.criteria[1]?.reason).toBe("no test")
    const hits = yield* run.llm.hits
    expect(hits[0]?.body.model).toBe("cloud")
    expect(JSON.stringify(hits[0]?.body.tools)).not.toContain('"edit"')
  }),
  { git: true },
  30_000,
)
