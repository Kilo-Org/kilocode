import { describe, expect, it, mock } from "bun:test"
import {
  abortSession,
  forkSession,
  registerSession,
  type ContinueContext,
} from "../src/agent-manager/continue-in-worktree"
import type { CreateWorktreeResult } from "../src/agent-manager/WorktreeManager"

const noop = () => {}
const log = noop as (...args: unknown[]) => void

function session(id: string) {
  return { id } as never
}

function result(path: string): CreateWorktreeResult {
  return { path, branch: "kilo/test" } as CreateWorktreeResult
}

function ctx(overrides: Partial<ContinueContext> = {}): ContinueContext {
  return {
    root: "/tmp/test",
    client: () => {
      throw new Error("no client")
    },
    createWorktreeOnDisk: async () => null,
    runSetupScript: async () => {},
    cleanupWorktree: async () => {},
    notifyError: noop,
    getStateManager: () => undefined,
    registerWorktreeSession: noop,
    notifyReady: noop,
    log,
    ...overrides,
  }
}

describe("continue-in-worktree steps", () => {
  it("aborts through session.interrupt and logs backend failures without throwing", async () => {
    const interrupt = mock(async () => undefined)
    await abortSession(ctx({ client: async () => ({ session: { interrupt } }) as never }), "session-1")
    expect(interrupt).toHaveBeenCalledWith({ sessionID: "session-1" })

    const errors = mock(() => {})
    await abortSession(
      ctx({
        client: async () =>
          ({
            session: { interrupt: () => Promise.reject(new Error("fail")) },
          }) as never,
        log: errors,
      }),
      "session-1",
    )
    expect(errors).toHaveBeenCalledWith("Session abort failed (may already be idle):", "fail")
  })

  it("does not throw when the client is unavailable", async () => {
    await abortSession(ctx(), "session-1")
    const forked = await forkSession(ctx(), "session-1", "/tmp/wt")
    expect(forked.ok).toBe(false)
    if (!forked.ok) expect(forked.error).toBe("Not connected to CLI backend")
  })

  it("forks, moves into the worktree directory, and records the handoff", async () => {
    const fork = mock(async () => session("forked"))
    const move = mock(async () => undefined)
    const synthetic = mock(async () => undefined)
    const forked = await forkSession(
      ctx({
        client: async () => ({ session: { fork, move, synthetic } }) as never,
      }),
      "session-1",
      "/tmp/wt",
    )

    expect(forked.ok).toBe(true)
    expect(fork).toHaveBeenCalledWith({ sessionID: "session-1" })
    expect(move).toHaveBeenCalledWith({ sessionID: "forked", directory: "/tmp/wt" })
    expect(synthetic).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "forked",
        text: expect.stringContaining("/tmp/wt"),
        resume: false,
      }),
    )
  })

  it("returns the fork failure as a step error", async () => {
    const forked = await forkSession(
      ctx({
        client: async () => ({ session: { fork: () => Promise.reject(new Error("fork failed")) } }) as never,
      }),
      "session-1",
      "/tmp/wt",
    )
    expect(forked).toEqual({ ok: false, error: "Failed to fork session: fork failed" })
  })

  it("registers the forked session in state and notifies readiness", () => {
    const addSession = mock(() => undefined)
    const register = mock(() => undefined)
    const ready = mock(() => undefined)
    registerSession(
      ctx({
        getStateManager: () => ({ addSession }) as never,
        registerWorktreeSession: register,
        notifyReady: ready,
      }),
      session("forked"),
      result("/tmp/wt"),
      "wt-1",
      "session-1",
    )
    expect(addSession).toHaveBeenCalledWith("forked", "wt-1")
    expect(register).toHaveBeenCalledWith("forked", "/tmp/wt")
    expect(ready).toHaveBeenCalledWith("forked", expect.objectContaining({ path: "/tmp/wt" }), "wt-1")
  })
})