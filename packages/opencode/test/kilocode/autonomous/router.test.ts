import { describe, expect, test } from "bun:test"
import { AutonomousBudget } from "@/kilocode/autonomous/budget"
import { AutonomousConfig } from "@/kilocode/autonomous/config"
import { AutonomousModels } from "@/kilocode/autonomous/models"
import { AutonomousRouter } from "@/kilocode/autonomous/router"
import { AutonomousState } from "@/kilocode/autonomous/state"
import { SessionID } from "@/session/schema"

const cfg = AutonomousConfig.resolve({ autonomous_goal: { models: { local_small: "l/small", local_coder: "l/coder", cloud_reasoner: "c/big" } } })
const models = AutonomousModels.resolveWith({ autonomous: cfg, config: {}, fallback: { providerID: "d", modelID: "m" } })
const state = () => AutonomousState.create({ sessionID: SessionID.make("ses_router"), objective: "x" })
const task = (over: Partial<AutonomousState.Task> = {}): AutonomousState.Task => ({
  id: "t",
  title: "t",
  description: "t",
  type: "implementation",
  status: "pending",
  complexity: 1,
  dependsOn: [],
  relevantFiles: [],
  acceptanceCriteria: [],
  risk: {},
  preferredModelClass: "local-coder",
  attempts: 0,
  maxAttempts: 2,
  escalated: false,
  failures: [],
  ...over,
})

describe("AutonomousModels.resolveWith", () => {
  test("falls back through small_model, subagent_model, model, default", () => {
    const empty = AutonomousConfig.resolve({})
    const fb = { providerID: "d", modelID: "m" }
    expect(AutonomousModels.resolveWith({ autonomous: empty, config: {}, fallback: fb })).toEqual({
      "local-small": fb,
      "local-coder": fb,
      "cloud-reasoner": fb,
    })
    const some = AutonomousModels.resolveWith({
      autonomous: empty,
      config: { model: "p/main", small_model: "p/small", subagent_model: "p/sub" },
      fallback: fb,
    })
    expect(AutonomousModels.format(some["local-small"])).toBe("p/small")
    expect(AutonomousModels.format(some["local-coder"])).toBe("p/sub")
    expect(AutonomousModels.format(some["cloud-reasoner"])).toBe("p/main")
    expect(models["cloud-reasoner"]).toEqual({ providerID: "c", modelID: "big" })
  })
})

describe("AutonomousRouter", () => {
  const route = (t: AutonomousState.Task, s = state()) => AutonomousRouter.route({ task: t, state: s, cfg, models })

  test("routing matrix by complexity", () => {
    expect(route(task({ complexity: 0 }))).toMatchObject({ ok: true, modelClass: "local-small" })
    expect(route(task({ complexity: 1 }))).toMatchObject({ ok: true, modelClass: "local-coder" })
    expect(route(task({ complexity: 2 }))).toMatchObject({ ok: true, modelClass: "local-coder" })
    expect(route(task({ complexity: 3 }))).toMatchObject({ ok: true, modelClass: "cloud-reasoner", model: { modelID: "big" } })
  })

  test("risk flags, research and planner preference go to the cloud", () => {
    expect(route(task({ complexity: 0, risk: { security: true } }))).toMatchObject({ modelClass: "cloud-reasoner" })
    expect(route(task({ complexity: 0, type: "research" }))).toMatchObject({ modelClass: "cloud-reasoner" })
    expect(route(task({ complexity: 0, preferredModelClass: "cloud-reasoner" }))).toMatchObject({ modelClass: "cloud-reasoner" })
  })

  test("escalated task goes to the cloud", () => {
    expect(route(task({ complexity: 0, escalated: true }))).toMatchObject({ modelClass: "cloud-reasoner", reason: expect.stringContaining("escalated") })
  })

  test("cloud budget exhaustion blocks cloud routing but not local", () => {
    const s = state()
    AutonomousBudget.charge(s, { modelClass: "cloud-reasoner", taskID: "t", cost: cfg.budget.cloud_goal_max_usd })
    expect(route(task({ complexity: 4 }), s)).toMatchObject({ ok: false, reason: expect.stringContaining("goal") })
    expect(route(task({ complexity: 1 }), s)).toMatchObject({ ok: true, modelClass: "local-coder" })
  })
})

describe("AutonomousBudget", () => {
  test("ignores prototype-polluting task ids", () => {
    const s = state()
    AutonomousBudget.charge(s, { modelClass: "cloud-reasoner", taskID: "__proto__", cost: 1 })
    expect(Object.keys(s.budget.perTask)).toEqual([])
    expect((Object.prototype as unknown as { cost?: number }).cost).toBeUndefined()
    expect(AutonomousBudget.allow(s, cfg, "constructor")).toBe(true)
  })

  test("tracks cloud and local separately and enforces per-task limits", () => {
    const s = state()
    AutonomousBudget.charge(s, { modelClass: "local-coder", taskID: "a", cost: 100, tokens: { input: 5, output: 6 } })
    expect(AutonomousBudget.allow(s, cfg, "a")).toBe(true)
    expect(s.budget.local).toEqual({ cost: 100, calls: 1, input: 5, output: 6 })
    expect(s.budget.perTask["a"]).toBeUndefined()

    for (let i = 0; i < cfg.budget.max_cloud_calls_per_task; i++) AutonomousBudget.charge(s, { modelClass: "cloud-reasoner", taskID: "a", cost: 0.1 })
    expect(AutonomousBudget.reason(s, cfg, "a")).toContain("call limit for task a")
    expect(AutonomousBudget.allow(s, cfg, "b")).toBe(true)

    AutonomousBudget.charge(s, { modelClass: "cloud-reasoner", taskID: "b", cost: cfg.budget.cloud_task_max_usd })
    expect(AutonomousBudget.reason(s, cfg, "b")).toContain("budget for task b")
    expect(AutonomousBudget.total(s)).toBeCloseTo(100 + 0.3 + cfg.budget.cloud_task_max_usd)
  })
})
