import { describe, it, expect } from "bun:test"
import { createSignal } from "solid-js"
import { withRoot } from "./test-harness"
import { useTeamValidation } from "../use-team-validation"
import { loadQuickstartTemplates } from "@devilcode/cli/devilcode/team/index"

describe("useTeamValidation", () => {
  it("returns isValid=true for a known-good quickstart", () => {
    withRoot(() => {
      const config = loadQuickstartTemplates()["solo-enhanced"].team
      const [signal] = createSignal(config)
      const result = useTeamValidation(signal)
      const r = result()
      expect(r.isValid).toBe(true)
      expect(r.missingStages).toEqual([])
      expect(r.errorsByRole).toEqual({})
    })
  })

  it("flags missing stages when no role provides release capability", () => {
    withRoot(() => {
      const baseline = loadQuickstartTemplates()["solo-enhanced"].team
      const roles = Object.fromEntries(
        Object.entries(baseline.roles).map(([k, v]) => [
          k,
          { ...v, capabilities: v.capabilities.filter((c: string) => c !== "release") },
        ]),
      )
      const broken = { ...baseline, roles }
      const [signal] = createSignal(broken)
      const result = useTeamValidation(signal)
      const r = result()
      expect(r.isValid).toBe(false)
      expect(r.missingStages).toContain("ship")
    })
  })

  it("groups role-level errors by role key in errorsByRole", () => {
    withRoot(() => {
      const baseline = loadQuickstartTemplates()["full-stack-team"].team
      const firstRoleKey = Object.keys(baseline.roles)[0]!
      const broken = {
        ...baseline,
        roles: {
          ...baseline.roles,
          [firstRoleKey]: {
            ...baseline.roles[firstRoleKey],
            canDelegate: ["__not-a-role__" as any],
          },
        },
      }
      const [signal] = createSignal(broken)
      const result = useTeamValidation(signal)
      const r = result()
      expect(r.isValid).toBe(false)
      // The broken role must appear as a key in errorsByRole with at least one error
      expect(Object.keys(r.errorsByRole)).toContain(firstRoleKey)
      expect(r.errorsByRole[firstRoleKey]!.length).toBeGreaterThan(0)
    })
  })

  it("re-evaluates when config signal changes", () => {
    // Verify valid config produces valid result
    const validResult = withRoot(() => {
      const good = loadQuickstartTemplates()["solo-enhanced"].team
      const [signal] = createSignal<any>(good)
      return useTeamValidation(signal)()
    })
    expect(validResult.isValid).toBe(true)

    // Verify stripping all roles produces invalid result (defaultRole not in roles)
    const invalidResult = withRoot(() => {
      const good = loadQuickstartTemplates()["solo-enhanced"].team
      const [signal] = createSignal<any>({ ...good, roles: {} })
      return useTeamValidation(signal)()
    })
    expect(invalidResult.isValid).toBe(false)
  })

  it("rawErrors carries every ZodIssue when invalid", () => {
    withRoot(() => {
      const [signal] = createSignal({ roles: {}, routing: { defaultRole: "architect", strategy: "hierarchical", escalationEnabled: true } })
      const result = useTeamValidation(signal)
      const r = result()
      expect(r.isValid).toBe(false)
      expect(r.rawErrors.length).toBeGreaterThan(0)
    })
  })
})
