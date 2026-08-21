import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { ProjectContext } from "../../src/agent-manager/project/context"
import type { LifecycleHost } from "../../src/agent-manager/provider-lifecycle"
import { discardWorktree } from "../../src/agent-manager/discard-worktree"
import { removePtys } from "../../src/agent-manager/pty-cleanup"

describe("Agent Manager PTY cleanup", () => {
  it("removes every listed PTY even when one removal fails", async () => {
    const removed: string[] = []
    const client = {
      v2: {
        pty: {
          list: async (input: { location: { directory: string } }) => {
            expect(input).toEqual({ location: { directory: "/worktree" } })
            return { data: { data: [{ id: "pty-a" }, { id: "pty-b" }] } }
          },
          remove: async (input: { ptyID: string; location: { directory: string } }) => {
            removed.push(input.ptyID)
            if (input.ptyID === "pty-a") return { error: new Error("offline") }
            return { data: undefined }
          },
        },
      },
    } as unknown as KiloClient

    await expect(removePtys(async () => client, "/worktree")).rejects.toThrow("Failed to remove PTYs")
    expect(removed).toEqual(["pty-a", "pty-b"])
  })

  it("propagates a list failure so callers can isolate it from disk cleanup", async () => {
    const client = {
      v2: { pty: { list: async () => ({ error: new Error("offline") }) } },
    } as unknown as KiloClient

    await expect(removePtys(async () => client, "/worktree")).rejects.toThrow("offline")
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
      client: () => ({ session: { delete: async () => undefined } }) as unknown as KiloClient,
      log: () => undefined,
    } as unknown as LifecycleHost

    await discardWorktree(ctx, host, "wt-1", "/worktree", "branch")
    expect(calls).toEqual(["disk", "state", "push", "release"])
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
        }) as unknown as KiloClient,
      log: () => calls.push("log"),
    } as unknown as LifecycleHost

    await discardWorktree(ctx, host, "wt-1", "/worktree", "branch", "session-1")
    expect(calls).toEqual(["log", "disk", "state", "push", "release"])
  })
})
