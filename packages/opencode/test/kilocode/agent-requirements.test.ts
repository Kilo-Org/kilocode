import { afterEach, describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Schema } from "effect"
import { ConfigAgent } from "../../src/config/agent"
import { BlockedError, evaluate, guard, Requirements } from "../../src/kilocode/agent-requirements"
import type { Agent } from "../../src/agent/agent"
import type { Config } from "../../src/config/config"

function agent(requirements?: Agent.Info["requirements"]): Agent.Info {
  return {
    name: "code",
    mode: "primary",
    permission: [],
    options: {},
    requirements,
  }
}

const declaration = {
  skills: ["vscode-self-test", "release-notes"],
  vscode_extensions: [{ name: "Jupyter", id: "ms-toolsai.jupyter" }],
}

const client = process.env.KILO_CLIENT

afterEach(() => {
  if (client === undefined) delete process.env.KILO_CLIENT
  if (client !== undefined) process.env.KILO_CLIENT = client
})

function services(skills: string[] = []) {
  return {
    config: {
      get: () => Effect.succeed({ experimental: { agent_requirements: true } } as Config.Info),
    },
    agents: { get: () => Effect.succeed(agent(declaration)) },
    skills: {
      all: () =>
        Effect.succeed(skills.map((name) => ({ name, description: name, location: `/skills/${name}`, content: name }))),
    },
  }
}

describe("agent skill requirements", () => {
  test("disabled experiment ignores declarations", () => {
    const result = evaluate({ agent: agent(declaration), directory: "/worktree-a", enabled: false })
    expect(result).toEqual({
      agent: "code",
      directory: "/worktree-a",
      enabled: false,
      state: "disabled",
      skills: [],
      vscode_extensions: [],
      mcps: [],
    })
  })

  test("agents without declarations are ready", () => {
    const result = evaluate({ agent: agent(), directory: "/worktree-a", enabled: true })
    expect(result.state).toBe("ready")
    expect(result.skills).toEqual([])
  })

  test("uses the directory-scoped discovery inventory", () => {
    const first = evaluate({
      agent: agent(declaration),
      directory: "/worktree-a",
      enabled: true,
      discovered: new Set(["vscode-self-test", "release-notes"]),
    })
    const second = evaluate({
      agent: agent(declaration),
      directory: "/worktree-b",
      enabled: true,
      discovered: new Set(["release-notes"]),
    })

    expect(first.state).toBe("ready")
    expect(second.state).toBe("blocked")
    expect(second.skills).toEqual([
      { name: "vscode-self-test", marketplace: "vscode-self-test", status: "missing" },
      { name: "release-notes", marketplace: "release-notes", status: "ready" },
    ])
    expect(second.vscode_extensions).toEqual([{ name: "Jupyter", id: "ms-toolsai.jupyter" }])
  })

  test("fails closed when skill discovery fails", () => {
    const result = evaluate({
      agent: agent(declaration),
      directory: "/worktree-a",
      enabled: true,
      discoveryError: "skill scan failed",
    })

    expect(result.state).toBe("error")
    expect(result.error?.code).toBe("discovery_failed")
    expect(result.skills.every((skill) => skill.status === "error")).toBe(true)
  })

  test("rejects duplicate requirement IDs", () => {
    const decoded = Schema.decodeUnknownExit(Requirements)({
      skills: ["same", "same"],
    })
    expect(decoded._tag).toBe("Failure")
  })

  test("accepts VS Code extension requirements without skill enforcement", () => {
    const result = evaluate({
      agent: agent({ vscode_extensions: [{ name: "Jupyter", id: "ms-toolsai.jupyter" }] }),
      directory: "/worktree-a",
      enabled: true,
    })

    expect(result.state).toBe("ready")
    expect(result.skills).toEqual([])
    expect(result.vscode_extensions).toEqual([{ name: "Jupyter", id: "ms-toolsai.jupyter" }])
  })

  test("reports malformed runtime declarations as errors", () => {
    const result = evaluate({
      agent: agent({ skills: [] } as Agent.Info["requirements"]),
      directory: "/worktree-a",
      enabled: true,
    })
    expect(result.state).toBe("error")
    expect(result.error?.code).toBe("malformed_declaration")
  })

  test("does not enforce the guard outside VS Code", () => {
    process.env.KILO_CLIENT = "cli"
    const exit = Effect.runSyncExit(guard({ ...services(), agent: agent(declaration), directory: "/worktree-a" }))
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("fails with a typed error for blocked VS Code agents", () => {
    process.env.KILO_CLIENT = "vscode"
    const exit = Effect.runSyncExit(guard({ ...services(), agent: agent(declaration), directory: "/worktree-a" }))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isSuccess(exit)) return
    const error = Cause.squash(exit.cause)
    expect(error).toBeInstanceOf(BlockedError)
    expect((error as InstanceType<typeof BlockedError>).data.state).toBe("blocked")
  })

  test("allows ready VS Code agents", () => {
    process.env.KILO_CLIENT = "vscode"
    const exit = Effect.runSyncExit(
      guard({
        ...services(["vscode-self-test", "release-notes"]),
        agent: agent(declaration),
        directory: "/worktree-a",
      }),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("keeps requirements separate from provider options", () => {
    const parsed = Schema.decodeUnknownSync(ConfigAgent.Info)({
      requirements: declaration,
      reasoningEffort: "high",
    })

    expect(parsed.requirements).toEqual(declaration)
    expect(parsed.options?.reasoningEffort).toBe("high")
    expect(parsed.options?.requirements).toBeUndefined()
  })
})
