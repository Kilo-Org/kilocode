import { describe, expect, test } from "bun:test"
import { CanonicalTeamConfig, CanonicalTeamRole } from "@/devilcode/team/config"
import { CanonicalCapability, STAGE_CAPABILITY_REQUIREMENTS } from "@/devilcode/team/capabilities"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildValidCanonicalTeam(): import("@/devilcode/team/config").CanonicalTeamConfig {
  // Covers all 7 stage capabilities: planning, design, implementation, review, release, testing, retrospective
  return CanonicalTeamConfig.parse({
    enabled: true,
    roles: {
      coordinator: {
        displayName: "Coordinator",
        positionId: "coordinator",
        provider: "kilo",
        model: "gpt-5",
        effort: "high",
        tier: 1,
        canDelegate: ["architect", "senior-dev", "reviewer", "release-engineer", "qa-tester"],
        maxConcurrent: 4,
        capabilities: ["planning", "retrospective"],
        supplementaryCapabilities: [],
      },
      architect: {
        displayName: "Architect",
        positionId: "architect",
        provider: "kilo",
        model: "gpt-5",
        effort: "high",
        tier: 1,
        canDelegate: ["senior-dev", "reviewer"],
        maxConcurrent: 3,
        capabilities: ["planning", "design"],
        supplementaryCapabilities: [],
      },
      "senior-dev": {
        displayName: "Senior Developer",
        positionId: "senior-dev",
        provider: "kilo",
        model: "claude-4.1-sonnet",
        effort: "high",
        tier: 1,
        canDelegate: ["reviewer"],
        maxConcurrent: 3,
        capabilities: ["implementation", "design"],
        supplementaryCapabilities: [],
      },
      reviewer: {
        displayName: "Reviewer",
        positionId: "reviewer",
        provider: "kilo",
        model: "gpt-5-mini",
        effort: "medium",
        tier: 2,
        canDelegate: [],
        maxConcurrent: 2,
        capabilities: ["review"],
        supplementaryCapabilities: [],
      },
      "qa-tester": {
        displayName: "QA Tester",
        positionId: "qa-tester",
        provider: "kilo",
        model: "gpt-5-mini",
        effort: "medium",
        tier: 2,
        canDelegate: [],
        maxConcurrent: 3,
        capabilities: ["review", "testing"],
        supplementaryCapabilities: [],
      },
      "release-engineer": {
        displayName: "Release Engineer",
        positionId: "release-engineer",
        provider: "kilo",
        model: "gpt-5-mini",
        effort: "medium",
        tier: 2,
        canDelegate: [],
        maxConcurrent: 2,
        capabilities: ["release"],
        supplementaryCapabilities: [],
      },
    },
    routing: {
      strategy: "hierarchical",
      defaultRole: "coordinator",
      escalationEnabled: true,
    },
    reactions: [],
  })
}

function buildCanonicalTeamMissing(cap: CanonicalCapability): unknown {
  const team = buildValidCanonicalTeam()
  // Remove all roles that provide the target capability
  const filteredRoles = Object.fromEntries(
    Object.entries(team.roles).filter(([, role]) => !role.capabilities.includes(cap)),
  )
  return {
    ...team,
    roles: filteredRoles,
  }
}

// ---------------------------------------------------------------------------
// CanonicalTeamConfig strict stage coverage
// ---------------------------------------------------------------------------

describe("CanonicalTeamConfig strict stage coverage", () => {
  test("valid canonical team parses successfully", () => {
    expect(() => buildValidCanonicalTeam()).not.toThrow()
    const result = CanonicalTeamConfig.safeParse(buildValidCanonicalTeam())
    expect(result.success).toBe(true)
  })

  test.each(Object.entries(STAGE_CAPABILITY_REQUIREMENTS))(
    "removing required capability for stage '%s' (%s) causes parse failure",
    (stage, cap) => {
      const missingTeam = buildCanonicalTeamMissing(cap as CanonicalCapability)
      const result = CanonicalTeamConfig.safeParse(missingTeam)
      expect(result.success).toBe(false)
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(" ")
        expect(messages).toContain(stage)
        expect(messages).toContain(cap)
      }
    },
  )

  test("team missing both retrospective and release reports BOTH in one error", () => {
    // Remove all roles with retrospective or release capabilities
    const team = buildValidCanonicalTeam()
    const filteredRoles = Object.fromEntries(
      Object.entries(team.roles).filter(
        ([, role]) => !role.capabilities.includes("retrospective") && !role.capabilities.includes("release"),
      ),
    )
    const missingTeam = { ...team, roles: filteredRoles }
    const result = CanonicalTeamConfig.safeParse(missingTeam)
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ")
      expect(messages).toContain("retro(retrospective)")
      expect(messages).toContain("ship(release)")
    }
  })

  test("canonical role with non-canonical capability value is rejected at role level", () => {
    const result = CanonicalTeamRole.safeParse({
      displayName: "Test Role",
      positionId: "developer",
      provider: "kilo",
      model: "gpt-5",
      effort: "medium",
      tier: 2,
      capabilities: ["not-a-canonical-capability"],
      supplementaryCapabilities: [],
    })
    expect(result.success).toBe(false)
  })

  test("supplementaryCapabilities round-trip preserves the field", () => {
    const roleData = {
      displayName: "Backend Specialist",
      positionId: "backend-specialist",
      provider: "kilo",
      model: "gpt-5-mini",
      effort: "medium",
      tier: 2,
      capabilities: ["implementation"],
      supplementaryCapabilities: ["api", "db"],
    }
    const result = CanonicalTeamRole.safeParse(roleData)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.supplementaryCapabilities).toEqual(["api", "db"])
    }
  })

  test("positionId required on every canonical role", () => {
    const result = CanonicalTeamRole.safeParse({
      displayName: "No Position",
      provider: "kilo",
      model: "gpt-5",
      effort: "medium",
      tier: 2,
      capabilities: ["implementation"],
    })
    expect(result.success).toBe(false)
  })

  // TRA-3: non-canonical role key is rejected by the roles key refine
  test("role keyed with non-canonical position is rejected", () => {
    const result = CanonicalTeamConfig.safeParse({
      enabled: false,
      roles: {
        "totally-bogus-role": {
          displayName: "Bogus",
          positionId: "developer",
          provider: "kilo",
          model: "gpt-5",
          effort: "medium",
          tier: 2,
          capabilities: ["implementation"],
          supplementaryCapabilities: [],
        },
      },
      routing: {
        strategy: "hierarchical",
        defaultRole: "developer",
        escalationEnabled: true,
      },
      reactions: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ")
      expect(messages).toContain("valid CanonicalPosition")
    }
  })

  test("enabled:false canonical team skips coverage refinement", () => {
    // A team with enabled:false but no capabilities should parse fine
    const result = CanonicalTeamConfig.safeParse({
      enabled: false,
      roles: {
        developer: {
          displayName: "Developer",
          positionId: "developer",
          provider: "kilo",
          model: "gpt-5",
          effort: "medium",
          tier: 2,
          capabilities: ["implementation"],
          supplementaryCapabilities: [],
        },
      },
      routing: {
        strategy: "hierarchical",
        defaultRole: "developer",
        escalationEnabled: true,
      },
      reactions: [],
    })
    expect(result.success).toBe(true)
  })
})
