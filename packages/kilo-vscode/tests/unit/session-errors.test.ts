import { describe, expect, it } from "bun:test"
import { errorIDs, visibleError } from "../../webview-ui/src/context/session-errors"
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
