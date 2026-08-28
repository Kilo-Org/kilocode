import { describe, expect, it } from "bun:test"
import { showBackgroundAgent, type BackgroundAgent } from "../../webview-ui/src/components/chat/background-agents"

const completed: BackgroundAgent = {
  id: "child",
  status: "completed",
  startedAt: 1,
  jobID: "job",
}

describe("background agent dismissals", () => {
  it("keeps a completed job hidden after switching back to its parent session", () => {
    const hidden = new Map<string, ReadonlySet<string>>([["parent-a", new Set(["job"])]])

    expect(showBackgroundAgent(completed, hidden, "parent-b")).toBe(true)
    expect(showBackgroundAgent(completed, hidden, "parent-a")).toBe(false)
  })
})
