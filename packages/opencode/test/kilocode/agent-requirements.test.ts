import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { ConfigAgent } from "@/config/agent"
import { ConfigParse } from "@/config/parse"
import * as AgentRequirements from "@/kilocode/agent-requirements"
import type { MCP } from "@/mcp"
import type { Skill } from "@/skill"

type Agent = {
  name: string
  requirements?: unknown
}

type Input = {
  active?: boolean
  agents?: Record<string, Agent>
  skills?: string[]
  skillError?: string
  mcp?: Record<string, MCP.Status>
  mcpError?: string
}

const dir = "/tmp/agent-requirements"

function services(input: Input = {}) {
  return {
    config: {
      get: () => Effect.succeed({ experimental: input.active ? { agent_requirements: true } : {} }),
    },
    agents: {
      get: (name: string) => Effect.succeed(input.agents?.[name]),
    },
    skills: {
      all: () => {
        if (input.skillError) return Effect.die(new Error(input.skillError))
        const skills = (input.skills ?? []).map(
          (name) => ({ name, location: "test", content: "" }) satisfies Skill.Info,
        )
        return Effect.succeed(skills)
      },
    },
    mcp: {
      status: () => {
        if (input.mcpError) return Effect.die(new Error(input.mcpError))
        return Effect.succeed(input.mcp ?? {})
      },
    },
  }
}

function status(name: string, input: Input) {
  return Effect.runPromise(AgentRequirements.status({ ...services(input), name, directory: dir }))
}

async function client(value: string | undefined, run: () => Promise<void>) {
  const prev = process.env.KILO_CLIENT
  try {
    if (value === undefined) delete process.env.KILO_CLIENT
    if (value !== undefined) process.env.KILO_CLIENT = value
    await run()
  } finally {
    if (prev === undefined) delete process.env.KILO_CLIENT
    if (prev !== undefined) process.env.KILO_CLIENT = prev
  }
}

