import { describe, test, expect, beforeEach } from "bun:test"
import { applyPositionSwap, validatePositionSwap } from "@/devilcode/team/position-swap"
import type { PositionSwapRequest } from "@/devilcode/team/position-swap"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"
import { ConcurrencyManager } from "@/devilcode/team/concurrency"
import type { CanonicalTeamConfig } from "@/devilcode/team/config"

function makeTeamConfig(): CanonicalTeamConfig {
  return JSON.parse(JSON.stringify(loadQuickstartTemplates()["solo-enhanced"].team)) as CanonicalTeamConfig
}

/**
 * Chaos Scenario 1: Swap mid-wave
 *
 * Simulates: an in-flight task captures a reference to the model before the swap;
 * the swap happens; a new task reads the updated config.
 * The in-flight task retains its captured model (snapshot isolation).
 */
describe("chaos: swap mid-wave", () => {
  test("in-flight task retains old model reference, new task gets updated model", () => {
    const teamConfig = makeTeamConfig()

    // Simulate an in-flight task capturing provider+model at dispatch time
    const inFlightProvider = teamConfig.roles["researcher"].provider
    const inFlightModel = teamConfig.roles["researcher"].model

    // Swap happens while task is in-flight
    const swapRequest: PositionSwapRequest = { position: "researcher", provider: "anthropic", model: "claude-3-5-sonnet" }
    const result = applyPositionSwap(teamConfig, swapRequest)
    expect(result.success).toBe(true)

    // In-flight task still holds its captured values (snapshot at dispatch)
    expect(inFlightProvider).not.toBe(teamConfig.roles["researcher"].provider)
    expect(inFlightModel).not.toBe(teamConfig.roles["researcher"].model)

    // New task reads the updated config
    const newTaskProvider = teamConfig.roles["researcher"].provider
    const newTaskModel = teamConfig.roles["researcher"].model
    expect(newTaskProvider).toBe("anthropic")
    expect(newTaskModel).toBe("claude-3-5-sonnet")
  })

  test("swap during active wave does not affect other roles", () => {
    const teamConfig = makeTeamConfig()
    const originalSeniorDevProvider = teamConfig.roles["senior-dev"].provider
    const originalSeniorDevModel = teamConfig.roles["senior-dev"].model

    const swapRequest: PositionSwapRequest = { position: "researcher", provider: "openai", model: "gpt-4o" }
    applyPositionSwap(teamConfig, swapRequest)

    // Other roles must be untouched
    expect(teamConfig.roles["senior-dev"].provider).toBe(originalSeniorDevProvider)
    expect(teamConfig.roles["senior-dev"].model).toBe(originalSeniorDevModel)
  })
})

/**
 * Chaos Scenario 2: Swap during review
 *
 * The reviewer role is swapped while a review cycle is active.
 * The reviewer role's model change affects the NEXT review cycle,
 * not the in-flight one (snapshot isolation).
 */
describe("chaos: swap during review", () => {
  test("reviewer swap — next review cycle gets updated reviewer model", () => {
    const teamConfig = makeTeamConfig()

    // Capture the reviewer config at review-cycle start (snapshot)
    const reviewCycleProvider = teamConfig.roles["reviewer"].provider
    const reviewCycleModel = teamConfig.roles["reviewer"].model

    // Swap reviewer mid-review
    const swapRequest: PositionSwapRequest = { position: "reviewer", provider: "google", model: "gemini-pro" }
    const result = applyPositionSwap(teamConfig, swapRequest)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.previousProvider).toBe(reviewCycleProvider)
      expect(result.previousModel).toBe(reviewCycleModel)
    }

    // The current review cycle still uses the snapshot provider/model
    expect(reviewCycleProvider).not.toBe("google")

    // Next review cycle reads updated config
    expect(teamConfig.roles["reviewer"].provider).toBe("google")
    expect(teamConfig.roles["reviewer"].model).toBe("gemini-pro")
  })

  test("reviewer swap does not affect reviewer's capabilities or maxConcurrent", () => {
    const teamConfig = makeTeamConfig()
    const originalCapabilities = [...teamConfig.roles["reviewer"].capabilities]
    const originalMaxConcurrent = teamConfig.roles["reviewer"].maxConcurrent

    const swapRequest: PositionSwapRequest = { position: "reviewer", provider: "google", model: "gemini-pro" }
    applyPositionSwap(teamConfig, swapRequest)

    expect(teamConfig.roles["reviewer"].capabilities).toEqual(originalCapabilities)
    expect(teamConfig.roles["reviewer"].maxConcurrent).toBe(originalMaxConcurrent)
  })
})

/**
 * Chaos Scenario 3: Swap during challenge stage
 *
 * Multiple rapid swaps simulate a user frantically changing models during a challenge.
 * Final state must reflect the LAST swap only.
 */
