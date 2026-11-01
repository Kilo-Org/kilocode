import { describe, expect, test } from "bun:test"
import { AutonomousConfig } from "@/kilocode/autonomous/config"
import { AutonomousRepair } from "@/kilocode/autonomous/repair"
import type { AutonomousState } from "@/kilocode/autonomous/state"

const cfg = AutonomousConfig.resolve({})
const task = (over: Partial<AutonomousState.Task> = {}): AutonomousState.Task => ({
  id: "t",
  title: "t",
  description: "t",
  type: "implementation",
  status: "repairing",
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

describe("AutonomousRepair", () => {
  test("first failure retries locally", () => {
    const t = task()
    AutonomousRepair.record(t, { stage: "check", message: "FAIL a.test.ts:12", modelClass: "local-coder" })
    expect(AutonomousRepair.decide(t, cfg)).toMatchObject({ action: "retry" })
    expect(AutonomousRepair.instructions(t)).toContain("mechanical checks failed")
  })

  test("same error twice escalates", () => {
    const t = task({ attempts: 1, maxAttempts: 5 })
    AutonomousRepair.record(t, { stage: "check", message: "FAIL a.test.ts:12", modelClass: "local-coder" })
    t.attempts = 2
    AutonomousRepair.record(t, { stage: "check", message: "FAIL a.test.ts:99", modelClass: "local-coder" })
    expect(t.failures[0]?.fingerprint).toBe(t.failures[1]?.fingerprint)
    expect(AutonomousRepair.decide(t, cfg)).toMatchObject({ action: "escalate", reason: expect.stringContaining("same failure") })
  })

  test("a worker run error retries like any other failure", () => {
    const t = task({ attempts: 1, maxAttempts: 3 })
    AutonomousRepair.record(t, { stage: "worker", message: "model timed out", modelClass: "local-coder" })
    expect(AutonomousRepair.decide(t, cfg)).toMatchObject({ action: "retry" })
    expect(AutonomousRepair.instructions(t)).toContain("failed before finishing")
  })

  test("exhausted local attempts escalate, blocked worker escalates", () => {
    const t = task({ attempts: 2 })
    AutonomousRepair.record(t, { stage: "review", message: "bad", modelClass: "local-coder" })
    expect(AutonomousRepair.decide(t, cfg)).toMatchObject({ action: "escalate", reason: expect.stringContaining("exhausted") })
    const b = task({ attempts: 1 })
    AutonomousRepair.record(b, { stage: "blocked", message: "cannot", modelClass: "local-small" })
    expect(AutonomousRepair.decide(b, cfg)).toMatchObject({ action: "escalate" })
  })

  test("a failed cloud attempt fails the task", () => {
    const t = task({ attempts: 3, escalated: true })
    AutonomousRepair.record(t, { stage: "check", message: "still broken", modelClass: "cloud-reasoner" })
    expect(AutonomousRepair.decide(t, cfg)).toMatchObject({ action: "fail" })
    const c = task({ attempts: 1, maxAttempts: 3, escalated: true })
    AutonomousRepair.record(c, { stage: "check", message: "x", modelClass: "cloud-reasoner" })
    expect(AutonomousRepair.decide(c, cfg)).toMatchObject({ action: "retry" })
  })
})
