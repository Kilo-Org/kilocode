import { describe, expect, test } from "bun:test"
import {
  CanonicalTeamConfig,
  CanonicalTeamRole,
  TeamRole,
  TeamConfig,
  fromLegacyTeamConfig,
} from "@/devilcode/team/config"
import { CanonicalCapability, STAGE_CAPABILITY_REQUIREMENTS } from "@/devilcode/team/capabilities"
import { CanonicalPosition } from "@/devilcode/team/library"
import { TEAM_PRESETS } from "@/devilcode/team/presets"

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

// ---------------------------------------------------------------------------
// fromLegacyTeamConfig migration helper
// ---------------------------------------------------------------------------

describe("fromLegacyTeamConfig migration helper", () => {
  test("migrates solo-enhanced preset", () => {
    const preset = TEAM_PRESETS.find((p) => p.id === "solo-enhanced")!
    expect(preset).toBeDefined()
    const result = fromLegacyTeamConfig(preset.team)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // All roles have positionId and canonical capabilities
      for (const role of Object.values(result.value.roles)) {
        expect(role.positionId).toBeDefined()
        expect(role.capabilities.length).toBeGreaterThan(0)
      }
    }
  })

  test("migrates code-review-pair preset", () => {
    const preset = TEAM_PRESETS.find((p) => p.id === "code-review-pair")!
    expect(preset).toBeDefined()
    const result = fromLegacyTeamConfig(preset.team)
    expect(result.ok).toBe(true)
    if (result.ok) {
      for (const role of Object.values(result.value.roles)) {
        expect(role.positionId).toBeDefined()
        expect(role.capabilities.length).toBeGreaterThan(0)
      }
    }
  })

  test("migrates full-stack-team preset — 4 roles map correctly", () => {
    const preset = TEAM_PRESETS.find((p) => p.id === "full-stack-team")!
    expect(preset).toBeDefined()
    const result = fromLegacyTeamConfig(preset.team)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const positionIds = new Set(Object.values(result.value.roles).map((r) => r.positionId))
      // architect → architect, frontend-dev → frontend-specialist, backend-dev → backend-specialist, reviewer → reviewer
      expect(positionIds.has("architect")).toBe(true)
      expect(positionIds.has("frontend-specialist")).toBe(true)
      expect(positionIds.has("backend-specialist")).toBe(true)
      expect(positionIds.has("reviewer")).toBe(true)
    }
  })

  test("migrates ci-cd-pipeline preset — 3 roles including release-engineer", () => {
    const preset = TEAM_PRESETS.find((p) => p.id === "ci-cd-pipeline")!
    expect(preset).toBeDefined()
    const result = fromLegacyTeamConfig(preset.team)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const positionIds = new Set(Object.values(result.value.roles).map((r) => r.positionId))
      expect(positionIds.has("release-engineer")).toBe(true)
    }
  })

  test("migrates research-team preset — orchestrator→coordinator, researchers map correctly", () => {
    const preset = TEAM_PRESETS.find((p) => p.id === "research-team")!
    expect(preset).toBeDefined()
    const result = fromLegacyTeamConfig(preset.team)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const positionIds = new Set(Object.values(result.value.roles).map((r) => r.positionId))
      expect(positionIds.has("coordinator")).toBe(true)
      expect(positionIds.has("researcher")).toBe(true)
    }
  })

  test("unknown role key emits missing-position-id error and ok:false", () => {
    const legacyConfig = TeamConfig.parse({
      enabled: true,
      roles: {
        "totally-unknown-role-xyz": TeamRole.parse({
          displayName: "Unknown",
          provider: "kilo",
          model: "gpt-5",
          effort: "medium",
          tier: 2,
          capabilities: ["implementation"],
        }),
      },
      routing: { strategy: "hierarchical", defaultRole: "totally-unknown-role-xyz", escalationEnabled: true },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const missingIds = result.errors.filter((e) => e.kind === "missing-position-id")
      expect(missingIds.length).toBeGreaterThan(0)
    }
  })

  test("unknown capability value emits warning and lands in supplementaryCapabilities", () => {
    const legacyConfig = TeamConfig.parse({
      enabled: true,
      roles: {
        developer: TeamRole.parse({
          displayName: "Developer",
          provider: "kilo",
          model: "gpt-5",
          effort: "medium",
          tier: 2,
          capabilities: ["implementation", "completely-unknown-cap-xyz"],
        }),
      },
      routing: { strategy: "hierarchical", defaultRole: "developer", escalationEnabled: true },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const devRole = result.value.roles["developer"]
      expect(devRole).toBeDefined()
      if (devRole) {
        expect(devRole.supplementaryCapabilities).toContain("completely-unknown-cap-xyz")
      }
      const unknownCapWarnings = result.warnings.filter(
        (w) => w.kind === "unknown-capability" && w.value === "completely-unknown-cap-xyz",
      )
      expect(unknownCapWarnings.length).toBeGreaterThan(0)
    }
  })

  test("migration output for each preset passes CanonicalTeamConfig.safeParse (round-trip integrity)", () => {
    for (const preset of TEAM_PRESETS) {
      const result = fromLegacyTeamConfig(preset.team)
      if (result.ok) {
        const reparse = CanonicalTeamConfig.safeParse(result.value)
        expect(reparse.success, `preset "${preset.id}" failed round-trip: ${!reparse.success ? reparse.error.message : ""}`).toBe(true)
      }
    }
  })

  // TRA-1: SUPPLEMENTARY_TO_IMPLEMENTATION code path
  test("capabilities 'ui' and 'api' inject 'implementation' and land in supplementaryCapabilities", () => {
    const legacyConfig = TeamConfig.parse({
      enabled: false,
      roles: {
        "frontend-specialist": TeamRole.parse({
          displayName: "Frontend Specialist",
          provider: "kilo",
          model: "gpt-5",
          effort: "medium",
          tier: 2,
          capabilities: ["ui", "api"],
        }),
      },
      routing: { strategy: "hierarchical", defaultRole: "frontend-specialist", escalationEnabled: true },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const role = result.value.roles["frontend-specialist"]
      expect(role).toBeDefined()
      if (role) {
        expect(role.capabilities).toContain("implementation")
        expect(role.supplementaryCapabilities).toContain("ui")
        expect(role.supplementaryCapabilities).toContain("api")
      }
    }
  })

  // TRA-2: defaultRole fallback path when legacy defaultRole is unresolvable
  test("unresolvable defaultRole falls back to first canonical role and emits missing-position-id warning", () => {
    const legacyConfig = TeamConfig.parse({
      enabled: false,
      roles: {
        coordinator: TeamRole.parse({
          displayName: "Coordinator",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          capabilities: ["planning"],
        }),
      },
      routing: { strategy: "hierarchical", defaultRole: "totally-unknown-default", escalationEnabled: true },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const missingPositionWarnings = result.warnings.filter((w) => w.kind === "missing-position-id")
      expect(missingPositionWarnings.length).toBeGreaterThan(0)
      const validPositions = CanonicalPosition.options as readonly string[]
      expect(validPositions).toContain(result.value.routing.defaultRole)
    }
  })

  // TRA-4 (part 1): parentRole synonym resolution — "orchestrator" → "coordinator"
  test("parentRole 'orchestrator' migrates to canonical 'coordinator'", () => {
    const legacyConfig = TeamConfig.parse({
      enabled: false,
      roles: {
        coordinator: TeamRole.parse({
          displayName: "Coordinator",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          capabilities: ["planning"],
        }),
        orchestrator: TeamRole.parse({
          displayName: "Orchestrator",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          capabilities: ["planning"],
        }),
      },
      routing: {
        strategy: "hierarchical",
        defaultRole: "coordinator",
        escalationEnabled: true,
        parentRole: "orchestrator",
      },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.routing.parentRole).toBe("coordinator")
    }
  })

  // TRA-4 (part 2): unresolvable parentRole is silently dropped (undefined)
  test("unresolvable parentRole is dropped from migrated routing", () => {
    const legacyConfig = TeamConfig.parse({
      enabled: false,
      roles: {
        coordinator: TeamRole.parse({
          displayName: "Coordinator",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          capabilities: ["planning"],
        }),
      },
      routing: {
        strategy: "hierarchical",
        defaultRole: "coordinator",
        escalationEnabled: true,
        parentRole: "totally-unknown",
      },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.routing.parentRole).toBeUndefined()
    }
  })

  // C2-2 Test A: QA-1 regression — empty-capability warning is emitted and fallback applied
  test("role with all-empty capabilities emits no-mappable-capabilities-fallback warning", () => {
    const legacyConfig = TeamConfig.parse({
      enabled: false,
      roles: {
        developer: TeamRole.parse({
          displayName: "Developer",
          provider: "kilo",
          model: "gpt-5",
          effort: "medium",
          tier: 2,
          capabilities: [],
        }),
      },
      routing: { strategy: "hierarchical", defaultRole: "developer", escalationEnabled: true },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const fallbackWarnings = result.warnings.filter(
        (w) => w.kind === "unknown-capability" && w.value === "<no-mappable-capabilities-fallback:research>",
      )
      expect(fallbackWarnings.length).toBeGreaterThan(0)
    }
  })

  // C2-2 Test B: QA-2 regression — canDelegate deduplication when two synonyms resolve to same CanonicalPosition
  test("canDelegate synonyms resolving to the same CanonicalPosition are deduplicated", () => {
    const legacyConfig = TeamConfig.parse({
      enabled: false,
      roles: {
        coordinator: TeamRole.parse({
          displayName: "Coordinator",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          canDelegate: ["deep-researcher", "fast-scanner"],
          capabilities: ["planning"],
        }),
        "deep-researcher": TeamRole.parse({
          displayName: "Deep Researcher",
          provider: "kilo",
          model: "gpt-5",
          effort: "medium",
          tier: 2,
          capabilities: ["research"],
        }),
        "fast-scanner": TeamRole.parse({
          displayName: "Fast Scanner",
          provider: "kilo",
          model: "gpt-5",
          effort: "low",
          tier: 3,
          capabilities: ["research"],
        }),
      },
      routing: { strategy: "hierarchical", defaultRole: "coordinator", escalationEnabled: true },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const coordinatorRole = result.value.roles["coordinator"]
      expect(coordinatorRole).toBeDefined()
      if (coordinatorRole) {
        const canDelegate = coordinatorRole.canDelegate
        // Both "deep-researcher" and "fast-scanner" resolve to "researcher" — no duplicates allowed
        expect(new Set(canDelegate).size).toBe(canDelegate.length)
      }
    }
  })

  // C2-2 Test C / C2-1 regression: collision detection emits warning AND canDelegate is union-merged
  test("two roles colliding on same CanonicalPosition emit ambiguous-capability-mapping and union-merge canDelegate", () => {
    // "deep-researcher" (canDelegate: ["orchestrator"]) and "fast-scanner" (canDelegate: [])
    // both resolve to "researcher"; "orchestrator" resolves to "coordinator"
    const legacyConfig = TeamConfig.parse({
      enabled: false,
      roles: {
        "deep-researcher": TeamRole.parse({
          displayName: "Deep Researcher",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 2,
          canDelegate: ["orchestrator"],
          capabilities: ["research"],
        }),
        "fast-scanner": TeamRole.parse({
          displayName: "Fast Scanner",
          provider: "kilo",
          model: "gpt-5",
          effort: "low",
          tier: 3,
          canDelegate: [],
          capabilities: ["research"],
        }),
        orchestrator: TeamRole.parse({
          displayName: "Orchestrator",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          capabilities: ["planning"],
        }),
      },
      routing: { strategy: "hierarchical", defaultRole: "orchestrator", escalationEnabled: true },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Collision warning must be present
      const collisionWarnings = result.warnings.filter((w) => w.kind === "ambiguous-capability-mapping")
      expect(collisionWarnings.length).toBeGreaterThan(0)
      // Merged "researcher" role must exist
      const researcherRole = result.value.roles["researcher"]
      expect(researcherRole).toBeDefined()
      if (researcherRole) {
        // "orchestrator" → "coordinator"; the union-merge must include it
        expect(researcherRole.canDelegate).toContain("coordinator")
        // No duplicates
        expect(new Set(researcherRole.canDelegate).size).toBe(researcherRole.canDelegate.length)
      }
    }
  })

  // C2-3: reviewEscalationRole synonym resolution — "reviewer" is a direct CanonicalPosition match
  test("reviewEscalationRole 'reviewer' migrates to canonical 'reviewer'", () => {
    const legacyConfig = TeamConfig.parse({
      enabled: false,
      roles: {
        coordinator: TeamRole.parse({
          displayName: "Coordinator",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          capabilities: ["planning"],
        }),
        reviewer: TeamRole.parse({
          displayName: "Reviewer",
          provider: "kilo",
          model: "gpt-5",
          effort: "medium",
          tier: 2,
          capabilities: ["review"],
        }),
      },
      routing: {
        strategy: "hierarchical",
        defaultRole: "coordinator",
        escalationEnabled: true,
        reviewEscalationRole: "reviewer",
      },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.routing.reviewEscalationRole).toBe("reviewer")
    }
  })

  // C2-3: unresolvable reviewEscalationRole is silently dropped (undefined)
  test("unresolvable reviewEscalationRole is dropped from migrated routing", () => {
    const legacyConfig = TeamConfig.parse({
      enabled: false,
      roles: {
        coordinator: TeamRole.parse({
          displayName: "Coordinator",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          capabilities: ["planning"],
        }),
      },
      routing: {
        strategy: "hierarchical",
        defaultRole: "coordinator",
        escalationEnabled: true,
        reviewEscalationRole: "totally-unknown-role",
      },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.routing.reviewEscalationRole).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// Legacy types unchanged after Phase 1
// ---------------------------------------------------------------------------

describe("Legacy types unchanged after Phase 1", () => {
  test("TeamRole still accepts stringly-typed capabilities", () => {
    const result = TeamRole.safeParse({
      displayName: "Legacy Role",
      provider: "kilo",
      model: "gpt-5",
      effort: "medium",
      tier: 1,
      canDelegate: [],
      maxConcurrent: 3,
      capabilities: ["coding", "ci"],
    })
    expect(result.success).toBe(true)
  })

  test("TeamConfig parse of existing TEAM_PRESETS[0].team succeeds", () => {
    const preset = TEAM_PRESETS[0]
    expect(preset).toBeDefined()
    const result = TeamConfig.safeParse(preset.team)
    expect(result.success).toBe(true)
  })
})
