import { describe, expect, test } from "bun:test"
import { AutonomousConfig } from "../../../src/kilocode/autonomous/config"

describe("AutonomousConfig.resolve", () => {
  test("returns defaults when the section is missing", () => {
    const info = AutonomousConfig.resolve({})
    expect(info).toEqual(AutonomousConfig.defaults)
    expect(AutonomousConfig.enabled({})).toBe(false)
  })

  test("merges overrides over defaults", () => {
    const info = AutonomousConfig.resolve({
      autonomous_goal: {
        enabled: true,
        models: { cloud_reasoner: "anthropic/claude" },
        budget: { cloud_goal_max_usd: 3 },
        routing: { local_coder_max_complexity: 1 },
        checks: ["bun test"],
      },
    })
    expect(info.enabled).toBe(true)
    expect(info.models.cloud_reasoner).toBe("anthropic/claude")
    expect(info.budget).toEqual({ ...AutonomousConfig.defaults.budget, cloud_goal_max_usd: 3 })
    expect(info.routing).toEqual({ local_small_max_complexity: 0, local_coder_max_complexity: 1 })
    expect(info.stuck.same_error_limit).toBe(2)
    expect(info.checks).toEqual(["bun test"])
    expect(AutonomousConfig.enabled({ autonomous_goal: { enabled: true } })).toBe(true)
  })
})