describe("chaos: rapid consecutive swaps (during challenge)", () => {
  test("final state reflects last swap only after rapid consecutive swaps", () => {
    const teamConfig = makeTeamConfig()

    const swaps: PositionSwapRequest[] = [
      { position: "senior-dev", provider: "openai", model: "gpt-4o" },
      { position: "senior-dev", provider: "anthropic", model: "claude-opus" },
      { position: "senior-dev", provider: "mistral", model: "mistral-large" },
      { position: "senior-dev", provider: "google", model: "gemini-ultra" },
      { position: "senior-dev", provider: "kilo", model: "kilo-flagship" },
    ]

    for (const swap of swaps) {
      const result = applyPositionSwap(teamConfig, swap)
      expect(result.success).toBe(true)
    }

    // Only the last swap matters
    expect(teamConfig.roles["senior-dev"].provider).toBe("kilo")
    expect(teamConfig.roles["senior-dev"].model).toBe("kilo-flagship")
  })

  test("rapid swaps on different positions are all applied independently", () => {
    const teamConfig = makeTeamConfig()

    applyPositionSwap(teamConfig, { position: "researcher", provider: "openai", model: "gpt-4o-mini" })
    applyPositionSwap(teamConfig, { position: "reviewer", provider: "anthropic", model: "claude-haiku" })
    applyPositionSwap(teamConfig, { position: "senior-dev", provider: "mistral", model: "mistral-small" })

    expect(teamConfig.roles["researcher"].provider).toBe("openai")
    expect(teamConfig.roles["reviewer"].provider).toBe("anthropic")
    expect(teamConfig.roles["senior-dev"].provider).toBe("mistral")
  })
})

/**
 * Chaos Scenario 4: Invalid swap does not affect state
 *
 * An invalid swap request (unknown position) must leave the config unchanged.
 */
describe("chaos: invalid swap does not affect state", () => {
  test("unknown position — config is fully unchanged", () => {
    const teamConfig = makeTeamConfig()
    const snapshot = JSON.stringify(teamConfig)

    const result = applyPositionSwap(teamConfig, { position: "phantom-role", provider: "openai", model: "gpt-4o" })

    expect(result.success).toBe(false)
    expect(JSON.stringify(teamConfig)).toBe(snapshot)
  })

  test("multiple invalid swaps — config remains pristine", () => {
    const teamConfig = makeTeamConfig()
    const snapshot = JSON.stringify(teamConfig)

    applyPositionSwap(teamConfig, { position: "ghost-1", provider: "openai", model: "gpt-4o" })
    applyPositionSwap(teamConfig, { position: "ghost-2", provider: "anthropic", model: "claude-opus" })
    applyPositionSwap(teamConfig, { position: "ghost-3", provider: "google", model: "gemini-pro" })

    expect(JSON.stringify(teamConfig)).toBe(snapshot)
  })

  test("failed validation returns POSITION_NOT_FOUND code", () => {
    const teamConfig = makeTeamConfig()
    const result = validatePositionSwap(teamConfig, { position: "does-not-exist", provider: "any", model: "any" })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.code).toBe("POSITION_NOT_FOUND")
    }
  })
})

/**
 * Chaos Scenario 5: ConcurrencyManager.rebalanceAfterSwap under load
 */
describe("chaos: concurrency rebalancing", () => {
  let manager: ConcurrencyManager

  beforeEach(() => {
    manager = new ConcurrencyManager()
  })

  test("rebalanceAfterSwap returns no-op when newMax >= oldMax", () => {
    manager.acquire("researcher", "task-1")
    manager.acquire("researcher", "task-2")

    const result = manager.rebalanceAfterSwap("researcher", 2, 4)
    expect(result.freed).toBe(0)
    expect(result.queued).toBe(0)
  })

  test("rebalanceAfterSwap reports excess tasks when newMax < active count", () => {
    manager.acquire("researcher", "task-1")
    manager.acquire("researcher", "task-2")
    manager.acquire("researcher", "task-3")
    // active = 3, reduce max from 3 → 1

    const result = manager.rebalanceAfterSwap("researcher", 3, 1)
    expect(result.freed).toBe(0)
    expect(result.queued).toBe(2) // 3 active - 1 newMax = 2 excess
  })

  test("rebalanceAfterSwap returns no-op when active <= newMax", () => {
    manager.acquire("researcher", "task-1")
    // active = 1, reduce from 5 → 2 (still above active)

    const result = manager.rebalanceAfterSwap("researcher", 5, 2)
    expect(result.freed).toBe(0)
    expect(result.queued).toBe(0)
  })

  test("rebalanceAfterSwap is isolated per role", () => {
    manager.acquire("researcher", "task-1")
    manager.acquire("researcher", "task-2")
    manager.acquire("senior-dev", "task-3")

    const researcherResult = manager.rebalanceAfterSwap("researcher", 2, 1)
    const seniorDevResult = manager.rebalanceAfterSwap("senior-dev", 3, 3)

    expect(researcherResult.queued).toBe(1)
    expect(seniorDevResult.queued).toBe(0)
  })
})
