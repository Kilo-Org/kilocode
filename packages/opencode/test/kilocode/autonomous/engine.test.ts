import { expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { AutonomousEngine } from "@/kilocode/autonomous/engine"
import { AutonomousState } from "@/kilocode/autonomous/state"
import { AutonomousStore } from "@/kilocode/autonomous/store"
import { GoalState } from "@/kilocode/session/goal/state"
import { pollWithTimeout } from "../../lib/effect"
import { reply } from "../../lib/llm-server"
import { it, setup } from "./fixture"

const so = (value: unknown) => reply().tool("StructuredOutput", value)
const plan = (tasks: unknown[], criteria = [{ id: "ac1", description: "greet.ts exports greet" }]) =>
  so({ goal_summary: "Add greet", acceptance_criteria: criteria, tasks, risks: [] }).usage({ input: 1000, output: 100 })
const task = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `task ${id}`,
  description: `do ${id}`,
  type: "implementation",
  complexity: 1,
  dependsOn: [],
  relevantFiles: [],
  acceptanceCriteria: ["ac1"],
  risk: {},
  preferredModelClass: "local-coder",
  ...over,
})
const done = (summary: string) => so({ status: "completed", summary, changedFiles: [], assumptions: [], unresolved: [] })
const ok = so({ ok: true, severity: "none", findings: [], confidence: 0.9 })
const complete = so({ complete: true, criteria: [{ id: "ac1", status: "satisfied", evidence: "greet.ts" }], new_work: [] })

const settled = (engine: AutonomousEngine.Interface, id: Parameters<typeof engine.status>[0]) =>
  pollWithTimeout(
    AutonomousStore.load(id).pipe(Effect.map((s) => (s && !AutonomousState.active(s.status) && !engine.running(id) ? s : undefined))),
    "goal did not settle",
    "90 seconds",
  )

it.instance(
  "plans, repairs a failing check locally, reviews, checks the goal and completes",
  Effect.gen(function* () {
    const run = yield* setup({ autonomous_goal: { enabled: true, checks: ["test -f done.txt"] } })
    const engine = yield* AutonomousEngine.make()
    const greet = path.join(run.directory, "greet.ts")
    const marker = path.join(run.directory, "done.txt")
    yield* run.llm.push(
      plan([task("t1"), task("t2", { dependsOn: ["t1"], complexity: 0 })]),
      // t1 attempt 1: writes greet.ts, check fails (no done.txt)
      reply().tool("write", { filePath: greet, content: "export const greet = () => 'hello'\n" }),
      done("added greet"),
      // t1 attempt 2 (local repair): writes done.txt, check passes, review ok
      reply().tool("write", { filePath: marker, content: "ok\n" }),
      done("added marker"),
      ok,
      // t2: nothing to do, check passes, review ok
      done("nothing else"),
      ok,
      // goal check + final review
      complete,
      ok,
    )
    yield* engine.start(run.root.id, "Add a greet function")
    expect(GoalState.read((yield* run.sessions.get(run.root.id)).metadata)).toMatchObject({ status: "active", active: true })
    const state = yield* settled(engine, run.root.id)
    expect(state.status).toBe("completed")
    expect(state.tasks.map((t) => [t.id, t.status, t.attempts, t.escalated])).toEqual([
      ["t1", "completed", 2, false],
      ["t2", "completed", 1, false],
    ])
    expect(state.tasks[0]?.failures).toHaveLength(1)
    expect(state.tasks[0]?.failures[0]?.stage).toBe("check")
    expect(state.tasks[0]?.route?.modelClass).toBe("local-coder")
    expect(state.tasks[1]?.route?.modelClass).toBe("local-small")
    expect(state.criteria[0]?.status).toBe("satisfied")
    expect(state.final?.review).toBe(true)
    expect(state.budget.cloud.calls).toBe(2)
    expect(state.budget.local.calls).toBeGreaterThanOrEqual(5)
    expect(state.budget.cloud.cost).toBeGreaterThan(0)
    const hits = yield* run.llm.hits
    expect(hits[0]?.body.model).toBe("cloud")
    expect(hits.at(-1)?.body.model).toBe("coder")
    expect(JSON.stringify(hits[3]?.body.messages)).toContain("mechanical checks failed")
    expect(GoalState.read((yield* run.sessions.get(run.root.id)).metadata)).toMatchObject({ status: "complete", active: false })
    const events = state.events.map((e) => e.event)
    expect(events).toContain("planned")
    expect(events).toContain("task.check.failed")
    expect(events).toContain("goal.completed")
  }),
  { git: true },
  120_000,
)

