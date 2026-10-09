import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AutonomousConfig } from "@/kilocode/autonomous/config"
import { AutonomousIssue } from "@/kilocode/autonomous/issue"
import { AutonomousMemory } from "@/kilocode/autonomous/memory"
import { AutonomousModels } from "@/kilocode/autonomous/models"
import { AutonomousPlanner } from "@/kilocode/autonomous/planner"
import { AutonomousRouter } from "@/kilocode/autonomous/router"
import { AutonomousState } from "@/kilocode/autonomous/state"
import { AutonomousStats } from "@/kilocode/autonomous/stats"
import { SessionID } from "@/session/schema"
import { it } from "./fixture"

const cfg = AutonomousConfig.resolve({})
const models = AutonomousModels.resolveWith({ autonomous: cfg, config: {}, fallback: { providerID: "p", modelID: "m" } })
const task = (over: Partial<AutonomousState.Task> = {}): AutonomousState.Task => ({
  id: "t",
  title: "t",
  description: "t",
  type: "implementation",
  status: "completed",
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
  route: { modelClass: "local-coder", model: "p/m", reason: "complexity 1" },
  ...over,
})

describe("AutonomousStats and history-aware routing", () => {
  test("records outcomes under the class that ran the first attempt", () => {
    let stats = AutonomousStats.empty("proj")
    stats = AutonomousStats.record(stats, task({ first: "local-coder" }))
    stats = AutonomousStats.record(stats, task({ first: "local-coder", attempts: 3, escalated: true, route: { modelClass: "cloud-reasoner", model: "c", reason: "escalated" } }))
    stats = AutonomousStats.record(stats, task({ first: "local-coder", status: "failed", attempts: 2 }))
    expect(AutonomousStats.get(stats, "local-coder", 1)).toEqual({ runs: 3, ok: 1, repairs: 3, escalations: 1 })
    expect(AutonomousStats.summary(stats)).toContain("local-coder:1: 1/3 ok")
    // A review failure is attributed to the class that implemented the attempt, not the reviewer's class.
    const reviewed = task({ complexity: 0, first: "local-small", status: "failed", route: { modelClass: "local-small", model: "s", reason: "" }, failures: [{ attempt: 1, stage: "review", fingerprint: "f", message: "m", modelClass: "local-coder", routed: "local-small" }] })
    const s2 = AutonomousStats.record(AutonomousStats.empty("p"), reviewed)
    expect(AutonomousStats.get(s2, "local-small", 0)?.runs).toBe(1)
    expect(AutonomousStats.get(s2, "local-coder", 0)).toBeUndefined()
  })

  it.effect("learn merges into the stored document instead of overwriting a stale snapshot", () =>
    Effect.gen(function* () {
      yield* AutonomousStats.learn("shared", task({ first: "local-coder" }))
      // A second goal holding an older snapshot adds its own task; both must survive.
      yield* AutonomousStats.learn("shared", task({ first: "local-coder", status: "failed" }))
      const stored = yield* AutonomousStats.load("shared")
      expect(AutonomousStats.get(stored, "local-coder", 1)).toMatchObject({ runs: 2, ok: 1 })
    }),
  )

  test("router escalates a local class with a poor track record, never below the base class", () => {
    let stats = AutonomousStats.empty("proj")
    for (let i = 0; i < AutonomousRouter.MIN_RUNS; i++) stats = AutonomousStats.record(stats, task({ status: i === 0 ? "completed" : "failed" }))
    const t = task({ status: "pending", route: undefined })
    expect(AutonomousRouter.classify(t, cfg)).toMatchObject({ modelClass: "local-coder" })
    expect(AutonomousRouter.classify(t, cfg, stats)).toMatchObject({ modelClass: "cloud-reasoner", reason: expect.stringContaining("20%") })
    expect(AutonomousRouter.classify(task({ status: "pending", complexity: 2, route: undefined }), cfg, stats)).toMatchObject({ modelClass: "local-coder" })
    const small = task({ status: "pending", complexity: 0, route: undefined })
    let s2 = AutonomousStats.empty("proj")
    for (let i = 0; i < AutonomousRouter.MIN_RUNS; i++) s2 = AutonomousStats.record(s2, task({ status: "failed", complexity: 0, route: { modelClass: "local-small", model: "p/m", reason: "" } }))
    expect(AutonomousRouter.classify(small, cfg, s2)).toMatchObject({ modelClass: "local-coder" })
    expect(AutonomousRouter.route({ task: t, state: AutonomousState.create({ sessionID: SessionID.make("ses_x"), objective: "o" }), cfg, models, stats })).toMatchObject({ ok: true, modelClass: "cloud-reasoner" })
  })
})

