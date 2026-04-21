import { describe, it, expect } from "bun:test"
import {
  CURRENT_TEAM_CONFIG_VERSION,
  isLegacyShape,
  migrateTeamConfig,
} from "@/devilcode/team/versioning"
import { TeamSchemaValidationError } from "@/devilcode/team/errors"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"

describe("CURRENT_TEAM_CONFIG_VERSION", () => {
  it("is 1.0.0", () => {
    expect(CURRENT_TEAM_CONFIG_VERSION).toBe("1.0.0")
  })
})

describe("isLegacyShape", () => {
  it("returns false for non-object input", () => {
    expect(isLegacyShape(null)).toBe(false)
    expect(isLegacyShape(undefined)).toBe(false)
    expect(isLegacyShape("string")).toBe(false)
    expect(isLegacyShape(42)).toBe(false)
    expect(isLegacyShape([])).toBe(false)
  })

  it("returns false when roles missing or not an object", () => {
    expect(isLegacyShape({})).toBe(false)
    expect(isLegacyShape({ roles: null })).toBe(false)
    expect(isLegacyShape({ roles: [] })).toBe(false)
    expect(isLegacyShape({ roles: "oops" })).toBe(false)
  })

  it("returns false for empty roles map", () => {
    expect(isLegacyShape({ roles: {} })).toBe(false)
  })

  it("returns true when every role lacks positionId but has displayName", () => {
    const legacy = {
      roles: {
        lead: { displayName: "Lead", provider: "x", model: "y" },
        coder: { displayName: "Coder", provider: "x", model: "y" },
      },
    }
    expect(isLegacyShape(legacy)).toBe(true)
  })

  it("returns false when any role has positionId", () => {
    const mixed = {
      roles: {
        lead: { displayName: "Lead", positionId: "senior-dev" },
      },
    }
    expect(isLegacyShape(mixed)).toBe(false)
  })

  it("returns false when a role lacks displayName (canonical may be malformed, but not legacy)", () => {
    const notLegacy = {
      roles: {
        lead: { provider: "x", model: "y" },
      },
    }
    expect(isLegacyShape(notLegacy)).toBe(false)
  })

  it("canonical quickstart templates are NOT detected as legacy", () => {
    const templates = loadQuickstartTemplates()
    for (const template of Object.values(templates)) {
      expect(isLegacyShape(template.team)).toBe(false)
    }
  })
})

describe("migrateTeamConfig", () => {
  it("passes canonical config through unchanged (identity-v1)", async () => {
    const template = loadQuickstartTemplates()["solo-enhanced"].team
    const migrated = await migrateTeamConfig(template)
    expect(migrated).toEqual(template)
  })

  it("migrates valid legacy shape to canonical", async () => {
    const legacy = {
      enabled: false,
      roles: {
        developer: {
          displayName: "Dev",
          provider: "openrouter",
          model: "gpt-4",
          effort: "default",
          tier: 2,
          canDelegate: [],
          maxConcurrent: 3,
          capabilities: ["implementation"],
        },
      },
      routing: {
        strategy: "hierarchical",
        defaultRole: "developer",
        escalationEnabled: true,
      },
    }
    const migrated = await migrateTeamConfig(legacy)
    expect(migrated.roles["developer"]).toBeDefined()
    expect(migrated.roles["developer"]?.positionId).toBe("developer")
  })

  it("throws TeamSchemaValidationError{layer:\"config\"} on canonical parse failure", async () => {
    const invalid = { enabled: true, roles: {}, routing: { defaultRole: "senior-dev" } }
    await expect(migrateTeamConfig(invalid)).rejects.toThrow(TeamSchemaValidationError)
    try {
      await migrateTeamConfig(invalid)
    } catch (err) {
      expect(err).toBeInstanceOf(TeamSchemaValidationError)
      expect((err as TeamSchemaValidationError).layer).toBe("config")
    }
  })

  it("throws TeamSchemaValidationError{layer:\"config\"} on legacy migration failure", async () => {
    const bogusLegacy = {
      roles: {
        mystery: {
          displayName: "Mystery",
          provider: "x",
          model: "y",
          effort: "default",
          tier: 2,
        },
      },
      routing: {
        strategy: "hierarchical",
        defaultRole: "mystery",
        escalationEnabled: true,
      },
    }
    await expect(migrateTeamConfig(bogusLegacy)).rejects.toThrow(TeamSchemaValidationError)
  })
})
