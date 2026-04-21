import { describe, test, expect, beforeEach } from "bun:test"
import { validatePositionSwap, applyPositionSwap } from "@/devilcode/team/position-swap"
import type { PositionSwapRequest } from "@/devilcode/team/position-swap"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"
import type { CanonicalTeamConfig } from "@/devilcode/team/config"

// Build a valid team config from the solo-enhanced quickstart (covers all required capabilities)
function makeTeamConfig(): CanonicalTeamConfig {
  return JSON.parse(JSON.stringify(loadQuickstartTemplates()["solo-enhanced"].team)) as CanonicalTeamConfig
}

describe("validatePositionSwap", () => {
  let teamConfig: CanonicalTeamConfig

  beforeEach(() => {
    teamConfig = makeTeamConfig()
  })

  test("returns valid:true for an existing position", () => {
    const request: PositionSwapRequest = { position: "researcher", provider: "openai", model: "gpt-4o" }
    const result = validatePositionSwap(teamConfig, request)
    expect(result.valid).toBe(true)
  })

  test("returns POSITION_NOT_FOUND for an unknown position", () => {
    const request: PositionSwapRequest = { position: "nonexistent-role", provider: "openai", model: "gpt-4o" }
    const result = validatePositionSwap(teamConfig, request)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.code).toBe("POSITION_NOT_FOUND")
      expect(result.error).toContain("nonexistent-role")
    }
  })

  test("returns DELEGATION_VIOLATION when parent cannot delegate to target in hierarchical routing", () => {
    // coordinator can delegate to: senior-dev, researcher, reviewer, release-engineer (NOT itself)
    // Set parentRole to coordinator, and try to swap a role NOT in coordinator's canDelegate
    // The solo-enhanced config has coordinator with canDelegate: ["senior-dev", "researcher", "reviewer", "release-engineer"]
    // Add a role that coordinator cannot delegate to by constructing a custom scenario
    const config: CanonicalTeamConfig = {
      ...teamConfig,
      routing: {
        ...teamConfig.routing,
        strategy: "hierarchical",
        parentRole: "coordinator" as const,
      },
    }
    // coordinator's canDelegate does NOT include "coordinator" itself — swap coordinator position should fail
    // Actually coordinator IS in the roles but NOT in its own canDelegate list
    // Let's verify: coordinator can delegate to researcher, senior-dev, reviewer, release-engineer
    // Swapping "coordinator" itself — parentRole is coordinator, canDelegate does not include "coordinator"
    const request: PositionSwapRequest = { position: "coordinator", provider: "anthropic", model: "claude-opus" }
    const result = validatePositionSwap(config, request)
    // coordinator's canDelegate = ["senior-dev", "researcher", "reviewer", "release-engineer"]
    // coordinator NOT in that list → DELEGATION_VIOLATION
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.code).toBe("DELEGATION_VIOLATION")
    }
  })

  test("returns valid:true when position is in parent's canDelegate list", () => {
    const config: CanonicalTeamConfig = {
      ...teamConfig,
      routing: {
        ...teamConfig.routing,
        strategy: "hierarchical",
        parentRole: "coordinator" as const,
      },
    }
    // researcher IS in coordinator's canDelegate list
    const request: PositionSwapRequest = { position: "researcher", provider: "anthropic", model: "claude-haiku" }
    const result = validatePositionSwap(config, request)
    expect(result.valid).toBe(true)
  })
})

describe("applyPositionSwap", () => {
  let teamConfig: CanonicalTeamConfig

  beforeEach(() => {
    teamConfig = makeTeamConfig()
  })

  test("swaps provider and model on a valid position, returns previousProvider/previousModel", () => {
    const original = teamConfig.roles["researcher"]
    const prevProvider = original.provider
    const prevModel = original.model

    const request: PositionSwapRequest = { position: "researcher", provider: "anthropic", model: "claude-3-haiku" }
    const result = applyPositionSwap(teamConfig, request)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.position).toBe("researcher")
      expect(result.previousProvider).toBe(prevProvider)
      expect(result.previousModel).toBe(prevModel)
      expect(result.newProvider).toBe("anthropic")
      expect(result.newModel).toBe("claude-3-haiku")
      expect(result.slotsRebalanced).toBe(0)
    }
  })

  test("mutates the config in-place after a successful swap", () => {
    const request: PositionSwapRequest = { position: "researcher", provider: "anthropic", model: "claude-3-haiku" }
    applyPositionSwap(teamConfig, request)

    expect(teamConfig.roles["researcher"].provider).toBe("anthropic")
    expect(teamConfig.roles["researcher"].model).toBe("claude-3-haiku")
  })

  test("returns POSITION_NOT_FOUND for unknown position, does not mutate config", () => {
    const request: PositionSwapRequest = { position: "ghost-role", provider: "openai", model: "gpt-4o" }
    const result = applyPositionSwap(teamConfig, request)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe("POSITION_NOT_FOUND")
    }
  })

  test("config is unchanged after a failed swap", () => {
    const originalRoles = JSON.stringify(teamConfig.roles)
    const request: PositionSwapRequest = { position: "ghost-role", provider: "openai", model: "gpt-4o" }
    applyPositionSwap(teamConfig, request)

    expect(JSON.stringify(teamConfig.roles)).toBe(originalRoles)
  })

  test("rapid consecutive swaps — final state reflects last swap only", () => {
    const request1: PositionSwapRequest = { position: "researcher", provider: "openai", model: "gpt-4o" }
    const request2: PositionSwapRequest = { position: "researcher", provider: "anthropic", model: "claude-opus" }
    const request3: PositionSwapRequest = { position: "researcher", provider: "mistral", model: "mistral-large" }

    applyPositionSwap(teamConfig, request1)
    applyPositionSwap(teamConfig, request2)
    applyPositionSwap(teamConfig, request3)

    expect(teamConfig.roles["researcher"].provider).toBe("mistral")
    expect(teamConfig.roles["researcher"].model).toBe("mistral-large")
  })
})
