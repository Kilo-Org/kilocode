import { describe, expect, it } from "bun:test"
import type { AgentManagerConnection } from "../src/agent-manager/connection"
import type { OpenCodeClient } from "@opencode/client"
import { acquirePtyCleanup, teardown } from "../src/agent-manager/pty-cleanup"
import type { ScriptTerminalManager } from "../src/agent-manager/ScriptTerminalManager"
import type { TerminalRouter } from "../src/agent-manager/terminal-routing"

function connection(client: unknown): AgentManagerConnection {
  return {
    client: async () => client as unknown as OpenCodeClient,
    current: () => client as unknown as OpenCodeClient,
    state: () => "connected",
    onState: () => () => undefined,
    onEvent: () => () => undefined,
    server: () => ({ url: "http://127.0.0.1:4096", authorization: "Basic test" }),
    view: () => undefined,
  } as unknown as AgentManagerConnection
}

describe("Agent Manager PTY cleanup", () => {
  it("evicts the worktree's server services", async () => {
    const calls: unknown[] = []
    const client = {
      debug: {
        location: {
          evict: async (input: { location: { directory: string } }) => {
            calls.push(input)
          },
        },
      },
    }

    await teardown(connection(client), "/root/.kilo/worktrees/wt")
    expect(calls).toEqual([{ location: { directory: "/root/.kilo/worktrees/wt" } }])
  })

  it("propagates a teardown failure so callers can isolate it from disk cleanup", async () => {
    const client = {
      debug: {
        location: {
          evict: async () => {
            throw new Error("offline")
          },
        },
      },
    }

    await expect(teardown(connection(client), "/root/.kilo/worktrees/wt")).rejects.toThrow("offline")
  })

  it("closes worktree terminals before removing embedded worktree PTYs", async () => {
    const calls: string[] = []
    const client = {
      debug: {
        location: {
          evict: async () => {
            calls.push("teardown")
          },
        },
      },
    }
    const terminals = {
      blockDirectory: async () => {
        calls.push("block-terminals")
        return () => calls.push("release-terminals")
      },
      closeDirectory: async () => calls.push("close-terminals"),
    } as unknown as TerminalRouter
    const scripts = {
      blockDirectory: async () => {
        calls.push("block-scripts")
        return () => calls.push("release-scripts")
      },
      closeDirectory: async () => calls.push("close-scripts"),
    } as unknown as ScriptTerminalManager
    const release = await acquirePtyCleanup("/worktree", {
      terminals,
      scripts,
      connection: connection(client),
    })
    expect(calls).toEqual([
      "block-terminals",
      "block-scripts",
      "close-terminals",
      "close-scripts",
      "teardown",
    ])

    release()
    expect(calls.slice(-2)).toEqual(["release-terminals", "release-scripts"])
  })
})