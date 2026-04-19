import { describe, test, expect } from "bun:test"
import { writeFileSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  fromLegacyTeamConfig,
  migrateLegacyTeamConfig,
  migrateLegacyTeamConfigFile,
  LegacyParseTeamConfig,
} from "@/devilcode/team/migration"
import { CanonicalTeamConfig } from "@/devilcode/team/config"
import { CanonicalPosition } from "@/devilcode/team/library"

// ---------------------------------------------------------------------------
// Inlined legacy fixtures — byte-identical to TEAM_PRESETS[i].team from
// pre-Phase-2 presets.ts. Using LegacyParseTeamConfig.parse() to coerce
// defaults (canDelegate:[], etc.) without importing the deleted TeamConfig.
// ---------------------------------------------------------------------------

const LEGACY_SOLO_ENHANCED = LegacyParseTeamConfig.parse({
  enabled: true,
  roles: {
    lead: {
      displayName: "Lead Engineer",
      provider: "kilo",
      model: "gpt-5",
      effort: "high",
      tier: 1,
      canDelegate: ["research"],
      maxConcurrent: 3,
      capabilities: ["implementation", "planning"],
    },
    research: {
      displayName: "Research Scout",
      provider: "kilo",
      model: "gpt-5-mini",
      effort: "low",
      tier: 2,
      canDelegate: [],
      maxConcurrent: 4,
      capabilities: ["lookup", "summaries"],
    },
  },
  routing: { strategy: "hierarchical", defaultRole: "lead", escalationEnabled: true },
  reactions: [],
})

const LEGACY_CODE_REVIEW_PAIR = LegacyParseTeamConfig.parse({
  enabled: true,
  roles: {
    coder: {
      displayName: "Coder",
      provider: "kilo",
      model: "gpt-5",
      effort: "high",
      tier: 1,
      canDelegate: ["reviewer"],
      maxConcurrent: 3,
      capabilities: ["implementation", "tests"],
    },
    reviewer: {
      displayName: "Reviewer",
      provider: "kilo",
      model: "claude-4.1-sonnet",
      effort: "medium",
      tier: 2,
      canDelegate: [],
      maxConcurrent: 2,
      capabilities: ["review", "risk-analysis"],
    },
  },
  routing: { strategy: "hierarchical", defaultRole: "coder", escalationEnabled: true },
  reactions: [],
})

const LEGACY_FULL_STACK_TEAM = LegacyParseTeamConfig.parse({
  enabled: true,
  roles: {
    architect: {
      displayName: "Architect",
      provider: "kilo",
      model: "gpt-5",
      effort: "high",
      tier: 1,
      canDelegate: ["frontend-dev", "backend-dev", "reviewer"],
      maxConcurrent: 4,
      capabilities: ["design", "coordination"],
    },
    "frontend-dev": {
      displayName: "Frontend Developer",
      provider: "kilo",
      model: "claude-4.1-sonnet",
      effort: "medium",
      tier: 2,
      canDelegate: ["reviewer"],
      maxConcurrent: 3,
      capabilities: ["ui", "accessibility"],
    },
    "backend-dev": {
      displayName: "Backend Developer",
      provider: "kilo",
      model: "gpt-5-mini",
      effort: "medium",
      tier: 2,
      canDelegate: ["reviewer"],
      maxConcurrent: 3,
      capabilities: ["api", "db"],
    },
    reviewer: {
      displayName: "Reviewer",
      provider: "kilo",
      model: "gpt-5-mini",
      effort: "low",
      tier: 2,
      canDelegate: [],
      maxConcurrent: 2,
      capabilities: ["code-review"],
    },
  },
  routing: { strategy: "hierarchical", defaultRole: "architect", escalationEnabled: true },
  reactions: [],
})

const LEGACY_CI_CD_PIPELINE = LegacyParseTeamConfig.parse({
  enabled: true,
  roles: {
    release: {
      displayName: "Release Lead",
      provider: "kilo",
      model: "gpt-5",
      effort: "high",
      tier: 1,
      canDelegate: ["implementer", "ci-fixer"],
      maxConcurrent: 3,
      capabilities: ["release", "triage"],
    },
    implementer: {
      displayName: "Implementer",
      provider: "kilo",
      model: "claude-4.1-sonnet",
      effort: "medium",
      tier: 2,
      canDelegate: ["ci-fixer"],
      maxConcurrent: 4,
      capabilities: ["coding"],
    },
    "ci-fixer": {
      displayName: "CI Fixer",
      provider: "kilo",
      model: "gpt-5-mini",
      effort: "medium",
      tier: 2,
      canDelegate: [],
      maxConcurrent: 5,
      capabilities: ["ci", "tests"],
    },
  },
  routing: { strategy: "hierarchical", defaultRole: "release", escalationEnabled: true },
  reactions: [
    { trigger: "ci-failed", auto: true, action: "send-to-agent", targetRole: "ci-fixer", retries: 2 },
    { trigger: "agent-stuck", auto: true, action: "escalate", targetRole: "release", retries: 0, escalateAfterMinutes: 15 },
  ],
})

