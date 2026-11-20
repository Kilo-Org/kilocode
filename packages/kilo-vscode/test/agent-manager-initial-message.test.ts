import { afterEach, describe, expect, it, jest } from "bun:test"
import { createData } from "@opencode/client/solid"
import { createRoot } from "solid-js"
import { setImmediate } from "node:timers/promises"
import { events } from "../webview-ui/src/v2/events"
import {
  dispatchInitialPrompt,
  initialCommand,
  initialMessage,
  initialModel,
} from "../webview-ui/agent-manager/initial-message"

const selected = { providerID: "anthropic", id: "claude-sonnet-4", enabled: true }

function store(models = [selected]) {
  const calls: unknown[][] = []
  const reads: string[] = []
  const event = events()
  const api = {
    model: {
      list: async ({ location }: { location: { directory: string } }) => {
        reads.push(location.directory)
        return { location, data: location.directory === "/worktree" ? [...models] : [selected] }
      },
    },
    session: {
      switchAgent: async (input: unknown) => void calls.push(["switchAgent", input]),
      switchModel: async (input: unknown) => void calls.push(["switchModel", input]),
      command: async (input: unknown) => void calls.push(["command", input]),
    },
  }
  return createRoot((dispose) => {
    const data = createData({ api: () => api as never, directory: "/worktree", event })
    return {
      calls,
      reads,
      models,
      update: () =>
        event.emit({
          type: "model.updated",
          id: "update",
          created: 1,
          location: { directory: "/worktree" },
          data: {},
        }),
      value: { api, data: { ...data, session: { prompt: (input: unknown) => void calls.push(["prompt", input]) } } },
      [Symbol.dispose]: dispose,
    }
  })
}

const base = {
  type: "agentManager.sendInitialMessage" as const,
  sessionId: "session-a",
  worktreeId: "wt-a",
}

const choice = { ...base, agent: "code", providerID: selected.providerID, modelID: selected.id, variant: "high" }

afterEach(() => jest.useRealTimers())

describe("dispatchInitialPrompt", () => {
  it("waits for the target worktree's selected model before switching or admitting its initial prompt", async () => {
    using ctx = store([
      { ...selected, providerID: "other" },
      { ...selected, id: "other" },
      { ...selected, enabled: false },
    ])
    const pending = dispatchInitialPrompt(ctx.value as never, { ...choice, text: "Fix it" })
    await setImmediate()
    expect(ctx.reads).toEqual(["/worktree"])
    expect(ctx.calls).toEqual([])

    ctx.models.push(selected)
    ctx.update()
    await pending
    ctx.update()
    await setImmediate()
    expect(ctx.calls).toEqual([
      ["switchAgent", { sessionID: "session-a", agent: "code" }],
      [
        "switchModel",
        { sessionID: "session-a", model: { id: selected.id, providerID: selected.providerID, variant: "high" } },
      ],
      ["prompt", { sessionID: "session-a", text: "Fix it", files: undefined }],
    ])
  })

  it.each(["timeout", "disposal"])("does not send after %s even if the model becomes ready", async (reason) => {
    jest.useFakeTimers()
    using ctx = store([])
    const controller = new AbortController()
    const pending = dispatchInitialPrompt(ctx.value as never, { ...choice, command: "goal" }, controller.signal)
    await setImmediate()
    if (reason === "timeout") jest.advanceTimersToNextTimer()
    else controller.abort()
    await expect(pending).rejects.toMatchObject({ name: reason === "timeout" ? "TimeoutError" : "AbortError" })
    ctx.models.push(selected)
    ctx.update()
    await setImmediate()
    expect(ctx.calls).toEqual([])
  })

  it("keeps a selection-only event independent of the model catalog", async () => {
    using ctx = store([])
    await dispatchInitialPrompt(ctx.value as never, choice)
    expect(ctx.reads).toEqual([])
    expect(ctx.calls.map(([operation]) => operation)).toEqual(["switchAgent", "switchModel"])
  })

  it("switches the agent and model, then runs a command prompt", async () => {
    using ctx = store()
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
      [
        "switchModel",
        { sessionID: "session-a", model: { id: "claude-sonnet-4", providerID: "anthropic", variant: "high" } },
      ],
      ["command", { sessionID: "session-a", name: "goal", text: "ship it", files: undefined }],
    ])
  })

  it("submits a plain message for a text prompt", async () => {
    using ctx = store()
    await dispatchInitialPrompt(ctx.value as never, { ...base, text: "Fix it" })

    expect(ctx.calls).toEqual([["prompt", { sessionID: "session-a", text: "Fix it", files: undefined }]])
  })

  it("does nothing without text or a command", async () => {
    using ctx = store()
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

  it("keeps the name and span of an @ mention file", () => {
    const mention = { text: "@Fix auth bug", start: 8, end: 21 }
    const message = initialMessage({
      ...base,
      text: "Compare @Fix auth bug",
      files: [{ mime: "text/plain", url: "session:ses_abc", name: "Fix-auth-bug.md", mention }],
    })
    expect(message?.files).toEqual([{ uri: "session:ses_abc", name: "Fix-auth-bug.md", mention }])
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