describe("agent requirements", () => {
  test("returns disabled when the experimental flag is absent", async () => {
    const result = await status("missing", {})

    expect(result).toMatchObject({
      agent: "missing",
      directory: dir,
      enabled: false,
      state: "disabled",
      skills: [],
      mcps: [],
      vscode_extensions: [],
    })
  })

  test("returns ready for agents without requirements", async () => {
    const result = await status("demo", { active: true, agents: { demo: { name: "demo" } } })

    expect(result).toMatchObject({ agent: "demo", directory: dir, enabled: true, state: "ready" })
  })

  test("reports unknown agents while requirements are enabled", async () => {
    const result = await status("missing", { active: true })

    expect(result.state).toBe("error")
    expect(result.error?.code).toBe("unknown_agent")
  })

  test("reports discovered and missing skills", async () => {
    const result = await status("demo", {
      active: true,
      agents: { demo: { name: "demo", requirements: { skills: ["ready", "absent"] } } },
      skills: ["ready"],
    })

    expect(result.state).toBe("blocked")
    expect(result.skills).toEqual([
      { name: "ready", status: "ready" },
      { name: "absent", status: "missing" },
    ])
  })

  test("accepts non-empty marketplace skill and MCP IDs", async () => {
    const result = await status("demo", {
      active: true,
      agents: {
        demo: {
          name: "demo",
          requirements: { skills: ["skill with space"], mcps: ["mcp/with/slash"] },
        },
      },
      skills: ["skill with space"],
      mcp: { "mcp/with/slash": { status: "connected" } },
    })

    expect(result.state).toBe("ready")
    expect(result.skills).toEqual([{ name: "skill with space", status: "ready" }])
    expect(result.mcps).toEqual([{ name: "mcp/with/slash", status: "ready" }])
  })

  test("reports skill discovery failures as errors", async () => {
    const result = await status("demo", {
      active: true,
      agents: { demo: { name: "demo", requirements: { skills: ["needed"] } } },
      skillError: "skill scan failed",
    })

    expect(result.state).toBe("error")
    expect(result.error?.code).toBe("discovery_failed")
    expect(result.skills[0]?.status).toBe("error")
    expect(result.skills[0]?.message).toContain("skill scan failed")
  })

  test("reports malformed and duplicate declarations", async () => {
    const empty = await status("empty", {
      active: true,
      agents: { empty: { name: "empty", requirements: {} } },
    })
    const duplicate = await status("duplicate", {
      active: true,
      agents: { duplicate: { name: "duplicate", requirements: { skills: ["one", "one"] } } },
    })
    const legacy = await status("legacy", {
      active: true,
      agents: { legacy: { name: "legacy", requirements: { vscode_extensions: ["publisher.extension"] } } },
    })

    expect(empty.error?.code).toBe("malformed_declaration")
    expect(duplicate.error?.code).toBe("malformed_declaration")
    expect(legacy.error?.code).toBe("malformed_declaration")
  })

  test("validates VS Code extension objects", async () => {
    const valid = await status("valid", {
      active: true,
      agents: {
        valid: {
          name: "valid",
          requirements: { vscode_extensions: [{ name: "Sample Extension", id: "publisher.extension" }] },
        },
      },
    })
    const invalid = await status("invalid", {
      active: true,
      agents: {
        invalid: {
          name: "invalid",
          requirements: { vscode_extensions: [{ name: "   ", id: "publisher.extension" }] },
        },
      },
    })

    expect(valid).toMatchObject({
      state: "ready",
      vscode_extensions: [{ name: "Sample Extension", id: "publisher.extension" }],
    })
    expect(invalid.state).toBe("error")
    expect(invalid.error?.code).toBe("malformed_declaration")
  })

  test("reports MCP connected, missing, and error states", async () => {
    const result = await status("demo", {
      active: true,
      agents: {
        demo: {
          name: "demo",
          requirements: { mcps: ["connected", "disabled", "failed", "registration"] },
        },
      },
      mcp: {
        connected: { status: "connected" },
        disabled: { status: "disabled" },
        failed: { status: "failed", error: "server crashed" },
        registration: { status: "needs_client_registration", error: "OAuth required" },
      },
    })

    expect(result.state).toBe("blocked")
    expect(result.mcps).toEqual([
      { name: "connected", status: "ready" },
      { name: "disabled", status: "missing" },
      { name: "failed", status: "error", message: "server crashed" },
      { name: "registration", status: "error", message: "OAuth required" },
    ])
  })

  test("reports MCP status service failures", async () => {
    const result = await status("demo", {
      active: true,
      agents: { demo: { name: "demo", requirements: { mcps: ["needed"] } } },
      mcpError: "status unavailable",
    })

    expect(result.state).toBe("error")
    expect(result.error?.code).toBe("mcp_status_failed")
    expect(result.mcps[0]?.status).toBe("error")
    expect(result.mcps[0]?.message).toContain("status unavailable")
  })

  test("guards unmet requirements for all clients", async () => {
    const missing = {
      active: true,
      agents: { demo: { name: "demo", requirements: { skills: ["missing"] } } },
    }

    await client("cli", async () => {
      const exit = await Effect.runPromiseExit(
        AgentRequirements.guard({ ...services(missing), agent: missing.agents.demo, directory: dir }),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isSuccess(exit)) return
      const error = Cause.squash(exit.cause)
      expect(AgentRequirements.BlockedError.isInstance(error)).toBe(true)
    })

    await client("vscode", async () => {
      const exit = await Effect.runPromiseExit(
        AgentRequirements.guard({ ...services(missing), agent: missing.agents.demo, directory: dir }),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isSuccess(exit)) return
      const error = Cause.squash(exit.cause)
      expect(AgentRequirements.BlockedError.isInstance(error)).toBe(true)
    })
  })

  test("blocks VS Code extension requirements outside VS Code", async () => {
    const input = {
      active: true,
      agents: {
        demo: {
          name: "demo",
          requirements: { vscode_extensions: [{ name: "Jupyter", id: "ms-toolsai.jupyter" }] },
        },
      },
    }

    await client("cli", async () => {
      const exit = await Effect.runPromiseExit(
        AgentRequirements.guard({ ...services(input), agent: input.agents.demo, directory: dir }),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isSuccess(exit)) return
      const error = Cause.squash(exit.cause)
      expect(AgentRequirements.BlockedError.isInstance(error)).toBe(true)
    })

    await client("vscode", async () => {
      await Effect.runPromise(AgentRequirements.guard({ ...services(input), agent: input.agents.demo, directory: dir }))
    })
  })

  test("allows non-VS Code clients when requirements are ready", async () => {
    const input = {
      active: true,
      agents: { demo: { name: "demo", requirements: { skills: ["ready"], mcps: ["connected"] } } },
      skills: ["ready"],
      mcp: { connected: { status: "connected" as const } },
    }

    await client("cli", async () => {
      await Effect.runPromise(AgentRequirements.guard({ ...services(input), agent: input.agents.demo, directory: dir }))
    })
  })

  test("keeps requirements out of agent options", () => {
    const agent = ConfigParse.schema(
      ConfigAgent.Info,
      {
        name: "demo",
        requirements: { skills: ["needed"] },
        custom: true,
      },
      "agent/demo.md",
    )

    expect(agent.requirements).toEqual({ skills: ["needed"] })
    expect(agent.options).toEqual({ custom: true })
    expect(agent.options).not.toHaveProperty("requirements")
  })
})
