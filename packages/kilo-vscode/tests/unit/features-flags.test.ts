import { afterEach, describe, expect, it } from "bun:test"
import { configFeatures, isFeatureEnabled, type UiFeature } from "../../src/features"

const ENV_KEYS = [
  "KILOCODE_FEATURE_AGENT_MANAGER",
  "KILOCODE_FEATURE_KILOCLAW",
  "KILOCODE_FEATURE_MARKETPLACE",
  "KILOCODE_FEATURE_WORKTREE",
] as const

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe("UI feature flags", () => {
  it("defaults all UI features to false when env is unset", () => {
    const features = configFeatures()
    expect(features.agentManager).toBe(false)
    expect(features.kiloClaw).toBe(false)
    expect(features.marketplace).toBe(false)
    expect(features.worktree).toBe(false)
  })

  it("enables a feature only when its env var is exactly \"true\"", () => {
    process.env.KILOCODE_FEATURE_MARKETPLACE = "true"
    process.env.KILOCODE_FEATURE_KILOCLAW = "1" // not "true" → stays off
    expect(configFeatures().marketplace).toBe(true)
    expect(configFeatures().kiloClaw).toBe(false)
  })

  it("isFeatureEnabled matches configFeatures for UI flags", () => {
    process.env.KILOCODE_FEATURE_AGENT_MANAGER = "true"
    const name: UiFeature = "agentManager"
    expect(isFeatureEnabled(name)).toBe(true)
    expect(isFeatureEnabled("worktree")).toBe(false)
  })
})
