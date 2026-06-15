import { describe, expect, it, mock } from "bun:test"
import { forkText, recordForkHandoff } from "../../src/agent-manager/fork-handoff"

describe("fork handoff", () => {
  it("describes retained context without assuming a new task", () => {
    const text = forkText({ directory: "/repo/.kilo/worktrees/feature" })

    expect(text).toContain("This session was forked from an existing session in the current repository or worktree.")
    expect(text).toContain("Use this as the current working directory: /repo/.kilo/worktrees/feature")
    expect(text).toContain("this location supersedes any earlier repository or worktree location")
    expect(text).toContain("The prior conversation context was retained intentionally.")
    expect(text).toContain("continue the same task, explore an alternative approach, or provide new instructions")
    expect(text).toContain("Follow the user's next instruction as the direction for this fork")
  })

  it("records a hidden no-reply handoff in the forked session", async () => {
    const promptAsync = mock(async () => ({}))
    const client = { session: { promptAsync } }

    await recordForkHandoff({
      client: client as never,
      sessionId: "session-fork",
      directory: "/repo/.kilo/worktrees/feature",
    })

    expect(promptAsync).toHaveBeenCalledWith(
      {
        sessionID: "session-fork",
        directory: "/repo/.kilo/worktrees/feature",
        noReply: true,
        parts: [
          {
            type: "text",
            text: forkText({ directory: "/repo/.kilo/worktrees/feature" }),
            synthetic: true,
          },
        ],
      },
      { throwOnError: true },
    )
  })
})