const LEGACY_RESEARCH_TEAM = LegacyParseTeamConfig.parse({
  enabled: true,
  roles: {
    orchestrator: {
      displayName: "Research Orchestrator",
      provider: "kilo",
      model: "gpt-5",
      effort: "high",
      tier: 1,
      canDelegate: ["deep-researcher", "fast-scanner"],
      maxConcurrent: 4,
      capabilities: ["synthesis"],
    },
    "deep-researcher": {
      displayName: "Deep Researcher",
      provider: "kilo",
      model: "claude-4.1-sonnet",
      effort: "high",
      tier: 2,
      canDelegate: [],
      maxConcurrent: 2,
      capabilities: ["analysis", "long-form"],
    },
    "fast-scanner": {
      displayName: "Fast Scanner",
      provider: "kilo",
      model: "gpt-5-mini",
      effort: "low",
      tier: 2,
      canDelegate: [],
      maxConcurrent: 6,
      capabilities: ["search", "triage"],
    },
  },
  routing: { strategy: "flat", defaultRole: "orchestrator", escalationEnabled: true },
  reactions: [],
})

// ---------------------------------------------------------------------------
// 5-preset migration tests (relocated from canonical-config.test.ts)
// ---------------------------------------------------------------------------

describe("fromLegacyTeamConfig — 5 preset migrations", () => {
  test("migrates solo-enhanced preset", () => {
    const result = fromLegacyTeamConfig(LEGACY_SOLO_ENHANCED)
    expect(result.ok).toBe(true)
    if (result.ok) {
      for (const role of Object.values(result.value.roles)) {
        expect(role.positionId).toBeDefined()
        expect(role.capabilities.length).toBeGreaterThan(0)
      }
      // Migration output must always be enabled:false regardless of input
      expect(result.value.enabled).toBe(false)
    }
  })

  test("migrates code-review-pair preset", () => {
    const result = fromLegacyTeamConfig(LEGACY_CODE_REVIEW_PAIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      for (const role of Object.values(result.value.roles)) {
        expect(role.positionId).toBeDefined()
        expect(role.capabilities.length).toBeGreaterThan(0)
      }
    }
  })

  test("migrates full-stack-team preset — 4 roles map correctly", () => {
    const result = fromLegacyTeamConfig(LEGACY_FULL_STACK_TEAM)
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
    const result = fromLegacyTeamConfig(LEGACY_CI_CD_PIPELINE)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const positionIds = new Set(Object.values(result.value.roles).map((r) => r.positionId))
      expect(positionIds.has("release-engineer")).toBe(true)
    }
  })

  test("migrates research-team preset — orchestrator→coordinator, researchers map correctly", () => {
    const result = fromLegacyTeamConfig(LEGACY_RESEARCH_TEAM)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const positionIds = new Set(Object.values(result.value.roles).map((r) => r.positionId))
      expect(positionIds.has("coordinator")).toBe(true)
      expect(positionIds.has("researcher")).toBe(true)
      // Assert canDelegate dedup: orchestrator→coordinator, both delegatees→researcher, deduped to 1 entry
      const coordinatorRole = result.value.roles["coordinator"]
      expect(coordinatorRole).toBeDefined()
      if (coordinatorRole) {
        // "deep-researcher" and "fast-scanner" both resolve to "researcher" → Set dedup → single entry
        expect(coordinatorRole.canDelegate).toHaveLength(1)
        expect(coordinatorRole.canDelegate[0]).toBe("researcher")
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Original 5 synthetic fixture tests (relocated from canonical-config.test.ts)
// ---------------------------------------------------------------------------

describe("fromLegacyTeamConfig — synthetic fixtures (original)", () => {
  test("unknown role key emits missing-position-id error and ok:false", () => {
    const legacyConfig = LegacyParseTeamConfig.parse({
      enabled: true,
      roles: {
        "totally-unknown-role-xyz": {
          displayName: "Unknown",
          provider: "kilo",
          model: "gpt-5",
          effort: "medium",
          tier: 2,
          capabilities: ["implementation"],
        },
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
    const legacyConfig = LegacyParseTeamConfig.parse({
      enabled: true,
      roles: {
        developer: {
          displayName: "Developer",
          provider: "kilo",
          model: "gpt-5",
          effort: "medium",
          tier: 2,
          capabilities: ["implementation", "completely-unknown-cap-xyz"],
        },
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
    const fixtures = [
      LEGACY_SOLO_ENHANCED,
      LEGACY_CODE_REVIEW_PAIR,
      LEGACY_FULL_STACK_TEAM,
      LEGACY_CI_CD_PIPELINE,
      LEGACY_RESEARCH_TEAM,
    ]
    for (const fixture of fixtures) {
      const result = fromLegacyTeamConfig(fixture)
      if (result.ok) {
        const reparse = CanonicalTeamConfig.safeParse(result.value)
        expect(reparse.success, `preset round-trip failed: ${!reparse.success ? reparse.error.message : ""}`).toBe(true)
      }
    }
  })

  // TRA-1: SUPPLEMENTARY_TO_IMPLEMENTATION code path
  test("capabilities 'ui' and 'api' inject 'implementation' and land in supplementaryCapabilities", () => {
    const legacyConfig = LegacyParseTeamConfig.parse({
      enabled: false,
      roles: {
        "frontend-specialist": {
          displayName: "Frontend Specialist",
          provider: "kilo",
          model: "gpt-5",
          effort: "medium",
          tier: 2,
          capabilities: ["ui", "api", "accessibility", "db"],
        },
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
        expect(role.supplementaryCapabilities).toContain("accessibility")
        expect(role.supplementaryCapabilities).toContain("db")
      }
    }
  })

  // TRA-2: defaultRole fallback path when legacy defaultRole is unresolvable
  test("unresolvable defaultRole falls back to first canonical role and emits missing-position-id warning", () => {
    const legacyConfig = LegacyParseTeamConfig.parse({
      enabled: false,
      roles: {
        coordinator: {
          displayName: "Coordinator",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          capabilities: ["planning"],
        },
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
})

// ---------------------------------------------------------------------------
// 5 NEW synthetic fixtures
// ---------------------------------------------------------------------------

describe("fromLegacyTeamConfig — synthetic fixtures (new)", () => {
  test("parse-failure on null input via migrateLegacyTeamConfig", () => {
    const result = migrateLegacyTeamConfig(null)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const parseFailures = result.errors.filter((e) => e.kind === "parse-failure")
      expect(parseFailures.length).toBeGreaterThan(0)
      expect(parseFailures[0]!.roleId).toBe("<root>")
    }
  })

  test("parse-failure on non-object JSON value (Zod schema rejection)", () => {
    const dir = mkdtempSync(join(tmpdir(), "migration-test-"))
    const filePath = join(dir, "bad.json")
    writeFileSync(filePath, JSON.stringify("not a team config"))
    const result = migrateLegacyTeamConfigFile(filePath)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const parseFailures = result.errors.filter((e) => e.kind === "parse-failure")
      expect(parseFailures.length).toBeGreaterThan(0)
    }
  })

  test("parse-failure on missing required routing field", () => {
    const result = migrateLegacyTeamConfig({ enabled: true, roles: { developer: { displayName: "Dev", provider: "kilo", model: "gpt-5", effort: "medium", tier: 2, capabilities: ["implementation"] } } })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const parseFailures = result.errors.filter((e) => e.kind === "parse-failure")
      expect(parseFailures.length).toBeGreaterThan(0)
    }
  })

  test("parse-failure on string tier (bug-shape input)", () => {
    const result = migrateLegacyTeamConfig({
      enabled: true,
      roles: {
        developer: {
          displayName: "Dev",
          provider: "kilo",
          model: "gpt-5",
          effort: "medium",
          tier: "two",
          capabilities: ["implementation"],
        },
      },
      routing: { strategy: "hierarchical", defaultRole: "developer", escalationEnabled: true },
      reactions: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const parseFailures = result.errors.filter((e) => e.kind === "parse-failure")
      expect(parseFailures.length).toBeGreaterThan(0)
    }
  })

  test("mixed canonical and synonym role keys both migrate correctly", () => {
    // "architect" is a direct CanonicalPosition; "lead" is a synonym for "senior-dev"
    const legacyConfig = LegacyParseTeamConfig.parse({
      enabled: false,
      roles: {
        architect: {
          displayName: "Architect",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          capabilities: ["design"],
        },
        lead: {
          displayName: "Lead",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          capabilities: ["implementation"],
        },
      },
      routing: { strategy: "hierarchical", defaultRole: "architect", escalationEnabled: true },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const positionIds = new Set(Object.keys(result.value.roles))
      expect(positionIds.has("architect")).toBe(true)
      expect(positionIds.has("senior-dev")).toBe(true)
    }
  })

  test("routing parentRole and reviewEscalationRole resolve via synonym and canonical match", () => {
    const legacyConfig = LegacyParseTeamConfig.parse({
      enabled: false,
      roles: {
        lead: {
          displayName: "Lead",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          canDelegate: [],
          maxConcurrent: 3,
          capabilities: ["implementation"],
        },
        reviewer: {
          displayName: "Reviewer",
          provider: "kilo",
          model: "gpt-5",
          effort: "medium",
          tier: 2,
          canDelegate: [],
          maxConcurrent: 2,
          capabilities: ["review"],
        },
      },
      routing: {
        strategy: "hierarchical",
        defaultRole: "lead",
        escalationEnabled: true,
        parentRole: "lead", // synonym → "senior-dev" via POSITION_SYNONYM_MAP
        reviewEscalationRole: "reviewer", // direct CanonicalPosition match
      },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.routing.parentRole).toBe("senior-dev") // synonym resolved
      expect(result.value.routing.reviewEscalationRole).toBe("reviewer") // direct match preserved
    }
  })

  test("two roles resolving to the same CanonicalPosition emit ambiguous-capability-mapping and merge capabilities", () => {
    const legacyConfig = LegacyParseTeamConfig.parse({
      enabled: false,
      roles: {
        "deep-researcher": {
          displayName: "Deep Researcher",
          provider: "kilo",
          model: "claude-4.1-sonnet",
          effort: "high",
          tier: 2,
          canDelegate: [],
          maxConcurrent: 2,
          capabilities: ["analysis"],
        },
        "fast-scanner": {
          displayName: "Fast Scanner",
          provider: "kilo",
          model: "gpt-5-mini",
          effort: "low",
          tier: 2,
          canDelegate: [],
          maxConcurrent: 6,
          capabilities: ["search"],
        },
        coordinator: {
          displayName: "Coordinator",
          provider: "kilo",
          model: "gpt-5",
          effort: "high",
          tier: 1,
          canDelegate: [],
          maxConcurrent: 3,
          capabilities: ["planning"],
        },
      },
      routing: { strategy: "hierarchical", defaultRole: "coordinator", escalationEnabled: true },
      reactions: [],
    })
    const result = fromLegacyTeamConfig(legacyConfig)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Both deep-researcher and fast-scanner resolve to "researcher" → collision
      expect("researcher" in result.value.roles).toBe(true)
      // ambiguous-capability-mapping warning must be emitted
      const collisionWarnings = result.warnings.filter((w) => w.kind === "ambiguous-capability-mapping")
      expect(collisionWarnings.length).toBeGreaterThan(0)
      // Merged capabilities should be union of both roles' mappings
      const researcherRole = result.value.roles["researcher"]!
      expect(researcherRole.capabilities).toContain("research") // "analysis" + "search" both map to "research"
      // Tier comes from POSITION_LIBRARY["researcher"].tier = 3 (library always wins)
      expect(researcherRole.tier).toBe(3)
    }
  })
})

// ---------------------------------------------------------------------------
// File-based API tests
// ---------------------------------------------------------------------------

describe("migrateLegacyTeamConfigFile", () => {
  test("valid legacy config file round-trips as ok:true", () => {
    const dir = mkdtempSync(join(tmpdir(), "migration-test-"))
    const filePath = join(dir, "preset.json")
    writeFileSync(
      filePath,
      JSON.stringify({
        enabled: false,
        roles: {
          coordinator: {
            displayName: "Coordinator",
            provider: "kilo",
            model: "gpt-5",
            effort: "high",
            tier: 1,
            canDelegate: [],
            maxConcurrent: 3,
            capabilities: ["planning"],
          },
        },
        routing: { strategy: "hierarchical", defaultRole: "coordinator", escalationEnabled: true },
        reactions: [],
      }),
    )
    const result = migrateLegacyTeamConfigFile(filePath)
    expect(result.ok).toBe(true)
  })

  test("malformed JSON file returns parse-failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "migration-test-"))
    const filePath = join(dir, "malformed.json")
    writeFileSync(filePath, "{ this is: not valid json }")
    const result = migrateLegacyTeamConfigFile(filePath)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const parseFailures = result.errors.filter((e) => e.kind === "parse-failure")
      expect(parseFailures.length).toBeGreaterThan(0)
      expect(parseFailures[0]!.roleId).toBe("<root>")
    }
  })

  test("nonexistent path returns parse-failure", () => {
    const result = migrateLegacyTeamConfigFile("/nonexistent/path/to/config.json")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const parseFailures = result.errors.filter((e) => e.kind === "parse-failure")
      expect(parseFailures.length).toBeGreaterThan(0)
      expect(parseFailures[0]!.roleId).toBe("<root>")
    }
  })
})
