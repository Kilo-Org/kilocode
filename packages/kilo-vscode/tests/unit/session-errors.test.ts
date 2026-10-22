import { describe, expect, it } from "bun:test"
import {
  errorIDs,
  preserveSessionErrors,
  visibleError,
  withoutResolvedSessionErrors,
} from "../../webview-ui/src/context/session-errors"
import type { Message } from "../../webview-ui/src/types/messages"

const base = {
  sessionID: "session",
  createdAt: "2026-01-01T00:00:00.000Z",
  time: { created: 1 },
}

const assistant = (id: string, error?: Message["error"]): Message => ({
  ...base,
  id,
  role: "assistant",
  error,
})

describe("errorIDs", () => {
  it("returns only message IDs with errors", () => {
    const messages = [
      assistant("message_1"),
      assistant("message_2", { name: "ProviderError" }),
      assistant("message_3", { name: "RateLimitError" }),
    ]

    expect(errorIDs(messages)).toEqual(["message_2", "message_3"])
  })
})

describe("visibleError", () => {
  it("hides only selected error messages", () => {
    const hidden = new Set(["message_2"])
    const messages = [
      assistant("message_1"),
      assistant("message_2", { name: "ProviderError" }),
      assistant("message_3", { name: "RateLimitError" }),
    ]

    expect(visibleError(messages, (id) => hidden.has(id))).toEqual({ name: "RateLimitError" })
  })

  it("ignores aborted assistant messages", () => {
    const messages = [assistant("message_1", { name: "MessageAbortedError" })]

    expect(visibleError(messages, () => false)).toBeUndefined()
  })
})

describe("session error reconciliation", () => {
  const error = {
    name: "APIError",
    data: { message: "prompt_cache_breakpoint is not supported on this model", isRetryable: false },
  }

  it("preserves transient errors across stale history replacements", () => {
    const user = { ...base, id: "message_1", role: "user" as const }
    const transient = { ...assistant("message_2", error), parentID: user.id, sessionErrorID: "event_1" }

    expect(preserveSessionErrors([user, transient], [user])).toEqual([user, transient])
  })

  it("replaces a transient error with its persisted assistant message", () => {
    const transient = { ...assistant("message_2", error), parentID: "message_1", sessionErrorID: "event_1" }
    const persisted = { ...assistant("message_3", error), parentID: "message_1" }

    expect(preserveSessionErrors([transient], [persisted])).toEqual([persisted])
    expect(withoutResolvedSessionErrors([transient], [persisted])).toEqual([])
  })

  it("deduplicates repeated delivery of the same session error event", () => {
    const first = { ...assistant("message_2", error), parentID: "message_1", sessionErrorID: "event_1" }
    const repeat = { ...assistant("message_3", error), parentID: "message_1", sessionErrorID: "event_1" }

    expect(withoutResolvedSessionErrors([first], [repeat])).toEqual([])
  })
})
