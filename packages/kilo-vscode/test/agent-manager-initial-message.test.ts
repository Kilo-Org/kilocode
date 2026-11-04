import { describe, expect, it } from "bun:test"
import {
  dispatchInitialPrompt,
  initialCommand,
  initialMessage,
  initialModel,
} from "../webview-ui/agent-manager/initial-message"

function store() {
  const calls: unknown[][] = []
  return {
    calls,
    value: {
      api: {
        session: {
          switchAgent: async (input: unknown) => void calls.push(["switchAgent", input]),
          switchModel: async (input: unknown) => void calls.push(["switchModel", input]),
          command: async (input: unknown) => void calls.push(["command", input]),
        },
      },
      data: { session: { prompt: (input: unknown) => void calls.push(["prompt", input]) } },
    },
  }
}

const base = {
  type: "agentManager.sendInitialMessage" as const,
  sessionId: "session-a",
  worktreeId: "wt-a",
}

describe("dispatchInitialPrompt", () => {
  it("switches the agent and model, then runs a command prompt", async () => {
    const ctx = store()
    await dispatchInitialPrompt(ctx.value as never, {
      ...base,
      command: "goal",
      arguments: "ship it",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      agent: "code",
      variant: "high",
    })

    expect(ctx.calls).toEqual([
      ["switchAgent", { sessionID: "session-a", agent: "code" }],
      ["switchModel", { sessionID: "session-a", model: { id: "claude-sonnet-4", providerID: "anthropic", variant: "high" } }],
      ["command", { sessionID: "session-a", name: "goal", text: "ship it", files: undefined }],
    ])
  })

  it("submits a plain message for a text prompt", async () => {
    const ctx = store()
    await dispatchInitialPrompt(ctx.value as never, { ...base, text: "Fix it" })

    expect(ctx.calls).toEqual([["prompt", { sessionID: "session-a", text: "Fix it", files: undefined }]])
  })

  it("does nothing without text or a command", async () => {
    const ctx = store()
    await dispatchInitialPrompt(ctx.value as never, base)

    expect(ctx.calls).toHaveLength(0)
  })

  it("maps host files to v2 prompt files", () => {
    const message = initialMessage({
      ...base,
      text: "Fix it",
      files: [{ mime: "image/png", url: "data:image/png;base64,aaa" }],
    })
    expect(message?.files).toEqual([{ uri: "data:image/png;base64,aaa" }])
  })
})

describe("Agent Manager initial command", () => {
  it("builds a command request for a command initial prompt", () => {
    expect(
      initialCommand({
        ...base,
        command: "goal",
        arguments: "ship the release",
        files: [{ mime: "image/png", url: "data:image/png;base64,aaa" }],
      }),
    ).toEqual({
      sessionID: "session-a",
      name: "goal",
      text: "ship the release",
      files: [{ uri: "data:image/png;base64,aaa" }],
    })
  })

  it("defaults missing arguments to an empty string", () => {
    expect(initialCommand({ ...base, command: "grill" })?.text).toBe("")
  })

  it("returns undefined for a plain prompt", () => {
    expect(initialCommand({ ...base, text: "Fix it" })).toBeUndefined()
  })
})

describe("Agent Manager initial message", () => {
  it("keeps the requested variant on the model switch", () => {
    expect(
      initialModel({
        ...base,
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variant: "high",
      }),
    ).toEqual({ id: "claude-sonnet-4", providerID: "anthropic", variant: "high" })
  })

  it("does not build a model without both ids", () => {
    expect(initialModel({ ...base, providerID: "anthropic" })).toBeUndefined()
  })

  it("does not create an empty message payload", () => {
    expect(initialMessage(base)).toBeUndefined()
  })
})
