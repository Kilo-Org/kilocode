import { describe, expect, it } from "bun:test"
import { matchFollowup, recordFollowup } from "../../src/kilo-provider/followup-session"

describe("followup-session", () => {
  it("records a pending follow-up for Start new session replies", () => {
    const pending = recordFollowup({
      answers: [["Start new session"]],
      dir: "/repo",
      now: 1,
    })

    expect(pending).toEqual({
      dir: "/repo",
      time: 1,
    })
  })

  it("ignores other question replies", () => {
    const pending = recordFollowup({
      answers: [["Continue here"]],
      dir: "/repo",
      now: 1,
    })

    expect(pending).toBeUndefined()
  })

  it("matches pending follow-ups by normalized directory before expiry", () => {
    const pending = {
      dir: "c:/repo/.kilo/worktrees/feature",
      time: 1,
    }

    expect(matchFollowup({ pending, dir: "C:\\repo\\.kilo\\worktrees\\feature\\", now: 2 })).toBe(true)
    expect(matchFollowup({ pending, dir: "c:/repo/.kilo/worktrees/other", now: 2 })).toBe(false)
    expect(matchFollowup({ pending, dir: "c:/repo/.kilo/worktrees/feature", now: 30_002 })).toBe(false)
  })
})
