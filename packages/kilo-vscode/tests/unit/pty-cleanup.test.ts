import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { ProjectContext } from "../../src/agent-manager/project/context"
import { deleteLifecycleWorktree, type LifecycleHost } from "../../src/agent-manager/provider-lifecycle"
import { discardWorktree } from "../../src/agent-manager/discard-worktree"
import { acquirePtyCleanup, removePtys } from "../../src/agent-manager/pty-cleanup"
import type { ScriptTerminalManager } from "../../src/agent-manager/ScriptTerminalManager"
import type { SessionTerminalManager } from "../../src/agent-manager/SessionTerminalManager"
import type { TerminalRouter } from "../../src/agent-manager/terminal-routing"

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

  it("closes integrated terminals before removing embedded worktree PTYs", async () => {
    const calls: string[] = []
    const client = {
      v2: {
        pty: {
          list: async () => {
            calls.push("list")
            return { data: { data: [] } }
          },
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

    const release = await acquirePtyCleanup({
      directory: "/worktree",
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
      "list",
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

  it("stops worktree sessions and disposes backend resources before deleting disk state", async () => {
    const calls: string[] = []
    const sessions = [{ id: "session-a" }, { id: "session-b" }]
    const state = {
      getWorktree: () => ({ path: "/worktree", branch: "branch" }),
      getSessions: () => sessions,
      removeWorktree: () => {
        calls.push("state")
        return sessions
      },
    }
    const ctx = {
      peekState: () => state,
      worktreeManager: () => ({ removeWorktree: async () => calls.push("disk") }),
    } as unknown as ProjectContext
    const client = {
      backgroundProcess: {
        stopSession: async (input: { sessionID: string; directory: string }) => {
          expect(input.directory).toBe("/worktree")
          calls.push(`process:${input.sessionID}`)
        },
      },
      instance: {
        dispose: async (input: { directory: string }) => {
          expect(input.directory).toBe("/worktree")
          calls.push("instance")
        },
      },
    } as unknown as KiloClient
    const host = {
      sessions: {
        abort: async (ids: string[]) => calls.push(`abort:${ids.join(",")}`),
        clearDirectory: (id: string) => calls.push(`clear:${id}`),
      },
      skipStats: () => calls.push("skip"),
      stopDiffs: () => calls.push("diffs"),
      removeRun: async () => calls.push("run"),
      clearRun: async () => {
        calls.push("scripts")
        return true
      },
      acquirePtyCleanup: async () => {
        calls.push("pty")
        return () => calls.push("release")
      },
      client: () => client,
      removePR: () => calls.push("pr"),
      forgetName: () => calls.push("name"),
      push: () => calls.push("push"),
      log: () => undefined,
    } as unknown as LifecycleHost

    await deleteLifecycleWorktree(ctx, host, "wt-1")

    expect(calls).toEqual([
      "skip",
      "diffs",
      "run",
      "scripts",
      "abort:session-a,session-b",
      "process:session-a",
      "process:session-b",
      "pty",
      "instance",
      "disk",
      "state",
      "pr",
      "name",
      "clear:session-a",
      "clear:session-b",
      "push",
      "release",
    ])
  })

  it("preserves worktree state and reports a directory that remains locked", async () => {
    const calls: string[] = []
    const messages: unknown[] = []
    const state = {
      getWorktree: () => ({ path: "/worktree", branch: "branch" }),
      getSessions: () => [],
      removeWorktree: () => calls.push("state"),
    }
    const ctx = {
      peekState: () => state,
      worktreeManager: () => ({
        removeWorktree: async () => {
          calls.push("disk")
          throw new Error("directory busy")
        },
      }),
    } as unknown as ProjectContext
    const host = {
      skipStats: () => calls.push("skip"),
      unskipStats: () => calls.push("unskip"),
      stopDiffs: () => calls.push("diffs"),
      removeRun: async () => undefined,
      clearRun: async () => true,
      acquirePtyCleanup: async () => () => calls.push("release"),
      client: () => ({ instance: { dispose: async () => calls.push("instance") } }) as unknown as KiloClient,
      post: (message: unknown) => messages.push(message),
      log: () => undefined,
    } as unknown as LifecycleHost

    await deleteLifecycleWorktree(ctx, host, "wt-1")

    expect(calls).toEqual(["skip", "diffs", "instance", "disk", "unskip", "release"])
    expect(messages).toEqual([
      {
        type: "agentManager.worktreeSetup",
        status: "error",
        message: "Failed to delete worktree: directory busy",
        worktreeId: "wt-1",
      },
    ])
  })
})
