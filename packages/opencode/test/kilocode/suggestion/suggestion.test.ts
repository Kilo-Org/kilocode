import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { WithInstance } from "../../../src/project/with-instance"
import { Suggestion } from "../../../src/kilocode/suggestion"
import { tmpdir } from "../../fixture/fixture"

afterEach(() => {
  mock.restore()
})

describe("suggestion", () => {
  test("show adds pending request with blocking flag", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const pending = Suggestion.show({
          sessionID: "ses_test",
          text: "Run review?",
          blocking: false,
          actions: [{ label: "Start", description: "Run it", prompt: "/local-review-uncommitted" }],
        })

        const list = await Suggestion.list()
        expect(list).toHaveLength(1)
        expect(list[0]?.blocking).toBe(false)
        expect(list[0]?.text).toBe("Run review?")

        await Suggestion.dismiss(list[0]!.id)
        await expect(pending).rejects.toBeInstanceOf(Suggestion.DismissedError)
      },
    })
  })

  test("accept resolves selected action and removes pending request", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const ask = Suggestion.show({
          sessionID: "ses_test",
          text: "Next step?",
          actions: [
            { label: "Review", description: "Start review", prompt: "/local-review-uncommitted" },
            { label: "Test", description: "Run tests", prompt: "Run the relevant tests now." },
          ],
        })

        const list = await Suggestion.list()
        await Suggestion.accept({ requestID: list[0]!.id, index: 1 })

        await expect(ask).resolves.toEqual({
          label: "Test",
          description: "Run tests",
          prompt: "Run the relevant tests now.",
        })
        await expect(Suggestion.list()).resolves.toEqual([])
      },
    })
  })

  test("accept tracks suggestion telemetry with parsed slash command", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const track = spyOn(Telemetry, "trackSuggestionAccepted")
        const ask = Suggestion.show({
          sessionID: "ses_test",
          text: "Review changes?",
          actions: [{ label: "Review", prompt: "/local-review-uncommitted --focus tests" }],
        })

        const list = await Suggestion.list()
        await Suggestion.accept({ requestID: list[0]!.id, index: 0 })

        expect(track).toHaveBeenCalledTimes(1)
        expect(track).toHaveBeenCalledWith({
          sessionId: "ses_test",
          requestId: list[0]!.id,
          index: 0,
          tool: "suggest",
          command: "local-review-uncommitted",
          actionCount: 1,
        })
        await expect(ask).resolves.toEqual({ label: "Review", prompt: "/local-review-uncommitted --focus tests" })
      },
    })
  })

  test("show tracks review suggestion telemetry with parsed slash command", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const track = spyOn(Telemetry, "trackSuggestionShown")
        const ask = Suggestion.show({
          sessionID: "ses_test",
          text: "Review changes?",
          actions: [{ label: "Review", prompt: "/local-review-uncommitted --focus tests" }],
        })

        const list = await Suggestion.list()

        expect(track).toHaveBeenCalledTimes(1)
        expect(track).toHaveBeenCalledWith({
          sessionId: "ses_test",
          requestId: list[0]!.id,
          index: 0,
          tool: "suggest",
          command: "local-review-uncommitted",
          actionCount: 1,
        })

        await Suggestion.dismiss(list[0]!.id)
        await expect(ask).rejects.toBeInstanceOf(Suggestion.DismissedError)
      },
    })
  })

  test("show and accept parse local review arguments as local-review", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const shown = spyOn(Telemetry, "trackSuggestionShown")
        const accepted = spyOn(Telemetry, "trackSuggestionAccepted")
        const ask = Suggestion.show({
          sessionID: "ses_test",
          text: "Review release?",
          actions: [
            { label: "Review", prompt: "/local-review release -- focus on tests" },
            { label: "Skip", prompt: "Skip this review." },
          ],
        })

        const list = await Suggestion.list()

        expect(shown).toHaveBeenCalledTimes(1)
        expect(shown).toHaveBeenCalledWith({
          sessionId: "ses_test",
          requestId: list[0]!.id,
          index: 0,
          tool: "suggest",
          command: "local-review",
          actionCount: 2,
        })

        await Suggestion.accept({ requestID: list[0]!.id, index: 0 })

        expect(accepted).toHaveBeenCalledTimes(1)
        expect(accepted).toHaveBeenCalledWith({
          sessionId: "ses_test",
          requestId: list[0]!.id,
          index: 0,
          tool: "suggest",
          command: "local-review",
          actionCount: 2,
        })
        await expect(ask).resolves.toEqual({ label: "Review", prompt: "/local-review release -- focus on tests" })
      },
    })
  })

  test("non-review commands do not track suggestion telemetry", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const shown = spyOn(Telemetry, "trackSuggestionShown")
        const accepted = spyOn(Telemetry, "trackSuggestionAccepted")
        const ask = Suggestion.show({
          sessionID: "ses_test",
          text: "Run tests?",
          actions: [{ label: "Test", prompt: "/custom-project-command" }],
        })

        const list = await Suggestion.list()
        await Suggestion.accept({ requestID: list[0]!.id, index: 0 })

        expect(shown).toHaveBeenCalledTimes(0)
        expect(accepted).toHaveBeenCalledTimes(0)
        await expect(ask).resolves.toEqual({ label: "Test", prompt: "/custom-project-command" })
      },
    })
  })

  test("dismiss does not track accepted suggestion telemetry", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const shown = spyOn(Telemetry, "trackSuggestionShown")
        const accepted = spyOn(Telemetry, "trackSuggestionAccepted")
        const ask = Suggestion.show({
          sessionID: "ses_test",
          text: "Review changes?",
          actions: [{ label: "Review", prompt: "/local-review" }],
        })

        const list = await Suggestion.list()
        await Suggestion.dismiss(list[0]!.id)

        expect(shown).toHaveBeenCalledTimes(1)
        expect(accepted).toHaveBeenCalledTimes(0)
        await expect(ask).rejects.toBeInstanceOf(Suggestion.DismissedError)
      },
    })
  })

  test("invalid action index does not track accepted suggestion telemetry", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const shown = spyOn(Telemetry, "trackSuggestionShown")
        const accepted = spyOn(Telemetry, "trackSuggestionAccepted")
        const ask = Suggestion.show({
          sessionID: "ses_test",
          text: "Review changes?",
          actions: [{ label: "Review", prompt: "/local-review" }],
        })

        const list = await Suggestion.list()
        await expect(Suggestion.accept({ requestID: list[0]!.id, index: 1 })).resolves.toBe(false)

        expect(shown).toHaveBeenCalledTimes(1)
        expect(accepted).toHaveBeenCalledTimes(0)
        await expect(ask).rejects.toThrow("Invalid action index: 1")
      },
    })
  })

  test("dismiss rejects pending request and removes it", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const ask = Suggestion.show({
          sessionID: "ses_test",
          text: "Review changes?",
          actions: [{ label: "Start", prompt: "/local-review-uncommitted" }],
        })

        const list = await Suggestion.list()
        await Suggestion.dismiss(list[0]!.id)

        await expect(ask).rejects.toBeInstanceOf(Suggestion.DismissedError)
        await expect(Suggestion.list()).resolves.toEqual([])
      },
    })
  })

  test("dismissAll clears all pending suggestions for the target session", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        // Two suggestions for session A
        const a1 = Suggestion.show({
          sessionID: "ses_a",
          text: "Review?",
          actions: [{ label: "Go", prompt: "/review" }],
        })
        const a2 = Suggestion.show({
          sessionID: "ses_a",
          text: "Test?",
          actions: [{ label: "Run", prompt: "/test" }],
        })

        // One suggestion for session B
        const b1 = Suggestion.show({
          sessionID: "ses_b",
          text: "Deploy?",
          actions: [{ label: "Ship", prompt: "/deploy" }],
        })

        expect(await Suggestion.list()).toHaveLength(3)

        // Track whether B's promise settles
        let settled = false
        b1.then(() => {
          settled = true
        }).catch(() => {
          settled = true
        })

        // Dismiss all for session A only
        await Suggestion.dismissAll("ses_a")

        // Both A promises should reject
        await expect(a1).rejects.toBeInstanceOf(Suggestion.DismissedError)
        await expect(a2).rejects.toBeInstanceOf(Suggestion.DismissedError)

        // Flush microtasks to see if B settled
        await new Promise((r) => setTimeout(r, 10))
        expect(settled).toBe(false)

        // Only B's suggestion remains
        const remaining = await Suggestion.list()
        expect(remaining).toHaveLength(1)
        expect(remaining[0]?.sessionID).toBe("ses_b")

        // Clean up B
        await Suggestion.dismiss(remaining[0]!.id)
        await expect(b1).rejects.toBeInstanceOf(Suggestion.DismissedError)
      },
    })
  })

  test("dismissAll is a no-op when no suggestions exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        // Should not throw
        await Suggestion.dismissAll("ses_nonexistent")
        expect(await Suggestion.list()).toEqual([])
      },
    })
  })
})
