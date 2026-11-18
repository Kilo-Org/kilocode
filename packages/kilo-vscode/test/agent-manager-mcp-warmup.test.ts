import { describe, expect, it, mock } from "bun:test"
import { prepareDirectory, startSession } from "../src/agent-manager/mcp-warmup"
import { createSessionInWorktree } from "../src/agent-manager/provider-session"

function tick(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve))
}

describe("Agent Manager MCP warmup", () => {
  for (const pending of ["config", "agent"] as const) {
    it(`waits for ${pending} and lists MCP once when preparing the directory`, async () => {
      const gate = Promise.withResolvers<void>()
      const client = {
        config: { get: mock(() => (pending === "config" ? gate.promise : Promise.resolve())) },
        agent: { list: mock(() => (pending === "agent" ? gate.promise : Promise.resolve())) },
        mcp: { list: mock(async () => {}) },
      }
      const dir = "/repo/.kilo/worktrees/feature"
      const prepared = prepareDirectory(client as never, dir, () => {})
      expect(
        await Promise.race([
          prepared.then(() => "ready"),
          tick()
            .then(tick)
            .then(() => "waiting"),
        ]),
      ).toBe("waiting")
      gate.resolve()
      await prepared
      for (const read of [client.config.get, client.agent.list, client.mcp.list]) {
        expect(read).toHaveBeenCalledTimes(1)
        expect(read).toHaveBeenCalledWith({ location: { directory: dir } })
      }
    })
  }

  it("creates the session while MCP is pending and only logs a later warmup failure", async () => {
    const gate = Promise.withResolvers<void>()
    const session = { id: "created" }
    const client = {
      config: { get: async () => ({}) },
      agent: { list: async () => [] },
      mcp: { list: mock(() => gate.promise) },
      session: { create: async () => session },
    }
    const logged = Promise.withResolvers<unknown>()
    const host = {
      connection: { client: async () => client } as never,
      postToWebview: mock(() => {}),
      log: (message: unknown, error?: unknown) => {
        if (error) logged.resolve(error)
      },
    }
    expect((await createSessionInWorktree(host, "/repo/feature", "feature"))?.id).toBe(session.id)
    const error = new Error("MCP unavailable")
    gate.reject(error)
    expect(await logged.promise).toBe(error)
    expect(client.mcp.list).toHaveBeenCalledTimes(1)
    expect(host.postToWebview).toHaveBeenCalledTimes(1)
    expect(host.postToWebview).toHaveBeenCalledWith(expect.objectContaining({ status: "starting" }))
  })

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
