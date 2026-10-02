import { describe, expect, test } from "bun:test"
import { AutonomousProgress } from "@/kilocode/autonomous/progress"
import { AutonomousState } from "@/kilocode/autonomous/state"
import { SessionID } from "@/session/schema"

const task = (id: string, over: Partial<AutonomousState.Task> = {}): AutonomousState.Task => ({
  id,
  title: `Task ${id}`,
  description: id,
  type: "implementation",
  status: "pending",
  complexity: 1,
  dependsOn: [],
  relevantFiles: [],
  acceptanceCriteria: [],
  risk: {},
  preferredModelClass: "local-coder",
  attempts: 1,
  maxAttempts: 2,
  escalated: false,
  failures: [],
  ...over,
})

const state = () => {
  const s = AutonomousState.create({ sessionID: SessionID.make("ses_progress"), objective: "add icons" })
  s.tasks = [task("t1"), task("t2", { dependsOn: ["t1"], complexity: 3 })]
  s.criteria = [{ id: "c1", description: "icons render", status: "open" }]
  s.summary = "Add icons to the mind map."
  s.budget.cloud.cost = 0.42
  return s
}

describe("AutonomousProgress", () => {
  test("plan lists every task with order and complexity", () => {
    const text = AutonomousProgress.plan(state(), "Plan ready")
    expect(text).toContain("Plan ready: 2 tasks, 1 acceptance criteria")
    expect(text).toContain("cloud $0.42")
    expect(text).toContain("1. Task t1 (complexity 1)")
    expect(text).toContain("2. Task t2 (complexity 3, after t1)")
  })

  test("start names the model and whether it is local or cloud", () => {
    const s = state()
    const text = AutonomousProgress.start(s, s.tasks[1]!, {
      modelClass: "local-coder",
      model: { providerID: "ollama", modelID: "qwen" } as never,
      reason: "complexity 1",
    })
    expect(text).toContain("Task 2/2 started: Task t2")
    expect(text).toContain("(local, complexity 1)")
  })

  test("worker result shows the summary and changed files", () => {
    const text = AutonomousProgress.worked(task("t1"), {
      status: "completed",
      summary: "Added icon map.\nMore detail.",
      changedFiles: ["a.js", "b.css"],
      assumptions: [],
      unresolved: [],
    })
    expect(text).toContain("worker finished: Added icon map.")
    expect(text).not.toContain("More detail")
    expect(text).toContain("Changed: a.js, b.css")
  })

  test("failure says what happens next", () => {
    const s = state()
    const text = AutonomousProgress.failed(s, s.tasks[0]!, "check", "FAIL a.test.ts\nstack", { action: "escalate", reason: "same failure twice" })
    expect(text).toContain("Task 1/2 check failed: FAIL a.test.ts")
    expect(text).toContain("Next: escalating to the cloud model (same failure twice)")
  })

  test("done counts completed tasks", () => {
    const s = state()
    s.tasks[0]!.status = "completed"
    expect(AutonomousProgress.done(s, s.tasks[0]!)).toContain("1 of 2 tasks complete")
  })
})
