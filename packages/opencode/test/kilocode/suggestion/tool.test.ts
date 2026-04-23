import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Command } from "../../../src/command"
import { Suggestion } from "../../../src/kilocode/suggestion"
import { SuggestTool } from "../../../src/kilocode/suggestion/tool"
import { Tool } from "../../../src/tool"
import { Truncate } from "../../../src/tool"
import { Agent } from "../../../src/agent/agent"
import { SessionStatus } from "../../../src/session/status"

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
  let statusSet: ReturnType<typeof spyOn>

  beforeEach(() => {
    show = spyOn(Suggestion, "show")
    cmdGet = spyOn(Command, "get")
    statusSet = spyOn(SessionStatus, "set").mockResolvedValue(undefined as any)
  })

  afterEach(() => {
    show.mockRestore()
    cmdGet.mockRestore()
    statusSet.mockRestore()
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

  // The suggest tool must emit non-blocking suggestions so the main CLI input
  // stays focused and submittable while the picker is visible (matches the
  // VS Code extension). Blocking suggestions hide the main prompt entirely.
  test("emits non-blocking suggestions so the main input stays active", async () => {
    const tool = await initTool()
    show.mockRejectedValueOnce(new Suggestion.DismissedError())

    await toolRuntime.runPromise(
      tool.execute(
        {
          suggest: "Run review?",
          actions: [{ label: "Start", prompt: "/local-review-uncommitted" }],
        },
        ctx as any,
      ),
    )

    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: ctx.sessionID,
        blocking: false,
      }),
    )
  })

  // Regression for https://github.com/Kilo-Org/kilocode/pull/9199: while the
  // suggest tool is blocked on user input the session status must be flipped
  // to idle so a session left with an open suggestion (e.g. VS Code closed
  // mid-prompt) does not appear stuck as busy.
  test("marks session idle while waiting for user response", async () => {
    const tool = await initTool()
    let resolveShow: (action: Suggestion.Action) => void = () => {}
    show.mockReturnValueOnce(
      new Promise<Suggestion.Action>((resolve) => {
        resolveShow = resolve
      }),
    )

    const pending = toolRuntime.runPromise(
      tool.execute(
        {
          suggest: "Run review?",
          actions: [{ label: "Start", prompt: "do it" }],
        },
        ctx as any,
      ),
    )

    // Wait for the tool to reach the await on the suggestion promise so the
    // idle status call has been issued.
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(statusSet).toHaveBeenCalledWith(ctx.sessionID, { type: "idle" })
    expect(statusSet).not.toHaveBeenCalledWith(ctx.sessionID, { type: "busy" })

    resolveShow({ label: "Start", prompt: "do it" })
    await pending
  })

  // Regression for https://github.com/Kilo-Org/kilocode/pull/9199: once the
  // user accepts a suggestion the session must be flipped back to busy
  // immediately so there is no idle flash while the follow-up response is
  // generated.
  test("restores busy status after accept, in order (idle then busy)", async () => {
    const tool = await initTool()
    show.mockResolvedValueOnce({ label: "Go", prompt: "go" })

    await toolRuntime.runPromise(
      tool.execute(
        {
          suggest: "Go?",
          actions: [{ label: "Go", prompt: "go" }],
        },
        ctx as any,
      ),
    )

    const statuses = statusSet.mock.calls
      .filter((call: unknown[]) => call[0] === ctx.sessionID)
      .map((call: unknown[]) => (call[1] as { type: string }).type)
    expect(statuses).toEqual(["idle", "busy"])
  })

  // Regression for https://github.com/Kilo-Org/kilocode/pull/9199: a dismissed
  // suggestion leaves the session idle — the runLoop will restore busy on the
  // next iteration, so the tool must not flip busy itself when the user
  // walked away.
  test("leaves session idle when suggestion is dismissed", async () => {
    const tool = await initTool()
    show.mockRejectedValueOnce(new Suggestion.DismissedError())

    await toolRuntime.runPromise(
      tool.execute(
        {
          suggest: "Go?",
          actions: [{ label: "Go", prompt: "go" }],
        },
        ctx as any,
      ),
    )

    const statuses = statusSet.mock.calls
      .filter((call: unknown[]) => call[0] === ctx.sessionID)
      .map((call: unknown[]) => (call[1] as { type: string }).type)
    expect(statuses).toEqual(["idle"])
  })
})
