import { describe, expect, test } from "bun:test"
import {
  CanonicalTeamConfig,
  CanonicalTeamRole,
  CanonicalTeamRouting,
  EffortLevel,
} from "@/devilcode/team/config"
import { createWorkflowAgents } from "@/devilcode/team/agents"
import { PermissionNext } from "@/permission/next"

describe("CanonicalTeamRole", () => {
  test("parses a valid role with all fields", () => {
    const input = {
      displayName: "Planner/Orchestrator",
      positionId: "coordinator",
      provider: "anthropic",
      model: "claude-opus-4-6",
      effort: "max",
      tier: 1,
      canDelegate: ["developer", "senior-dev"],
      maxConcurrent: 1,
      capabilities: ["planning"],
    }
    const result = CanonicalTeamRole.parse(input)
    expect(result.displayName).toBe("Planner/Orchestrator")
    expect(result.positionId).toBe("coordinator")
    expect(result.provider).toBe("anthropic")
    expect(result.effort).toBe("max")
    expect(result.tier).toBe(1)
    expect(result.canDelegate).toEqual(["developer", "senior-dev"])
  })

  test("applies defaults for optional fields", () => {
    const input = {
      displayName: "Worker",
      positionId: "developer",
      provider: "fireworks-ai",
      model: "kimi-k2p5-turbo",
      tier: 3,
      capabilities: ["implementation"],
    }
    const result = CanonicalTeamRole.parse(input)
    expect(result.effort).toBe("default")
    expect(result.canDelegate).toEqual([])
    expect(result.maxConcurrent).toBe(3)
    expect(result.supplementaryCapabilities).toEqual([])
  })

  test("rejects tier 0", () => {
    const input = {
      displayName: "Bad",
      positionId: "developer",
      provider: "x",
      model: "y",
      tier: 0,
      capabilities: ["implementation"],
    }
    expect(() => CanonicalTeamRole.parse(input)).toThrow()
  })

  test("rejects negative maxConcurrent", () => {
    const input = {
      displayName: "Bad",
      positionId: "developer",
      provider: "x",
      model: "y",
      tier: 1,
      maxConcurrent: -1,
      capabilities: ["implementation"],
    }
    expect(() => CanonicalTeamRole.parse(input)).toThrow()
  })

  test("rejects empty capabilities array", () => {
    const input = {
      displayName: "Empty",
      positionId: "developer",
      provider: "x",
      model: "y",
      tier: 1,
      capabilities: [],
    }
    expect(() => CanonicalTeamRole.parse(input)).toThrow()
  })
})

describe("CanonicalTeamRouting", () => {
  test("parses valid routing config", () => {
    const result = CanonicalTeamRouting.parse({
      strategy: "hierarchical",
      defaultRole: "developer",
      escalationEnabled: true,
    })
    expect(result.strategy).toBe("hierarchical")
    expect(result.defaultRole).toBe("developer")
  })

  test("applies defaults", () => {
    const result = CanonicalTeamRouting.parse({ defaultRole: "developer" })
    expect(result.strategy).toBe("hierarchical")
    expect(result.escalationEnabled).toBe(true)
  })

  test("rejects invalid strategy", () => {
    expect(() => CanonicalTeamRouting.parse({ strategy: "round-robin", defaultRole: "developer" })).toThrow()
  })

  test("rejects non-canonical defaultRole", () => {
    expect(() => CanonicalTeamRouting.parse({ defaultRole: "worker" })).toThrow()
  })
})

