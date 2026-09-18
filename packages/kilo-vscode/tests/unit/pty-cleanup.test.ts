import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { ProjectContext } from "../../src/agent-manager/project/context"
import type { LifecycleHost } from "../../src/agent-manager/provider-lifecycle"
import { discardWorktree } from "../../src/agent-manager/discard-worktree"
import { acquirePtyCleanup, teardown } from "../../src/agent-manager/pty-cleanup"
import type { ScriptTerminalManager } from "../../src/agent-manager/ScriptTerminalManager"
import type { SessionTerminalManager } from "../../src/agent-manager/SessionTerminalManager"
import type { TerminalRouter } from "../../src/agent-manager/terminal-routing"

describe("Agent Manager PTY cleanup", () => {
  it("tears down worktree PTYs through the project root instance", async () => {
    const calls: unknown[] = []
    const client = {
      kilocode: {
        teardownWorktree: async (input: { directory: string; worktree: string }) => {
          calls.push(input)
          return { data: { disposed: true } }
        },
      },
    } as unknown as KiloClient

    await teardown(
      async (dir) => {
        // A directory-scoped request for the worktree would boot a backend instance for it.
        expect(dir).toBe("/root")
        return client
      },
      "/root",
      "/root/.kilo/worktrees/wt",
    )
    expect(calls).toEqual([{ directory: "/root", worktree: "/root/.kilo/worktrees/wt" }])
  })

  it("propagates a teardown failure so callers can isolate it from disk cleanup", async () => {
    const client = {
      kilocode: { teardownWorktree: async () => ({ error: new Error("offline") }) },
    } as unknown as KiloClient

    await expect(teardown(async () => client, "/root", "/root/.kilo/worktrees/wt")).rejects.toThrow("offline")
  })

  it("closes integrated terminals before removing embedded worktree PTYs", async () => {
    const calls: string[] = []
    const client = {
      kilocode: {
        teardownWorktree: async () => {
          calls.push("teardown")
          return { data: { disposed: false } }
        },
      },
    } as unknown as KiloClient
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
    const integrated = {
      closeDirectory: (dir: string) => calls.push(`integrated:${dir}`),
    } as unknown as SessionTerminalManager

    const release = await acquirePtyCleanup("/worktree", "/root", {
      terminals,
      integrated,
      scripts,
      getClient: async () => client,
    })
    expect(calls).toEqual([
      "block-terminals",
      "block-scripts",
      "integrated:/worktree",
      "close-terminals",
      "close-scripts",
      "teardown",
    ])

    release()
    expect(calls.slice(-2)).toEqual(["release-terminals", "release-scripts"])
  })

  it("blocks worktree deletion when PTY cleanup fails", async () => {
    const calls: string[] = []
    const ctx = {
      peekState: () => ({ removeWorktree: () => calls.push("state") }),
      worktreeManager: () => ({ removeWorktree: async () => calls.push("disk") }),
    } as unknown as ProjectContext
    const host = {
      push: () => calls.push("push"),
      acquirePtyCleanup: async () => {
        calls.push("pty")
        throw new Error("backend offline")
      },
      log: () => calls.push("log"),
    } as unknown as LifecycleHost

    await discardWorktree(ctx, host, "wt-1", "/worktree", "branch")
    expect(calls).toEqual(["pty", "log"])
  })

  it("keeps the cleanup gate until disk deletion completes", async () => {
    const calls: string[] = []
    const release = () => calls.push("release")
    const ctx = {
      peekState: () => ({ removeWorktree: () => calls.push("state") }),
      worktreeManager: () => ({ removeWorktree: async () => calls.push("disk") }),
    } as unknown as ProjectContext
    const host = {
      push: () => calls.push("push"),
      acquirePtyCleanup: async () => release,
      client: () =>
        ({
          session: { delete: async () => undefined },
          kilocode: { removeSnapshot: async () => calls.push("snapshots") },
        }) as unknown as KiloClient,
      log: () => undefined,
    } as unknown as LifecycleHost

    await discardWorktree(ctx, host, "wt-1", "/worktree", "branch")
    expect(calls).toEqual(["disk", "snapshots", "state", "push", "release"])
  })

  it("continues disk cleanup when session deletion fails", async () => {
    const calls: string[] = []
    const ctx = {
      peekState: () => ({ removeWorktree: () => calls.push("state") }),
      worktreeManager: () => ({ removeWorktree: async () => calls.push("disk") }),
    } as unknown as ProjectContext
    const host = {
      push: () => calls.push("push"),
      acquirePtyCleanup: async () => () => calls.push("release"),
      client: () =>
        ({
          session: {
            delete: async () => {
              throw new Error("session offline")
            },
          },
          kilocode: { removeSnapshot: async () => calls.push("snapshots") },
        }) as unknown as KiloClient,
      log: () => calls.push("log"),
    } as unknown as LifecycleHost

    await discardWorktree(ctx, host, "wt-1", "/worktree", "branch", "session-1")
    expect(calls).toEqual(["log", "disk", "snapshots", "state", "push", "release"])
  })
})
