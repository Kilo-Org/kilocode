import { describe, expect, test } from "bun:test"
import { normalizeUsageForExport } from "@/session/llm"

describe("session export llm usage", () => {
  test("handles providers that omit token detail fields", () => {
    expect(normalizeUsageForExport({ inputTokens: 3, outputTokens: 5 })).toEqual({
      inputTokens: 3,
      outputTokens: 5,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    })
  })
})
