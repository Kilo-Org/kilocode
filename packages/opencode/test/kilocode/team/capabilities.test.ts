import { describe, expect, test } from "bun:test"
import z from "zod"
import { CanonicalCapability, STAGE_CAPABILITY_REQUIREMENTS, requiredCapabilitiesFor } from "@/devilcode/team/capabilities"
import { WorkflowStage } from "@/devilcode/workflow/types"

describe("capabilities", () => {
  test("CanonicalCapability enum has exactly 8 values", () => {
    const values = CanonicalCapability.options
    expect(values).toHaveLength(8)
    expect(new Set(values)).toEqual(
      new Set([
        "planning",
        "design",
        "implementation",
        "review",
        "release",
        "testing",
        "research",
        "retrospective",
      ]),
    )
  })

  test("CanonicalCapability rejects unknown values", () => {
    const result = CanonicalCapability.safeParse("coordination")
    expect(result.success).toBe(false)
  })

  test("STAGE_CAPABILITY_REQUIREMENTS covers all 7 WorkflowStage values", () => {
    const allStages = WorkflowStage.options
    expect(allStages).toHaveLength(7)
    for (const stage of allStages) {
      expect(STAGE_CAPABILITY_REQUIREMENTS).toHaveProperty(stage)
    }
  })

  test("STAGE_CAPABILITY_REQUIREMENTS has no extra stages", () => {
    const allStages = new Set(WorkflowStage.options)
    const mappedStages = Object.keys(STAGE_CAPABILITY_REQUIREMENTS)
    expect(mappedStages).toHaveLength(allStages.size)
    for (const stage of mappedStages) {
      expect(allStages.has(stage as z.infer<typeof WorkflowStage>)).toBe(true)
    }
  })

  test("each STAGE_CAPABILITY_REQUIREMENTS value is a CanonicalCapability", () => {
    const validCapabilities = new Set(CanonicalCapability.options)
    for (const [stage, cap] of Object.entries(STAGE_CAPABILITY_REQUIREMENTS)) {
      expect(validCapabilities.has(cap as any), `stage "${stage}" maps to unknown capability "${cap}"`).toBe(true)
    }
  })

  test("retro stage requires retrospective capability", () => {
    expect(STAGE_CAPABILITY_REQUIREMENTS.retro).toBe("retrospective")
  })

  test("challenge stage reuses planning capability", () => {
    expect(STAGE_CAPABILITY_REQUIREMENTS.challenge).toBe("planning")
    expect(STAGE_CAPABILITY_REQUIREMENTS.plan).toBe("planning")
  })

  test("requiredCapabilitiesFor returns unique capabilities preserving order", () => {
    const result = requiredCapabilitiesFor(["plan", "challenge", "contract"])
    // plan -> planning, challenge -> planning (dup), contract -> design
    expect(result).toEqual(["planning", "design"])
  })

  test("requiredCapabilitiesFor(empty) returns empty array", () => {
    const result = requiredCapabilitiesFor([])
    expect(result).toEqual([])
  })
})
