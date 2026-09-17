import { describe, expect, it } from "bun:test"
import {
  dispatchInitialPrompt,
  initialCommand,
  initialMessage,
  initialVariant,
  seedInitialVariant,
} from "../../webview-ui/agent-manager/initial-message"

describe("dispatchInitialPrompt", () => {
  const collect = () => {
    const calls: unknown[][] = []
    return {
      calls,
      session: {
        sendCommand: (...args: unknown[]) => {
          calls.push(args)
          return true
        },
        submit: (input: unknown) => calls.push([input]),
      },
    }
  }

  it("dispatches a command for a command prompt", () => {
    const ctx = collect()
    dispatchInitialPrompt(ctx.session, {
      type: "agentManager.sendInitialMessage",
      sessionId: "session-a",
      worktreeId: "wt-a",
      command: "goal",
      arguments: "ship it",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      agent: "code",
      variant: "high",
    })

    expect(ctx.calls).toHaveLength(1)
    expect(ctx.calls[0]?.slice(0, 9)).toEqual([
      "goal",
      "ship it",
      "anthropic",
      "claude-sonnet-4",
      undefined,
      undefined,
      undefined,
      "session-a",
      { agent: "code", variant: "high" },
    ])
  })

  it("submits a plain message for a text prompt", () => {
    const ctx = collect()
    dispatchInitialPrompt(ctx.session, {
      type: "agentManager.sendInitialMessage",
      sessionId: "session-a",
      worktreeId: "wt-a",
      text: "Fix it",
    })

    expect(ctx.calls).toHaveLength(1)
    expect(ctx.calls[0]?.[0]).toEqual(
      expect.objectContaining({ type: "sendMessage", text: "Fix it", sessionID: "session-a" }),
    )
  })

  it("does nothing without text or a command", () => {
    const ctx = collect()
    dispatchInitialPrompt(ctx.session, {
      type: "agentManager.sendInitialMessage",
      sessionId: "session-a",
      worktreeId: "wt-a",
    })

    expect(ctx.calls).toHaveLength(0)
  })
})

describe("Agent Manager initial command", () => {
  it("builds a sendCommand request for a command initial prompt", () => {
    const msg = initialCommand({
      type: "agentManager.sendInitialMessage",
      sessionId: "session-a",
      worktreeId: "wt-a",
      command: "goal",
      arguments: "ship the release",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      agent: "code",
      variant: "high",
      files: [{ mime: "image/png", url: "data:image/png;base64,aaa" }],
    })

    expect(msg).toEqual({
      type: "sendCommand",
      command: "goal",
      arguments: "ship the release",
      sessionID: "session-a",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      agent: "code",
      variant: "high",
      files: [{ mime: "image/png", url: "data:image/png;base64,aaa" }],
    })
  })

  it("defaults missing arguments to an empty string", () => {
    expect(
      initialCommand({
        type: "agentManager.sendInitialMessage",
        sessionId: "session-a",
        worktreeId: "wt-a",
        command: "grill",
      })?.arguments,
    ).toBe("")
  })

  it("returns undefined for a plain prompt", () => {
    expect(
      initialCommand({
        type: "agentManager.sendInitialMessage",
        sessionId: "session-a",
        worktreeId: "wt-a",
        text: "Fix it",
      }),
    ).toBeUndefined()
  })
})

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
