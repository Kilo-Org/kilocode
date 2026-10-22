import { describe, expect, it, mock } from "bun:test"
import { handoffText, recordPromotionHandoff } from "../../src/agent-manager/promotion-handoff"

describe("promotion handoff", () => {
  it("describes the new worktree location", () => {
    const text = handoffText({ directory: "/repo/.kilo/worktrees/feature", branch: "feature/test" })

    expect(text).toContain("This session was moved to a git worktree.")
    expect(text).toContain("Use this as the current working directory: /repo/.kilo/worktrees/feature")
    expect(text).toContain("The worktree branch is: feature/test")
  })

  it("records a hidden no-reply handoff in the worktree instance", async () => {
    const promptAsync = mock(async () => ({}))
    const client = { session: { promptAsync } }

    await recordPromotionHandoff({
      client: client as never,
      sessionId: "session-1",
      directory: "/repo/.kilo/worktrees/feature",
      branch: "feature/test",
    })

    expect(promptAsync).toHaveBeenCalledWith(
      {
        sessionID: "session-1",
        directory: "/repo/.kilo/worktrees/feature",
        noReply: true,
        parts: [
          {
            type: "text",
            text: handoffText({ directory: "/repo/.kilo/worktrees/feature", branch: "feature/test" }),
            synthetic: true,
          },
        ],
      },
      { throwOnError: true },
    )
  })
})
