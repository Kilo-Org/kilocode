import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Command } from "../../../src/command"
import { Suggestion } from "../../../src/kilocode/suggestion"
import { SuggestTool } from "../../../src/kilocode/suggestion/tool"
import { Tool } from "../../../src/tool/tool"
import { Truncate } from "../../../src/tool/truncate"
import { Agent } from "../../../src/agent/agent"

const toolRuntime = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

async function initTool() {
  return toolRuntime.runPromise(
    Effect.gen(function* () {
      const info = yield* SuggestTool
      return yield* Tool.init(info)
    }),
  )
}

const ctx = {
  sessionID: "ses_test",
  messageID: "msg_assistant",
  callID: "call_suggest",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [
    {
      info: {
        id: "msg_user",
        role: "user",
        sessionID: "ses_test",
        time: { created: 1 },
        agent: "code",
        model: { providerID: "openai", modelID: "gpt-4" },
      },
      parts: [],
    },
  ],
  metadata: () => {},
  ask: () => Effect.void,
}

describe("tool.suggest", () => {
  let show: ReturnType<typeof spyOn>
  let cmdGet: ReturnType<typeof spyOn>

  beforeEach(() => {
    show = spyOn(Suggestion, "show")
    cmdGet = spyOn(Command, "get")
  })

  afterEach(() => {
    show.mockRestore()
    cmdGet.mockRestore()
  })

  test("returns dismissal result when suggestion is dismissed", async () => {
    const tool = await initTool()
    show.mockRejectedValueOnce(new Suggestion.DismissedError())

    const result = await toolRuntime.runPromise(
      tool.execute(
        {
          suggest: "Run review?",
          actions: [{ label: "Start", prompt: "/local-review-uncommitted" }],
        },
        ctx as any,
      ),
    )

    expect(result.title).toBe("Suggestion dismissed")
    expect(result.output).toBe("User dismissed the suggestion.")
    expect(result.metadata.dismissed).toBe(true)
  })

  test("resolves command template for slash-command action prompt", async () => {
    const tool = await initTool()
    show.mockResolvedValueOnce({
      label: "Start review",
      description: "Run a local review now",
      prompt: "/local-review-uncommitted",
    })
    cmdGet.mockResolvedValueOnce({
      name: "local-review-uncommitted",
      description: "local review (uncommitted changes)",
      template: Promise.resolve("Review these uncommitted changes:\n\n## Files Changed\n..."),
      hints: [],
    })

    const result = await toolRuntime.runPromise(
      tool.execute(
        {
          suggest: "Run review?",
          actions: [{ label: "Start review", prompt: "/local-review-uncommitted" }],
        },
        ctx as any,
      ),
    )

    expect(result.title).toBe("User accepted: Start review")
    expect(result.output).toContain("Review these uncommitted changes:")
    expect(result.output).toContain("Carry out the following request now")
    expect(result.metadata.dismissed).toBe(false)
    expect(result.metadata.accepted).toEqual({
      label: "Start review",
      description: "Run a local review now",
      prompt: "/local-review-uncommitted",
    })
    expect(cmdGet).toHaveBeenCalledWith("local-review-uncommitted")
  })

  test("returns plain-text prompt directly for non-command actions", async () => {
    const tool = await initTool()
    show.mockResolvedValueOnce({
      label: "Run tests",
      prompt: "Run the test suite and fix any failures",
    })

    const result = await toolRuntime.runPromise(
      tool.execute(
        {
          suggest: "Tests might need running",
          actions: [{ label: "Run tests", prompt: "Run the test suite and fix any failures" }],
        },
        ctx as any,
      ),
    )

    expect(result.title).toBe("User accepted: Run tests")
    expect(result.output).toContain("Run the test suite and fix any failures")
    expect(result.output).toContain("Carry out the following request now")
    expect(result.metadata.dismissed).toBe(false)
    expect(cmdGet).not.toHaveBeenCalled()
  })

  test("falls back to raw prompt when command is not found", async () => {
    const tool = await initTool()
    show.mockResolvedValueOnce({
      label: "Unknown cmd",
      prompt: "/nonexistent-command",
    })
    cmdGet.mockResolvedValueOnce(undefined)

    const result = await toolRuntime.runPromise(
      tool.execute(
        {
          suggest: "Try this?",
          actions: [{ label: "Unknown cmd", prompt: "/nonexistent-command" }],
        },
        ctx as any,
      ),
    )

    expect(result.title).toBe("User accepted: Unknown cmd")
    expect(result.output).toContain("/nonexistent-command")
    expect(result.metadata.dismissed).toBe(false)
  })

  test("falls back to raw prompt when template resolution fails", async () => {
    const tool = await initTool()
    show.mockResolvedValueOnce({
      label: "Start review",
      prompt: "/local-review-uncommitted",
    })
    cmdGet.mockResolvedValueOnce({
      name: "local-review-uncommitted",
      description: "local review (uncommitted changes)",
      template: Promise.reject(new Error("git not found")),
      hints: [],
    })

    const result = await toolRuntime.runPromise(
      tool.execute(
        {
          suggest: "Run review?",
          actions: [{ label: "Start review", prompt: "/local-review-uncommitted" }],
        },
        ctx as any,
      ),
    )

    expect(result.title).toBe("User accepted: Start review")
    expect(result.output).toContain("/local-review-uncommitted")
    expect(result.metadata.dismissed).toBe(false)
  })
})
