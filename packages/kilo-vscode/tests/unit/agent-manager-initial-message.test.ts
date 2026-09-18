import { describe, expect, it } from "bun:test"
import { initialMessage, initialVariant, seedInitialVariant } from "../../webview-ui/agent-manager/initial-message"

describe("Agent Manager initial message", () => {
  it.each(["high", ""])("forwards the selected variant %s to sendMessage", (variant) => {
    const msg = initialMessage({
      type: "agentManager.sendInitialMessage",
      projectId: "project-a",
      sessionId: "session-a",
      worktreeId: "wt-a",
      text: "Fix it",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      agent: "code",
      variant,
    })

    expect(msg).toEqual({
      type: "sendMessage",
      projectId: "project-a",
      text: "Fix it",
      sessionID: "session-a",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      agent: "code",
      variant,
      files: undefined,
    })
  })

  it("does not create an empty sendMessage payload", () => {
    expect(
      initialMessage({
        type: "agentManager.sendInitialMessage",
        sessionId: "session-a",
        worktreeId: "wt-a",
      }),
    ).toBeUndefined()
  })

  it.each(["medium", ""])("builds the initial session variant state for %s", (variant) => {
    const state = initialVariant(
      {
        type: "agentManager.sendInitialMessage",
        sessionId: "session-a",
        worktreeId: "wt-a",
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variant,
      },
      "code",
    )

    expect(state).toEqual({
      sessionID: "session-a",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      agent: "code",
      value: variant,
    })
  })

  it("does not build variant state without a complete model variant", () => {
    expect(
      initialVariant(
        {
          type: "agentManager.sendInitialMessage",
          sessionId: "session-a",
          worktreeId: "wt-a",
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
        },
        "code",
      ),
    ).toBeUndefined()
  })

  it.each(["medium", ""])("seeds initial variant %s into the session store", (variant) => {
    const calls: unknown[] = []

    seedInitialVariant(
      {
        getSessionAgent: () => "code",
        setSessionVariant: (...args) => calls.push(args),
      },
      {
        type: "agentManager.sendInitialMessage",
        sessionId: "session-a",
        worktreeId: "wt-a",
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variant,
      },
    )

    expect(calls).toEqual([["session-a", "anthropic", "claude-sonnet-4", variant, "code"]])
  })
})
