import { afterEach, describe, expect, it, mock } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import simpleGit from "simple-git"
import {
  abortSession,
  continueInWorktree,
  forkSession,
  registerSession,
  type ContinueContext,
} from "../../src/agent-manager/continue-in-worktree"
import { WorktreeManager, type CreateWorktreeResult } from "../../src/agent-manager/WorktreeManager"
import { forkText } from "../../src/agent-manager/fork-handoff"
import type { Session } from "@kilocode/sdk/v2/client"

const noop = () => {}
const log = noop as (...args: unknown[]) => void
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0, dirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function repo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "continue-worktree-"))
  dirs.push(dir)
  const git = simpleGit(dir)
  await git.init(["--initial-branch=main"])
  await git.addConfig("user.email", "test@test.com")
  await git.addConfig("user.name", "Test")
  await fs.writeFile(path.join(dir, "state.txt"), "base\n")
  await git.add("state.txt")
  await git.commit("initial")
  return dir
}

function client(fork = mock(async () => ({ data: session("forked") }))) {
  return {
    session: {
      abort: mock(async () => ({})),
      fork,
      promptAsync: mock(async () => ({})),
    },
  } as never
}

function session(id: string): Session {
  return {
    id,
    title: "test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Session
}

function result(path: string): CreateWorktreeResult {
  return { path, branch: "kilo/test" } as CreateWorktreeResult
}

/** Build a minimal ContinueContext with overrides. */
function ctx(overrides: Partial<ContinueContext> = {}): ContinueContext {
  return {
    root: "/tmp/test",
    getClient: () => {
      throw new Error("no client")
    },
    createWorktreeOnDisk: async () => null,
    runSetupScript: async () => {},
    cleanupWorktree: async () => {},
    notifyError: noop,
    getStateManager: () => undefined,
    registerWorktreeSession: noop,
    registerSession: noop,
    notifyReady: noop,
    capture: noop,
    log,
    ...overrides,
  }
}

describe("continue-in-worktree steps", () => {
  describe("abortSession", () => {
    it("does not throw when client is unavailable", async () => {
      const c = ctx()
      await abortSession(c, "session-1")
    })

    it("does not throw when abort rejects", async () => {
      const c = ctx({
        getClient: () =>
          ({
            session: { abort: () => Promise.reject(new Error("fail")) },
          }) as never,
      })
      await abortSession(c, "session-1")
    })

    it("calls abort on the client", async () => {
      let called = false
      const c = ctx({
        getClient: () =>
          ({
            session: {
              abort: () => {
                called = true
                return Promise.resolve()
              },
            },
          }) as never,
      })
      await abortSession(c, "session-1")
      expect(called).toBe(true)
    })
  })

  describe("forkSession", () => {
    it("returns error when client is unavailable", async () => {
      const c = ctx()
      const res = await forkSession(c, "session-1", "/tmp/wt")
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toBe("Not connected to CLI backend")
    })

    it("returns error when fork rejects", async () => {
      const c = ctx({
        getClient: () =>
          ({
            session: { fork: () => Promise.reject(new Error("fork failed")) },
          }) as never,
      })
      const res = await forkSession(c, "session-1", "/tmp/wt")
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toContain("fork failed")
    })

    it("records handoff instructions for the forked worktree session", async () => {
      const forked = session("forked-1")
      const promptAsync = mock(async () => ({}))
      const c = ctx({
        getClient: () =>
          ({
            session: { fork: () => Promise.resolve({ data: forked }), promptAsync },
          }) as never,
      })
      const res = await forkSession(c, "session-1", "/tmp/wt")
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.value.id).toBe("forked-1")
      expect(promptAsync).toHaveBeenCalledWith(
        {
          sessionID: "forked-1",
          directory: "/tmp/wt",
          noReply: true,
          parts: [{ type: "text", text: forkText({ directory: "/tmp/wt" }), synthetic: true }],
        },
        { throwOnError: true },
      )
    })
  })

  describe("registerSession", () => {
    it("calls all registration hooks", () => {
      const calls: string[] = []
      const state = { addSession: () => calls.push("addSession") } as never
      const c = ctx({
        getStateManager: () => state,
        registerWorktreeSession: () => calls.push("registerWorktreeSession"),
        registerSession: () => calls.push("registerSession"),
        notifyReady: () => calls.push("notifyReady"),
        capture: () => calls.push("capture"),
      })
      registerSession(c, session("s1"), result("/tmp/wt"), "wt1", "src-session")
      expect(calls).toEqual(["addSession", "registerWorktreeSession", "notifyReady", "registerSession", "capture"])
    })

    it("works without state manager", () => {
      const calls: string[] = []
      const c = ctx({
        getStateManager: () => undefined,
        registerWorktreeSession: () => calls.push("registerWorktreeSession"),
        registerSession: () => calls.push("registerSession"),
        notifyReady: () => calls.push("notifyReady"),
        capture: () => calls.push("capture"),
      })
      registerSession(c, session("s1"), result("/tmp/wt"), "wt1", "src-session")
      expect(calls).toEqual(["registerWorktreeSession", "notifyReady", "registerSession", "capture"])
    })
  })
})

describe("continueInWorktree", () => {
  it("rolls back the created worktree when Git transfer fails", async () => {
    const root = await repo()
    const git = simpleGit(root)
    await fs.writeFile(path.join(root, "state.txt"), "local dirty\n")

    const manager = new WorktreeManager(root, noop)
    const setup = mock(async () => {})
    const cleanup = mock(async () => {
      if (created) await manager.removeWorktree(created.path, created.branch)
    })
    const notify = mock((_error: string, _result: CreateWorktreeResult, _worktreeId: string) => {})
    const progress: Array<{ status: string; error?: string }> = []
    let created: CreateWorktreeResult | undefined
    const c = ctx({
      root,
      getClient: () => client(),
      createWorktreeOnDisk: async (opts) => {
        const value = await manager.createWorktree(opts)
        created = value
        const target = simpleGit(value.path)
        await fs.writeFile(path.join(value.path, "state.txt"), "conflict\n")
        await target.add("state.txt")
        await target.commit("conflict")
        return { worktree: { id: "wt-1" }, result: value }
      },
      runSetupScript: setup,
      cleanupWorktree: cleanup,
      notifyError: notify,
    })

    await continueInWorktree(c, "source", (status, _detail, error) => progress.push({ status, error }))

    expect(progress.at(-1)?.status).toBe("error")
    expect(progress.at(-1)?.error).toContain("Unstaged patch failed")
    expect(setup).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Unstaged patch failed"), created!, "wt-1")
    expect(created).toBeDefined()
    await expect(fs.stat(created!.path)).rejects.toThrow()
    expect((await git.branchLocal()).all).not.toContain(created!.branch)
  })
})
