import { describe, it, expect } from "bun:test"
import { resolveTaskModel, TeamDelegationError, TeamConcurrencyError } from "@/devilcode/team/router"
import type { CanonicalTeamConfig as TeamConfig } from "@/devilcode/team/config"

// These tests pass legacy-keyed role fixtures directly to resolveTaskModel.
// resolveTaskModel accesses roles/routing by property lookup — it does not re-validate the Zod
// schema at runtime, so the type assertion is safe for behavioral testing purposes.
// Canonical schema validation is covered by canonical-config.test.ts.
function asTeamConfig(o: unknown): TeamConfig {
  return o as unknown as TeamConfig
}

describe("team router", () => {
  describe("resolveTaskModel", () => {
    it("returns undefined when team is not enabled", () => {
      const result = resolveTaskModel({
        subagentType: "worker",
        teamConfig: undefined,
        parentRole: undefined,
      })
      expect(result).toBeUndefined()
    })

    it("returns undefined when subagentType has no matching role", () => {
      const teamConfig = asTeamConfig({
        enabled: true,
        roles: {
          senior: {
            displayName: "Senior Developer",
            provider: "openai",
            model: "gpt-4",
            effort: "high",
            tier: 2,
            canDelegate: ["worker"],
            maxConcurrent: 3,
            capabilities: ["code-review", "architecture"],
          },
        },
        routing: {
          strategy: "flat",
          defaultRole: "senior",
          escalationEnabled: true,
        },
      })

      const result = resolveTaskModel({
        subagentType: "nonexistent",
        teamConfig,
        parentRole: undefined,
      })
      expect(result).toBeUndefined()
    })

    it("returns resolved model for valid subagentType", () => {
      const teamConfig = asTeamConfig({
        enabled: true,
        roles: {
          worker: {
            displayName: "Worker",
            provider: "anthropic",
            model: "claude-sonnet",
            effort: "medium",
            tier: 1,
            canDelegate: [],
            maxConcurrent: 5,
            capabilities: ["coding"],
          },
        },
        routing: {
          strategy: "flat",
          defaultRole: "worker",
          escalationEnabled: false,
        },
      })

      const result = resolveTaskModel({
        subagentType: "worker",
        teamConfig,
        parentRole: undefined,
      })

      expect(result).toBeDefined()
      expect(result?.role).toBe("worker")
      expect(result?.model.providerID).toBe("anthropic")
      expect(result?.model.modelID).toBe("claude-sonnet")
      expect(result?.effort).toBe("medium")
    })

    it("enforces hierarchical delegation rules", () => {
      const teamConfig = asTeamConfig({
        enabled: true,
        roles: {
          senior: {
            displayName: "Senior",
            provider: "openai",
            model: "gpt-4",
            effort: "high",
            tier: 2,
            canDelegate: ["worker"],
            maxConcurrent: 3,
            capabilities: [],
          },
          worker: {
            displayName: "Worker",
            provider: "openai",
            model: "gpt-3.5",
            effort: "low",
            tier: 1,
            canDelegate: [],
            maxConcurrent: 5,
            capabilities: [],
          },
        },
        routing: {
          strategy: "hierarchical",
          defaultRole: "senior",
          escalationEnabled: true,
        },
      })

      // Senior can delegate to worker
      const validResult = resolveTaskModel({
        subagentType: "worker",
        teamConfig,
        parentRole: "senior",
      })
      expect(validResult).toBeDefined()

      // Worker cannot delegate to senior
      expect(() =>
        resolveTaskModel({
          subagentType: "senior",
          teamConfig,
          parentRole: "worker",
        }),
      ).toThrow(TeamDelegationError)
    })

    it("skips hierarchy check for flat strategy", () => {
      const teamConfig = asTeamConfig({
        enabled: true,
        roles: {
          senior: {
            displayName: "Senior",
            provider: "openai",
            model: "gpt-4",
            effort: "high",
            tier: 2,
            canDelegate: [],
            maxConcurrent: 3,
            capabilities: [],
          },
          worker: {
            displayName: "Worker",
            provider: "openai",
            model: "gpt-3.5",
            effort: "low",
            tier: 1,
            canDelegate: [],
            maxConcurrent: 5,
            capabilities: [],
          },
        },
        routing: {
          strategy: "flat",
          defaultRole: "worker",
          escalationEnabled: false,
        },
      })

      // Flat strategy allows any delegation regardless of canDelegate
      const result = resolveTaskModel({
        subagentType: "senior",
        teamConfig,
        parentRole: "worker",
      })
      expect(result).toBeDefined()
    })

    // devilcode_change - audit MA1: throw when parentRole missing from roles instead of silently skipping.
    it("throws when parentRole is hierarchical but missing from roles", () => {
      const teamConfig = asTeamConfig({
        enabled: true,
        roles: {
          worker: {
            displayName: "Worker",
            provider: "openai",
            model: "gpt-3.5",
            effort: "low",
            tier: 1,
            canDelegate: [],
            maxConcurrent: 5,
            capabilities: [],
          },
        },
        routing: {
          strategy: "hierarchical",
          defaultRole: "worker",
          escalationEnabled: true,
        },
      })

      expect(() =>
        resolveTaskModel({
          subagentType: "worker",
          teamConfig,
          parentRole: "orchestrator", // not in roles
        }),
      ).toThrow(TeamDelegationError)
    })

    it("skips hierarchy check when no parent role", () => {
      const teamConfig = asTeamConfig({
        enabled: true,
        roles: {
          worker: {
            displayName: "Worker",
            provider: "openai",
            model: "gpt-3.5",
            effort: "low",
            tier: 1,
            canDelegate: [],
            maxConcurrent: 5,
            capabilities: [],
          },
        },
        routing: {
          strategy: "hierarchical",
          defaultRole: "worker",
          escalationEnabled: true,
        },
      })

      // Top-level dispatch (no parent) should work
      const result = resolveTaskModel({
        subagentType: "worker",
        teamConfig,
        parentRole: undefined,
      })
      expect(result).toBeDefined()
    })
  })

  describe("TeamDelegationError", () => {
    it("creates error with correct properties", () => {
      const error = new TeamDelegationError({
        parentRole: "senior",
        targetRole: "architect",
      })

      expect(error.name).toBe("TeamDelegationError")
      expect(error.data.parentRole).toBe("senior")
      expect(error.data.targetRole).toBe("architect")
    })
  })

  describe("TeamConcurrencyError", () => {
    it("creates error with correct properties", () => {
      const error = new TeamConcurrencyError({
        role: "worker",
        maxConcurrent: 5,
      })

      expect(error.name).toBe("TeamConcurrencyError")
      expect(error.data.role).toBe("worker")
      expect(error.data.maxConcurrent).toBe(5)
    })
  })
})
