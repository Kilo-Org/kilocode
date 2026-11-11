import { describe, expect, it, mock } from "bun:test"
import { moveSession } from "../src/agent-manager/session-move"

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
        get: async () => ({ id: "ses_1", location: { directory: current().directory } }),
        active: async () => {
          const value = current().active
          reads.count++
          return value
        },
      },
    }

    const moved = await moveSession(client as never, "ses_1", "/repo/wt")

    expect(move).toHaveBeenCalledWith({ sessionID: "ses_1", directory: "/repo/wt" })
    expect(reads.count).toBe(3)
    expect(moved.location.directory).toBe("/repo/wt")
  })
})
