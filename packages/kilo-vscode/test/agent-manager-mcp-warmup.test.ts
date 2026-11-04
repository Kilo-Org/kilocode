import { describe, expect, it } from "bun:test"
import { startSession } from "../src/agent-manager/mcp-warmup"

function tick(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve))
}

describe("Agent Manager MCP warmup", () => {
  it("starts MCP status for the worktree directory before session creation", async () => {
    const calls: unknown[][] = []
    const client = {
      mcp: {
        list: (input: unknown) => {
          calls.push(["warm", input])
          return Promise.resolve({ data: {} })
        },
      },
    }

    const result = await startSession(
      client as never,
      "/repo/.kilo/worktrees/feature",
      async () => {
        calls.push(["session"])
        return "created"
      },
      () => {},
    )

    expect(result).toBe("created")
    expect(calls[0]).toEqual(["warm", { location: { directory: "/repo/.kilo/worktrees/feature" } }])
    expect(calls[1]).toEqual(["session"])
  })

  it("does not wait for MCP warmup before creating the session", async () => {
    const calls: string[] = []
    const warmup = new Promise<unknown>(() => {})
    const client = {
      mcp: {
        list: () => {
          calls.push("warm")
          return warmup
        },
      },
    }

    const result = await startSession(
      client as never,
      "/repo/.kilo/worktrees/feature",
      async () => {
        calls.push("session")
        return "created"
      },
      () => {},
    )

    expect(result).toBe("created")
    expect(calls).toEqual(["warm", "session"])
  })

  it("logs and contains MCP warmup failures", async () => {
    const logs: unknown[][] = []
    const client = {
      mcp: {
        list: () => {
          throw new Error("connection failed")
        },
      },
    }

    const result = await startSession(
      client as never,
      "/repo/.kilo/worktrees/feature",
      async () => "created",
      (...args) => logs.push(args),
    )
    await tick()

    expect(result).toBe("created")
    expect(logs[0]).toEqual(["[MCPWarmup] Starting for /repo/.kilo/worktrees/feature"])
    expect(logs[1]?.[0]).toBe("[MCPWarmup] Failed for /repo/.kilo/worktrees/feature:")
    expect(logs[1]?.[1]).toBeInstanceOf(Error)
  })
})