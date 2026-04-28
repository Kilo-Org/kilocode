import { describe, expect, it } from "bun:test"
import {
  abortSession,
  captureState,
  forkSession,
  registerSession,
  type ContinueContext,
  type StepResult,
} from "../../src/agent-manager/continue-in-worktree"
import type { CreateWorktreeResult } from "../../src/agent-manager/WorktreeManager"
import type { Session } from "@kilocode/sdk/v2/client"

const noop = () => {}
const log = noop as (...args: unknown[]) => void

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

    it("returns forked session on success", async () => {
      const forked = session("forked-1")
      const c = ctx({
        getClient: () =>
          ({
            session: { fork: () => Promise.resolve({ data: forked }) },
          }) as never,
      })
      const res = await forkSession(c, "session-1", "/tmp/wt")
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.value.id).toBe("forked-1")
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
