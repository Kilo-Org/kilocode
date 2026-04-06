import { describe, expect, test } from "bun:test"
import { resolveTaskModel, TeamDelegationError } from "@/devilcode/team/router"
import type { TeamConfig } from "@/devilcode/team/config"

const teamConfig: TeamConfig = {
  enabled: true,
  roles: {
    orchestrator: {
      displayName: "Orchestrator",
      provider: "anthropic",
      model: "claude-opus-4-6",
      effort: "max",
      tier: 1,
      canDelegate: ["senior", "worker"],
      maxConcurrent: 1,
      capabilities: [],
    },
    senior: {
      displayName: "Senior",
      provider: "openai",
      model: "gpt-5.4-codex",
      effort: "xhigh",
      tier: 2,
      canDelegate: ["worker"],
      maxConcurrent: 2,
      capabilities: [],
    },
    worker: {
      displayName: "Worker",
      provider: "fireworks-ai",
      model: "kimi-k2p5-turbo",
      effort: "default",
      tier: 3,
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
}

describe("resolveTaskModel", () => {
  test("resolves worker role to fireworks model", () => {
    const result = resolveTaskModel({
      subagentType: "worker",
      teamConfig,
      parentRole: "orchestrator",
    })
    expect(result).toEqual({
      model: { providerID: "fireworks-ai", modelID: "kimi-k2p5-turbo" },
      effort: "default",
      role: "worker",
    })
  })

  test("resolves senior role to openai model", () => {
    const result = resolveTaskModel({
      subagentType: "senior",
      teamConfig,
      parentRole: "orchestrator",
    })
    expect(result).toEqual({
      model: { providerID: "openai", modelID: "gpt-5.4-codex" },
      effort: "xhigh",
      role: "senior",
    })
  })

  test("returns undefined when team is disabled", () => {
    const result = resolveTaskModel({
      subagentType: "worker",
      teamConfig: { ...teamConfig, enabled: false },
      parentRole: "orchestrator",
    })
    expect(result).toBeUndefined()
  })

  test("returns undefined for unknown role (falls back to existing behavior)", () => {
    const result = resolveTaskModel({
      subagentType: "explore",
      teamConfig,
      parentRole: "orchestrator",
    })
    expect(result).toBeUndefined()
  })

  test("throws when parent cannot delegate to target role", () => {
    expect(() =>
      resolveTaskModel({
        subagentType: "senior",
        teamConfig,
        parentRole: "worker",
      }),
    ).toThrow(TeamDelegationError)
  })

  test("throws when worker tries to delegate", () => {
    expect(() =>
      resolveTaskModel({
        subagentType: "worker",
        teamConfig,
        parentRole: "worker",
      }),
    ).toThrow(TeamDelegationError)
  })

  test("allows orchestrator to delegate to worker (skipping senior)", () => {
    const result = resolveTaskModel({
      subagentType: "worker",
      teamConfig,
      parentRole: "orchestrator",
    })
    expect(result?.role).toBe("worker")
  })

  test("allows senior to delegate to worker", () => {
    const result = resolveTaskModel({
      subagentType: "worker",
      teamConfig,
      parentRole: "senior",
    })
    expect(result?.role).toBe("worker")
  })

  test("allows delegation when parentRole is undefined (top-level dispatch)", () => {
    const result = resolveTaskModel({
      subagentType: "senior",
      teamConfig,
      parentRole: undefined,
    })
    expect(result?.role).toBe("senior")
  })

  test("uses flat strategy to skip hierarchy check", () => {
    const flatConfig: TeamConfig = {
      ...teamConfig,
      routing: { ...teamConfig.routing, strategy: "flat" },
    }
    const result = resolveTaskModel({
      subagentType: "senior",
      teamConfig: flatConfig,
      parentRole: "worker",
    })
    expect(result?.role).toBe("senior")
  })
})
