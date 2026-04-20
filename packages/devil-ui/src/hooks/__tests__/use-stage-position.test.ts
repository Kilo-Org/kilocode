/**
 * Tests for useStagePosition hook.
 */
import { describe, it, expect } from "bun:test"
import { createSignal } from "solid-js"
import { withRoot } from "./test-harness"
import { useStagePosition } from "../use-stage-position"
import type { WorkflowStageValue, UseStagePositionContext } from "../use-stage-position"

// Minimal team config matching the "solo-enhanced" pattern
const SOLO_TEAM: UseStagePositionContext = {
  roles: {
    architect: {
      label: "Architect",
      model: "claude-opus-4",
      capabilities: ["planning", "design", "review", "retrospective"],
    },
    developer: {
      label: "Developer",
      model: "claude-sonnet-4",
      capabilities: ["implementation", "release"],
    },
  },
}

describe("useStagePosition", () => {
  it("returns position for a stage covered by a role", () => {
    withRoot(() => {
      const [stage] = createSignal<WorkflowStageValue>("plan")
      const [team] = createSignal(SOLO_TEAM)
      const info = useStagePosition(stage, team)
      expect(info().position).toBe("architect")
    })
  })

  it("returns undefined position when no role covers the stage", () => {
    withRoot(() => {
      const [stage] = createSignal<WorkflowStageValue>("build")
      const [team] = createSignal<UseStagePositionContext>({
        roles: {
          designer: {
            capabilities: ["design"],
          },
        },
      })
      const info = useStagePosition(stage, team)
      expect(info().position).toBeUndefined()
    })
  })

  it("returns requiredCapability for the stage", () => {
    withRoot(() => {
      const [stage] = createSignal<WorkflowStageValue>("build")
      const [team] = createSignal(SOLO_TEAM)
      const info = useStagePosition(stage, team)
      expect(info().requiredCapability).toBe("implementation")
    })
  })

  it("returns roleLabel and modelLabel when position is found", () => {
    withRoot(() => {
      const [stage] = createSignal<WorkflowStageValue>("ship")
      const [team] = createSignal(SOLO_TEAM)
      const info = useStagePosition(stage, team)
      const { roleLabel, modelLabel, position } = info()
      expect(position).toBe("developer")
      expect(roleLabel).toBe("Developer")
      expect(modelLabel).toBe("claude-sonnet-4")
    })
  })

  it("returns correct stage on the returned info object", () => {
    withRoot(() => {
      const [stage] = createSignal<WorkflowStageValue>("retro")
      const [team] = createSignal(SOLO_TEAM)
      const info = useStagePosition(stage, team)
      expect(info().stage).toBe("retro")
    })
  })

  it("re-evaluates reactively when stage signal changes (via two separate roots)", () => {
    // In server/SSR context, verify that changing the input produces a different result.
    // Two separate roots simulate two reactive evaluations (one per stage value).
    const infoForPlan = withRoot(() => {
      const [stage] = createSignal<WorkflowStageValue>("plan")
      const [team] = createSignal(SOLO_TEAM)
      return useStagePosition(stage, team)()
    })
    const infoForBuild = withRoot(() => {
      const [stage] = createSignal<WorkflowStageValue>("build")
      const [team] = createSignal(SOLO_TEAM)
      return useStagePosition(stage, team)()
    })
    expect(infoForPlan.position).toBe("architect")
    expect(infoForBuild.position).toBe("developer")
  })

  it("handles empty roles gracefully — returns undefined position", () => {
    withRoot(() => {
      const [stage] = createSignal<WorkflowStageValue>("review")
      const [team] = createSignal<UseStagePositionContext>({ roles: {} })
      const info = useStagePosition(stage, team)
      expect(info().position).toBeUndefined()
      expect(info().requiredCapability).toBe("review")
    })
  })

  it("handles team without roles property — returns undefined position", () => {
    withRoot(() => {
      const [stage] = createSignal<WorkflowStageValue>("contract")
      const [team] = createSignal<UseStagePositionContext>({})
      const info = useStagePosition(stage, team)
      expect(info().position).toBeUndefined()
    })
  })
})
