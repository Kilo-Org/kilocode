import { describe, expect, it, mock } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { moveSession } from "../src/agent-manager/session-move"

function session(directory: string): SessionInfo {
  return { id: "ses_1", location: { directory } } as SessionInfo
}

describe("agent manager session move", () => {
  it("resolves only after the move is applied and its drain has settled", async () => {
    const states = [
      { directory: "/repo", active: { ses_1: { type: "running" } } },
      { directory: "/repo/wt", active: { ses_1: { type: "running" } } },
      { directory: "/repo/wt", active: {} },
    ]
    const reads = { count: 0 }
    const current = () => states[Math.min(reads.count, states.length - 1)]!
    const move = mock(async () => undefined)
    const client = {
      session: {
        move,
        get: async () => session(current().directory),
        active: async () => {
          const value = current().active
          reads.count++
          return value
        },
      },
    }

    const moved = await moveSession(client as never, session("/repo"), "/repo/wt")

    expect(move).toHaveBeenCalledWith({ sessionID: "ses_1", directory: "/repo/wt" })
    expect(reads.count).toBe(3)
    expect(moved.location.directory).toBe("/repo/wt")
  })

  it("reports the last record it saw when the move does not settle in time", async () => {
    const client = {
      session: {
        move: async () => undefined,
        get: async () => session("/repo"),
        active: async () => ({ ses_1: { type: "running" } }),
      },
    }

    const moved = await moveSession(client as never, session("/repo"), "/repo/wt", 0)

    expect(moved.location.directory).toBe("/repo")
  })

  it("does not fail the move when its reads fail", async () => {
    const client = {
      session: {
        move: async () => undefined,
        get: async () => {
          throw new Error("read failed")
        },
        active: async () => ({}),
      },
    }

    const moved = await moveSession(client as never, session("/repo"), "/repo/wt", 0)

    expect(moved.id).toBe("ses_1")
    expect(moved.location.directory).toBe("/repo")
  })
})