describe("AutonomousIssue", () => {
  test("parses issue references", () => {
    expect(AutonomousIssue.parse("#12")).toEqual({ ref: "#12", number: 12 })
    expect(AutonomousIssue.parse("Kilo-Org/kilocode#345")).toEqual({ ref: "Kilo-Org/kilocode#345", number: 345, repo: "Kilo-Org/kilocode" })
    expect(AutonomousIssue.parse("https://github.com/Kilo-Org/kilocode/issues/7")).toMatchObject({ number: 7, repo: "Kilo-Org/kilocode" })
    expect(AutonomousIssue.parse("fix #12 please")).toBeUndefined()
    expect(AutonomousIssue.parse("Add a feature")).toBeUndefined()
  })

  test("resolves a reference through the loader and leaves plain text alone", async () => {
    const seen: string[] = []
    const load = (ref: AutonomousIssue.Ref) => {
      seen.push(ref.ref)
      return Effect.succeed({ title: "Add subtract", body: "Return a minus b.", url: "https://github.com/o/r/issues/12" })
    }
    const out = await Effect.runPromise(AutonomousIssue.resolve("#12", "/tmp", load))
    expect(out.objective).toBe("Add subtract\n\nReturn a minus b.\n\nSource: https://github.com/o/r/issues/12")
    expect(seen).toEqual(["#12"])
    const plain = await Effect.runPromise(AutonomousIssue.resolve("Add a feature", "/tmp", load))
    expect(plain).toEqual({ objective: "Add a feature", issue: undefined })
    expect(seen).toHaveLength(1)
  })
})

describe("AutonomousMemory and planner notes", () => {
  it.effect("stores and updates the repository summary per project", () =>
    Effect.gen(function* () {
      expect(yield* AutonomousMemory.load("proj-a")).toBeUndefined()
      yield* AutonomousMemory.save({ projectID: "proj-a", summary: "node project, npm test" })
      const refreshed = yield* AutonomousMemory.save({ projectID: "proj-a", summary: "refined", count: false })
      expect(refreshed.goals).toBe(1)
      const second = yield* AutonomousMemory.save({ projectID: "proj-a", summary: "x".repeat(AutonomousMemory.MAX + 10) })
      expect(second.goals).toBe(2)
      expect(second.summary.length).toBe(AutonomousMemory.MAX)
      expect((yield* AutonomousMemory.load("proj-a"))?.goals).toBe(2)
      yield* AutonomousMemory.remove("proj-a")
      expect(yield* AutonomousMemory.load("proj-a")).toBeUndefined()
    }),
  )

  test("planner prompt includes memory and routing history when given", () => {
    const state = AutonomousState.create({ sessionID: SessionID.make("ses_p"), objective: "Add greet" })
    const text = AutonomousPlanner.text(state, { memory: "node project, npm test", history: "Routing history:\n  local-coder:1: 1/3 ok" })
    expect(text).toContain("Repository notes from a previous goal")
    expect(text).toContain("node project, npm test")
    expect(text).toContain("local-coder:1: 1/3 ok")
    expect(AutonomousPlanner.text(state)).not.toContain("Repository notes")
  })
})