describe("CanonicalTeamConfig", () => {
  const fullConfig = {
    enabled: true,
    roles: {
      coordinator: {
        displayName: "Planner",
        positionId: "coordinator",
        provider: "anthropic",
        model: "claude-opus-4-6",
        effort: "max",
        tier: 1,
        canDelegate: ["senior-dev", "developer"],
        maxConcurrent: 1,
        // covers: planning, design, retrospective
        capabilities: ["planning", "design", "retrospective"],
      },
      "senior-dev": {
        displayName: "Senior Developer",
        positionId: "senior-dev",
        provider: "openai",
        model: "gpt-5.4-codex",
        effort: "xhigh",
        tier: 2,
        canDelegate: ["developer"],
        maxConcurrent: 2,
        // covers: implementation, review, release
        capabilities: ["implementation", "review", "release"],
      },
      developer: {
        displayName: "Developer",
        positionId: "developer",
        provider: "fireworks-ai",
        model: "kimi-k2p5-turbo",
        tier: 3,
        capabilities: ["implementation"],
      },
    },
    routing: {
      strategy: "hierarchical",
      defaultRole: "developer",
      escalationEnabled: true,
    },
  }

  test("parses a full three-tier team config", () => {
    const result = CanonicalTeamConfig.parse(fullConfig)
    expect(result.enabled).toBe(true)
    expect(Object.keys(result.roles)).toEqual(["coordinator", "senior-dev", "developer"])
    expect(result.routing.defaultRole).toBe("developer")
  })

  test("defaults enabled to false", () => {
    const result = CanonicalTeamConfig.parse({
      roles: fullConfig.roles,
      routing: fullConfig.routing,
    })
    expect(result.enabled).toBe(false)
  })

  test("rejects non-canonical role key", () => {
    expect(() =>
      CanonicalTeamConfig.parse({
        enabled: false,
        roles: {
          brain: {
            displayName: "Brain",
            positionId: "coordinator",
            provider: "anthropic",
            model: "claude-opus-4-6",
            tier: 1,
            canDelegate: [],
            capabilities: ["planning"],
          },
        },
        routing: { defaultRole: "coordinator" },
      }),
    ).toThrow("All role keys must be valid CanonicalPosition values")
  })
})

describe("CanonicalTeamConfig cross-field validation", () => {
  test("rejects defaultRole pointing to non-existent role when enabled", () => {
    expect(() =>
      CanonicalTeamConfig.parse({
        enabled: true,
        roles: {
          developer: {
            displayName: "Developer",
            positionId: "developer",
            provider: "fireworks-ai",
            model: "kimi-k2p5-turbo",
            tier: 1,
            capabilities: ["implementation"],
          },
        },
        routing: { defaultRole: "senior-dev" },
      }),
    ).toThrow("routing.defaultRole must reference an existing role")
  })

  test("rejects canDelegate pointing to non-existent role when enabled", () => {
    expect(() =>
      CanonicalTeamConfig.parse({
        enabled: true,
        roles: {
          coordinator: {
            displayName: "Coordinator",
            positionId: "coordinator",
            provider: "anthropic",
            model: "claude-opus-4-6",
            tier: 1,
            canDelegate: ["developer"],
            capabilities: ["planning"],
          },
        },
        routing: { defaultRole: "coordinator" },
      }),
    ).toThrow("canDelegate entries must reference existing roles")
  })

  test("allows invalid references when enabled is false", () => {
    const result = CanonicalTeamConfig.parse({
      enabled: false,
      roles: {
        developer: {
          displayName: "Developer",
          positionId: "developer",
          provider: "fireworks-ai",
          model: "kimi-k2p5-turbo",
          tier: 1,
          canDelegate: [],
          capabilities: ["implementation"],
        },
      },
      routing: { defaultRole: "developer" },
    })
    expect(result.enabled).toBe(false)
    expect(result.routing.defaultRole).toBe("developer")
  })
})

describe("EffortLevel", () => {
  test("accepts all valid effort levels", () => {
    for (const level of ["max", "xhigh", "high", "medium", "low", "default"] as const) {
      expect(EffortLevel.parse(level)).toBe(level)
    }
  })

  test("rejects invalid effort level", () => {
    expect(() => EffortLevel.parse("ultra")).toThrow()
  })
})

describe("createWorkflowAgents", () => {
  test("inherits merged permissions and team effort options", () => {
    const team = CanonicalTeamConfig.parse({
      enabled: true,
      roles: {
        "senior-dev": {
          displayName: "Senior Developer",
          positionId: "senior-dev",
          provider: "openai",
          model: "gpt-5.4-codex",
          effort: "xhigh",
          tier: 2,
          // covers all 7 required stages to pass superRefine
          capabilities: ["planning", "design", "implementation", "review", "release", "testing", "retrospective"],
        },
      },
      routing: { defaultRole: "senior-dev" },
    })
    const permission = PermissionNext.merge(
      PermissionNext.fromConfig({ "*": "allow" }),
      PermissionNext.fromConfig({ bash: "deny" }),
    )

    const agents = createWorkflowAgents(team, permission)

    expect(agents?.["senior-dev"].permission).toEqual(permission)
    expect(agents?.["senior-dev"].options.teamRole).toBe("senior-dev")
    expect(agents?.["senior-dev"].options.reasoning).toEqual({ enabled: true, effort: "high" })
    expect(agents?.["senior-dev"].options.verbosity).toBe("high")
  })
})
