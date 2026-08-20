import { describe, expect, test } from "bun:test"
import { encodedBytes, MAX_BYTES, within } from "@/kilocode/session/media"
import type { ModelMessage } from "ai"

describe("Kilo session media budget", () => {
  test("counts encoded image data across all messages", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "file", mediaType: "image/png", data: "a".repeat(1_000_000) },
          { type: "file", mediaType: "text/plain", data: "b".repeat(5_000_000) },
        ],
      },
      {
        role: "user",
        content: [{ type: "image", image: "c".repeat(1_000_000) }],
      },
    ] satisfies ModelMessage[]

    expect(encodedBytes(messages)).toBe(2_000_000)
    expect(within(messages)).toBe(true)
  })

  test("rejects aggregate media above the request budget", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "image", image: "a".repeat(MAX_BYTES) }],
      },
    ] satisfies ModelMessage[]

    expect(encodedBytes(messages)).toBe(MAX_BYTES)
    expect(within(messages)).toBe(true)
    expect(
      within([
        {
          role: "user",
          content: [{ type: "image", image: "a".repeat(MAX_BYTES + 1) }],
        },
      ] satisfies ModelMessage[]),
    ).toBe(false)
  })
})
