import { afterEach, beforeEach, describe, expect, spyOn } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { Command } from "../../../src/command"
import { Suggestion } from "../../../src/kilocode/suggestion"
import { SuggestTool } from "../../../src/kilocode/suggestion/tool"
import { Tool } from "../../../src/tool/tool"
import { Truncate } from "../../../src/tool/truncate"
import { Agent } from "../../../src/agent/agent"
import { SessionStatus } from "../../../src/session/status"
import { testEffect } from "../../lib/effect"

const cmds: Record<string, Command.Info> = {}
const names: string[] = []
const command = Layer.succeed(
  Command.Service,
  Command.Service.of({
    get: (name) =>
      Effect.sync(() => {
        names.push(name)
        return cmds[name]
      }),
    list: () => Effect.succeed(Object.values(cmds)),
  }),
)
const statuses: Array<[string, SessionStatus.Info]> = []
const status = Layer.succeed(
  SessionStatus.Service,
  SessionStatus.Service.of({
    get: () => Effect.succeed({ type: "idle" }),
    list: () => Effect.succeed(new Map()),
    set: (sessionID, value) => Effect.sync(() => statuses.push([sessionID, value])),
  }),
)
const it = testEffect(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer, command, status))

const init = Effect.fn("SuggestToolTest.init")(function* () {
  const info = yield* SuggestTool
  return yield* Tool.init(info)
})

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

  beforeEach(() => {
    show = spyOn(Suggestion, "show")
    names.length = 0
    statuses.length = 0
    for (const name of Object.keys(cmds)) delete cmds[name]
  })

  afterEach(() => {
    show.mockRestore()
  })

  it.live("returns dismissal result when suggestion is dismissed", () =>
    Effect.gen(function* () {
      const tool = yield* init()
      show.mockRejectedValueOnce(new Suggestion.DismissedError())

      const result = yield* tool.execute(
        {
          suggest: "Run review?",
          label: "Start",
          prompt: "/local-review-uncommitted",
        },
        ctx as any,
      )

      expect(result.title).toBe("Suggestion dismissed")
      expect(result.output).toBe("User dismissed the suggestion.")
      expect(result.metadata.dismissed).toBe(true)
    }),
  )

  it.live("resolves command template for slash-command action prompt", () =>
    Effect.gen(function* () {
      const tool = yield* init()
      show.mockResolvedValueOnce({
        label: "Start review",
        description: "Run a local review now",
        prompt: "/local-review-uncommitted",
      })
      cmds["local-review-uncommitted"] = {
        name: "local-review-uncommitted",
        description: "local review (uncommitted changes)",
        template: Promise.resolve("Review these uncommitted changes:\n\n## Files Changed\n..."),
        hints: [],
      }

      const result = yield* tool.execute(
        {
          suggest: "Run review?",
          label: "Start review",
          prompt: "/local-review-uncommitted",
        },
        ctx as any,
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
      expect(names).toEqual(["local-review-uncommitted"])
    }),
  )

  it.live("returns plain-text prompt directly for non-command actions", () =>
    Effect.gen(function* () {
      const tool = yield* init()
      show.mockResolvedValueOnce({
        label: "Run tests",
        prompt: "Run the test suite and fix any failures",
      })

      const result = yield* tool.execute(
        {
          suggest: "Tests might need running",
          label: "Run tests",
          prompt: "Run the test suite and fix any failures",
        },
        ctx as any,
      )

      expect(result.title).toBe("User accepted: Run tests")
      expect(result.output).toContain("Run the test suite and fix any failures")
      expect(result.output).toContain("Carry out the following request now")
      expect(result.metadata.dismissed).toBe(false)
      expect(names).toEqual([])
    }),
  )

  it.live("falls back to raw prompt when command is not found", () =>
    Effect.gen(function* () {
      const tool = yield* init()
      show.mockResolvedValueOnce({
        label: "Unknown cmd",
        prompt: "/nonexistent-command",
      })

      const result = yield* tool.execute(
        {
          suggest: "Try this?",
          label: "Unknown cmd",
          prompt: "/nonexistent-command",
        },
        ctx as any,
      )

      expect(result.title).toBe("User accepted: Unknown cmd")
      expect(result.output).toContain("/nonexistent-command")
      expect(result.metadata.dismissed).toBe(false)
    }),
  )

  it.live("falls back to raw prompt when template resolution fails", () =>
    Effect.gen(function* () {
      const tool = yield* init()
      show.mockResolvedValueOnce({
        label: "Start review",
        prompt: "/local-review-uncommitted",
      })
      cmds["local-review-uncommitted"] = {
        name: "local-review-uncommitted",
        description: "local review (uncommitted changes)",
        template: Promise.reject(new Error("git not found")),
        hints: [],
      }

      const result = yield* tool.execute(
        {
          suggest: "Run review?",
          label: "Start review",
          prompt: "/local-review-uncommitted",
        },
        ctx as any,
      )

      expect(result.title).toBe("User accepted: Start review")
      expect(result.output).toContain("/local-review-uncommitted")
      expect(result.metadata.dismissed).toBe(false)
    }),
  )

  // The suggest tool must emit non-blocking suggestions so the main CLI input
  // stays focused and submittable while the picker is visible (matches the
  // VS Code extension). Blocking suggestions hide the main prompt entirely.
  it.live("emits non-blocking suggestions so the main input stays active", () =>
    Effect.gen(function* () {
      const tool = yield* init()
      show.mockRejectedValueOnce(new Suggestion.DismissedError())

      yield* tool.execute(
        {
          suggest: "Run review?",
          label: "Start",
          prompt: "/local-review-uncommitted",
        },
        ctx as any,
      )

      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: ctx.sessionID,
          blocking: false,
        }),
      )
    }),
  )

  // Regression for https://github.com/Kilo-Org/kilocode/pull/9199: while the
  // suggest tool is blocked on user input the session status must be flipped
  // to idle so a session left with an open suggestion (e.g. VS Code closed
  // mid-prompt) does not appear stuck as busy.
  it.live("marks session idle while waiting for user response", () =>
    Effect.gen(function* () {
      const tool = yield* init()
      let resolveShow: (action: Suggestion.Action) => void = () => {}
      show.mockReturnValueOnce(
        new Promise<Suggestion.Action>((resolve) => {
          resolveShow = resolve
        }),
      )

      const pending = yield* tool
        .execute(
          {
            suggest: "Run review?",
            label: "Start",
            prompt: "do it",
          },
          ctx as any,
        )
        .pipe(Effect.forkScoped)

      // Wait for the tool to reach the await on the suggestion promise so the
      // idle status call has been issued.
      yield* Effect.sleep("10 millis")

      expect(statuses).toContainEqual([ctx.sessionID, { type: "idle" }])
      expect(statuses).not.toContainEqual([ctx.sessionID, { type: "busy" }])

      resolveShow({ label: "Start", prompt: "do it" })
      yield* Fiber.join(pending)
    }),
  )

  // Regression for https://github.com/Kilo-Org/kilocode/pull/9199: once the
  // user accepts a suggestion the session must be flipped back to busy
  // immediately so there is no idle flash while the follow-up response is
  // generated.
  it.live("restores busy status after accept, in order (idle then busy)", () =>
    Effect.gen(function* () {
      const tool = yield* init()
      show.mockResolvedValueOnce({ label: "Go", prompt: "go" })

      yield* tool.execute(
        {
          suggest: "Go?",
          label: "Go",
          prompt: "go",
        },
        ctx as any,
      )

      expect(statuses.map(([, value]) => value.type)).toEqual(["idle", "busy"])
    }),
  )

  // Regression for https://github.com/Kilo-Org/kilocode/pull/9199: a dismissed
  // suggestion leaves the session idle - the runLoop will restore busy on the
  // next iteration, so the tool must not flip busy itself when the user
  // walked away.
  it.live("leaves session idle when suggestion is dismissed", () =>
    Effect.gen(function* () {
      const tool = yield* init()
      show.mockRejectedValueOnce(new Suggestion.DismissedError())

      yield* tool.execute(
        {
          suggest: "Go?",
          label: "Go",
          prompt: "go",
        },
        ctx as any,
      )

      expect(statuses.map(([, value]) => value.type)).toEqual(["idle"])
    }),
  )
})