it.instance(
  "escalates the same error twice to the cloud model and fails the task after a cloud failure",
  Effect.gen(function* () {
    const run = yield* setup({ autonomous_goal: { enabled: true, checks: ["test -f done.txt"], worker_max_attempts: 5 } })
    const engine = yield* AutonomousEngine.make()
    yield* run.llm.push(
      plan([task("t1"), task("t2", { dependsOn: ["t1"] })]),
      done("try 1"),
      done("try 2"),
      done("cloud try"),
    )
    yield* engine.start(run.root.id, "x")
    const state = yield* settled(engine, run.root.id)
    expect(state.status).toBe("blocked")
    expect(state.reason).toContain("t1")
    expect(state.tasks.map((t) => [t.id, t.status])).toEqual([
      ["t1", "failed"],
      ["t2", "blocked"],
    ])
    expect(state.tasks[0]?.escalated).toBe(true)
    expect(state.escalations).toBe(1)
    const hits = yield* run.llm.hits
    expect(hits.map((h) => h.body.model)).toEqual(["cloud", "coder", "coder", "cloud"])
    expect(GoalState.read((yield* run.sessions.get(run.root.id)).metadata)).toMatchObject({ status: "blocked" })
  }),
  { git: true },
  120_000,
)

it.instance(
  "pauses on request and resumes from persisted tasks; stale running state reads as paused",
  Effect.gen(function* () {
    const run = yield* setup({ autonomous_goal: { enabled: true, checks: ["true"] } })
    const engine = yield* AutonomousEngine.make()
    const state = AutonomousState.create({ sessionID: run.root.id, objective: "x" })
    state.status = "running"
    state.criteria.push({ id: "ac1", description: "c", status: "open" })
    state.tasks.push(
      { ...(task("t1") as any), status: "completed", attempts: 1, maxAttempts: 2, escalated: false, failures: [], result: { status: "completed", summary: "did t1", changedFiles: [], assumptions: [], unresolved: [] } },
      { ...(task("t2", { dependsOn: ["t1"] }) as any), status: "pending", attempts: 0, maxAttempts: 2, escalated: false, failures: [] },
    )
    yield* AutonomousStore.save(state)
    const stale = yield* engine.status(run.root.id)
    expect(stale?.status).toBe("paused")
    expect(stale?.reason).toContain("restart")

    yield* run.llm.push(done("did t2"), ok, complete, ok)
    yield* engine.resume(run.root.id)
    const final = yield* settled(engine, run.root.id)
    expect(final.status).toBe("completed")
    expect(final.tasks.map((t) => [t.id, t.status])).toEqual([
      ["t1", "completed"],
      ["t2", "completed"],
    ])
    const hits = yield* run.llm.hits
    expect(hits).toHaveLength(4)
    expect(JSON.stringify(hits[0]?.body.messages)).toContain("did t1")
  }),
  { git: true },
  120_000,
)

it.instance(
  "pause interrupts a running goal and clear removes it",
  Effect.gen(function* () {
    const run = yield* setup({ autonomous_goal: { enabled: true, checks: ["true"] } })
    const engine = yield* AutonomousEngine.make()
    yield* run.llm.push(plan([task("t1")]), reply().hang())
    yield* engine.start(run.root.id, "x")
    yield* pollWithTimeout(
      AutonomousStore.load(run.root.id).pipe(Effect.map((s) => (s?.tasks.length ? true : undefined))),
      "plan did not land",
      "20 seconds",
    )
    yield* engine.pause(run.root.id)
    const paused = yield* AutonomousStore.load(run.root.id)
    expect(paused?.status).toBe("paused")
    expect(engine.running(run.root.id)).toBe(false)
    expect(GoalState.read((yield* run.sessions.get(run.root.id)).metadata)).toMatchObject({ status: "paused" })
    yield* engine.clear(run.root.id)
    expect(yield* AutonomousStore.load(run.root.id)).toBeUndefined()
    expect(GoalState.read((yield* run.sessions.get(run.root.id)).metadata)).toBeUndefined()
  }),
  { git: true },
  120_000,
)
