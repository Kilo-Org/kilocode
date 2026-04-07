import { describe, expect, test } from "bun:test"
import { TeamConfig, TeamRole, TeamRouting, EffortLevel } from "@/devilcode/team/config"
import { createWorkflowAgents } from "@/devilcode/team/agents"
import { PermissionNext } from "@/permission/next"

describe("TeamRole", () => {
  test("parses a valid role with all fields", () => {
    const input = {
      displayName: "Planner/Orchestrator",
      provider: "anthropic",
      model: "claude-opus-4-6",
      effort: "max",
      tier: 1,
      canDelegate: ["senior", "worker"],
      maxConcurrent: 1,
      capabilities: ["planning", "decomposition"],
    }
    const result = TeamRole.parse(input)
    expect(result.displayName).toBe("Planner/Orchestrator")
    expect(result.provider).toBe("anthropic")
    expect(result.effort).toBe("max")
    expect(result.tier).toBe(1)
    expect(result.canDelegate).toEqual(["senior", "worker"])
  })

  test("applies defaults for optional fields", () => {
    const input = {
      displayName: "Worker",
      provider: "fireworks-ai",
      model: "kimi-k2p5-turbo",
      tier: 3,
    }
    const result = TeamRole.parse(input)
    expect(result.effort).toBe("default")
    expect(result.canDelegate).toEqual([])
    expect(result.maxConcurrent).toBe(3)
    expect(result.capabilities).toEqual([])
  })

  test("rejects tier 0", () => {
    const input = {
      displayName: "Bad",
      provider: "x",
      model: "y",
      tier: 0,
    }
    expect(() => TeamRole.parse(input)).toThrow()
  })

  test("rejects negative maxConcurrent", () => {
    const input = {
      displayName: "Bad",
      provider: "x",
      model: "y",
      tier: 1,
      maxConcurrent: -1,
    }
    expect(() => TeamRole.parse(input)).toThrow()
  })
})

describe("TeamRouting", () => {
  test("parses valid routing config", () => {
    const result = TeamRouting.parse({
      strategy: "hierarchical",
      defaultRole: "worker",
      escalationEnabled: true,
    })
    expect(result.strategy).toBe("hierarchical")
    expect(result.defaultRole).toBe("worker")
  })

  test("applies defaults", () => {
    const result = TeamRouting.parse({ defaultRole: "worker" })
    expect(result.strategy).toBe("hierarchical")
    expect(result.escalationEnabled).toBe(true)
  })

  test("rejects invalid strategy", () => {
    expect(() => TeamRouting.parse({ strategy: "round-robin", defaultRole: "x" })).toThrow()
  })
})

describe("TeamConfig", () => {
  const fullConfig = {
    enabled: true,
    roles: {
      orchestrator: {
        displayName: "Planner",
        provider: "anthropic",
        model: "claude-opus-4-6",
        effort: "max",
        tier: 1,
        canDelegate: ["senior", "worker"],
        maxConcurrent: 1,
        capabilities: ["planning"],
      },
      senior: {
        displayName: "Senior",
        provider: "openai",
        model: "gpt-5.4-codex",
        effort: "xhigh",
        tier: 2,
        canDelegate: ["worker"],
        maxConcurrent: 2,
        capabilities: ["debugging"],
      },
      worker: {
        displayName: "Worker",
        provider: "fireworks-ai",
        model: "kimi-k2p5-turbo",
        tier: 3,
      },
    },
    routing: {
      strategy: "hierarchical",
      defaultRole: "worker",
      escalationEnabled: true,
    },
  }

  test("parses a full three-tier team config", () => {
    const result = TeamConfig.parse(fullConfig)
    expect(result.enabled).toBe(true)
    expect(Object.keys(result.roles)).toEqual(["orchestrator", "senior", "worker"])
    expect(result.routing.defaultRole).toBe("worker")
  })

  test("defaults enabled to false", () => {
    const result = TeamConfig.parse({
      roles: fullConfig.roles,
      routing: fullConfig.routing,
    })
    expect(result.enabled).toBe(false)
  })

  test("allows custom role names", () => {
    const result = TeamConfig.parse({
      enabled: true,
      roles: {
        brain: {
          displayName: "Brain",
          provider: "anthropic",
          model: "claude-opus-4-6",
          tier: 1,
          canDelegate: ["hands"],
        },
        hands: {
          displayName: "Hands",
          provider: "fireworks-ai",
          model: "kimi-k2p5-turbo",
          tier: 2,
        },
      },
      routing: { defaultRole: "hands" },
    })
    expect(Object.keys(result.roles)).toEqual(["brain", "hands"])
  })
})

describe("TeamConfig cross-field validation", () => {
  test("rejects defaultRole pointing to non-existent role when enabled", () => {
    expect(() =>
      TeamConfig.parse({
        enabled: true,
        roles: {
          worker: {
            displayName: "Worker",
            provider: "fireworks-ai",
            model: "kimi-k2p5-turbo",
            tier: 1,
          },
        },
        routing: { defaultRole: "nonexistent" },
      })
    ).toThrow("routing.defaultRole must reference an existing role")
  })

  test("rejects canDelegate pointing to non-existent role when enabled", () => {
    expect(() =>
      TeamConfig.parse({
        enabled: true,
        roles: {
          orchestrator: {
            displayName: "Orchestrator",
            provider: "anthropic",
            model: "claude-opus-4-6",
            tier: 1,
            canDelegate: ["ghost"],
          },
        },
        routing: { defaultRole: "orchestrator" },
      })
    ).toThrow("canDelegate entries must reference existing roles")
  })

  test("allows invalid references when enabled is false", () => {
    const result = TeamConfig.parse({
      enabled: false,
      roles: {
        worker: {
          displayName: "Worker",
          provider: "fireworks-ai",
          model: "kimi-k2p5-turbo",
          tier: 1,
          canDelegate: ["ghost"],
        },
      },
      routing: { defaultRole: "nonexistent" },
    })
    expect(result.enabled).toBe(false)
    expect(result.routing.defaultRole).toBe("nonexistent")
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
    const team = TeamConfig.parse({
      enabled: true,
      roles: {
        senior: {
          displayName: "Senior",
          provider: "openai",
          model: "gpt-5.4-codex",
          effort: "xhigh",
          tier: 2,
        },
      },
      routing: { defaultRole: "senior" },
    })
    const permission = PermissionNext.merge(
      PermissionNext.fromConfig({ "*": "allow" }),
      PermissionNext.fromConfig({ bash: "deny" }),
    )

    const agents = createWorkflowAgents(team, permission)

    expect(agents?.senior.permission).toEqual(permission)
    expect(agents?.senior.options.teamRole).toBe("senior")
    expect(agents?.senior.options.reasoning).toEqual({ enabled: true, effort: "high" })
    expect(agents?.senior.options.verbosity).toBe("high")
  })
})
