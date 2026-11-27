import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { abortSession, SessionAbort } from "../../src/kilo-provider/abort"

function client(calls: unknown[], fail = false) {
  return {
    session: {
      abort: async (params: unknown, opts: unknown) => {
        calls.push({ type: "abort", params, opts })
        if (fail) throw new Error("abort failed")
        return { data: true }
      },
    },
  } as unknown as KiloClient
}

describe("SessionAbort", () => {
  it.each([undefined, "session", "tree"] as const)(
    "stops the active owner and current mapped directory with %s scope",
    async (scope) => {
      const calls: unknown[] = []
      const aborts = new SessionAbort()
      aborts.observe("session_1", "busy", "/repo")

      expect(await aborts.stop(client(calls), "session_1", "/repo/worktree", undefined, scope)).toBe(true)
      expect(calls).toEqual([
        {
          type: "abort",
          params: { sessionID: "session_1", directory: "/repo", scope },
          opts: { throwOnError: true },
        },
        {
          type: "abort",
          params: { sessionID: "session_1", directory: "/repo/worktree", scope },
          opts: { throwOnError: true },
        },
      ])
    },
  )

  it("forgets an owner when its instance becomes idle", async () => {
    const calls: unknown[] = []
    const aborts = new SessionAbort()
    aborts.observe("session_1", "busy", "/repo")
    aborts.observe("session_1", "idle", "/repo")

    expect(await aborts.stop(client(calls), "session_1", "/repo/worktree")).toBe(false)
    expect(calls).toEqual([
      {
        type: "abort",
        params: { sessionID: "session_1", directory: "/repo/worktree" },
        opts: { throwOnError: true },
      },
    ])
  })

  it("deduplicates equivalent directory paths", async () => {
    const calls: unknown[] = []
    const aborts = new SessionAbort()
    aborts.observe("session_1", "busy", "/repo/worktree")

    expect(await aborts.stop(client(calls), "session_1", "/repo/worktree/.")).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it("tracks active sessions across dispose and disposeAll", () => {
    const aborts = new SessionAbort()
    aborts.observe("s1", "busy", "/repo/wt1")
    aborts.observe("s2", "busy", "/repo/wt1")
    aborts.observe("s2", "busy", "/repo/wt2")
    aborts.observe("s3", "busy", "/repo/wt2")

    expect(aborts.has("s1")).toBe(true)
    expect(aborts.dispose("/repo/wt1")).toEqual(["s1"])
    expect(aborts.has("s1")).toBe(false)
    expect(aborts.has("s2")).toBe(true)

    expect(aborts.disposeAll()).toEqual(["s2", "s3"])
    expect(aborts.has("s2")).toBe(false)
    expect(aborts.has("s3")).toBe(false)
  })
})

describe("abortSession", () => {
  it("calls session.abort with the session id and directory", async () => {
    const calls: unknown[] = []

    await abortSession({ client: client(calls), sessionID: "session_1", dir: "/repo" })

    expect(calls).toEqual([
      {
        type: "abort",
        params: { sessionID: "session_1", directory: "/repo" },
        opts: { throwOnError: true },
      },
    ])
  })

  it("rejects when the abort request fails", async () => {
    const calls: unknown[] = []

    await expect(abortSession({ client: client(calls, true), sessionID: "session_1", dir: "/repo" })).rejects.toThrow(
      "abort failed",
    )

    expect(calls).toEqual([
      {
        type: "abort",
        params: { sessionID: "session_1", directory: "/repo" },
        opts: { throwOnError: true },
      },
    ])
  })
})
