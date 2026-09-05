import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { ProjectContext } from "../../src/agent-manager/project/context"
import type { LifecycleHost } from "../../src/agent-manager/provider-lifecycle"
import { discardWorktree } from "../../src/agent-manager/discard-worktree"
import { acquirePtyCleanup, removePtys } from "../../src/agent-manager/pty-cleanup"
import type { ScriptTerminalManager } from "../../src/agent-manager/ScriptTerminalManager"
import type { SessionTerminalManager } from "../../src/agent-manager/SessionTerminalManager"
import type { TerminalRouter } from "../../src/agent-manager/terminal-routing"

describe("Agent Manager PTY cleanup", () => {
  it("removes PTYs in batches of four and waits for every removal", async () => {
    const directory = "/worktree"
    const ptys = Array.from({ length: 9 }, (_, i) => ({
      id: `pty-${i}`,
      started: Promise.withResolvers<void>(),
      finish: Promise.withResolvers<void>(),
    }))
    const calls: { ptyID: string; location: { directory: string } }[] = []
    const active = new Set<string>()
    const done: string[] = []
    let peak = 0
    const client = {
      v2: {
        pty: {
          list: async (input: { location: { directory: string } }) => {
            expect(input).toEqual({ location: { directory } })
            return { data: { data: ptys.map((pty) => ({ id: pty.id })) } }
          },
          remove: async (input: { ptyID: string; location: { directory: string } }) => {
            const pty = ptys.find((pty) => pty.id === input.ptyID)!
            calls.push(input)
            active.add(pty.id)
            peak = Math.max(peak, active.size)
            pty.started.resolve()
            await pty.finish.promise
            active.delete(pty.id)
            done.push(pty.id)
            return { data: undefined }
          },
        },
      },
    } as unknown as KiloClient
    const task = removePtys(async (dir) => {
      expect(dir).toBe(directory)
      return client
    }, directory).then(() => {
      expect(done).toHaveLength(ptys.length)
    })

    for (const batch of [ptys.slice(0, 4), ptys.slice(4, 8), ptys.slice(8)]) {
      await Promise.race([Promise.all(batch.map((pty) => pty.started.promise)), task])
      expect([...active]).toEqual(batch.map((pty) => pty.id))
      for (const pty of batch) {
        pty.finish.resolve()
        await pty.finish.promise
      }
    }

    await task
    expect(peak).toBe(4)
    expect(active.size).toBe(0)
    expect(calls).toEqual(ptys.map((pty) => ({ ptyID: pty.id, location: { directory } })))
  })

  it("awaits later batches before aggregating SDK errors and thrown rejections", async () => {
    const ids = ["pty-a", "pty-b", "pty-c", "pty-d", "pty-e"]
    const calls: string[] = []
    const returned = new Error("offline")
    const thrown = new Error("connection lost")
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    let done = false
    const client = {
      v2: {
        pty: {
          list: async () => ({ data: { data: ids.map((id) => ({ id })) } }),
          remove: async (input: { ptyID: string; location: { directory: string } }) => {
            calls.push(input.ptyID)
            if (input.ptyID === "pty-a") return { error: returned }
            if (input.ptyID === "pty-b") throw thrown
            if (input.ptyID === "pty-e") {
              started.resolve()
              await finish.promise
              done = true
            }
            return { data: undefined }
          },
        },
      },
    } as unknown as KiloClient
    const task = removePtys(async () => client, "/worktree").finally(() => {
      expect(done).toBe(true)
    })

    await Promise.race([started.promise, task])
    expect(calls).toEqual(ids)
    finish.resolve()

    const error = await task.catch((err: unknown) => err)
    if (!(error instanceof AggregateError)) throw new Error("Expected AggregateError", { cause: error })
    expect(error.message).toBe("Failed to remove PTYs in /worktree")
    expect(error.errors).toHaveLength(2)
    expect(error.errors).toEqual(expect.arrayContaining([returned, thrown]))
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
})
