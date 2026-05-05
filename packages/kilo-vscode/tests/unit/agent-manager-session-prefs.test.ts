import { describe, expect, it } from "bun:test"
import { restoreSessionPrefs } from "../../webview-ui/agent-manager/session-prefs"

describe("Agent Manager session prefs", () => {
  it("restores persisted prefs into the session context", () => {
    const calls: unknown[] = []

    restoreSessionPrefs(
      { setSessionPrefs: (...args) => calls.push(args) },
      [
        {
          id: "session-a",
          worktreeId: null,
          createdAt: "now",
          prefs: { agent: "code", model: { providerID: "anthropic", modelID: "claude-sonnet-4" } },
        },
        { id: "session-b", worktreeId: "wt-a", createdAt: "now" },
      ],
    )

    expect(calls).toEqual([
      ["session-a", { agent: "code", model: { providerID: "anthropic", modelID: "claude-sonnet-4" } }],
    ])
  })
})
