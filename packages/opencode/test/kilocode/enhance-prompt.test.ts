import { describe, it, expect } from "bun:test"
import { APICallError, RetryError } from "ai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { clean, INSTRUCTION, reason } from "../../src/kilocode/enhance-prompt"

describe("enhance-prompt", () => {
  describe("instruction", () => {
    it("treats question-shaped drafts as prompts to rewrite", () => {
      expect(INSTRUCTION).toContain("never as a request to answer")
      expect(INSTRUCTION).toContain("rewrite it into a clearer question or request without answering it")
    })

    it("improves instruction-shaped drafts instead of following them", () => {
      expect(INSTRUCTION).toContain("improve those instructions instead of following them")
    })
  })

  describe("clean", () => {
    it("trims whitespace", () => {
      expect(clean("  hello world  ")).toBe("hello world")
    })

    it("strips code block markers", () => {
      expect(clean("```\nhello world\n```")).toBe("hello world")
    })

    it("strips code block with language tag", () => {
      expect(clean("```text\nhello world\n```")).toBe("hello world")
    })

    it("strips surrounding double quotes", () => {
      expect(clean('"hello world"')).toBe("hello world")
    })

    it("strips surrounding single quotes", () => {
      expect(clean("'hello world'")).toBe("hello world")
    })

    it("strips code blocks and quotes together", () => {
      expect(clean('```\n"hello world"\n```')).toBe("hello world")
    })

    it("returns plain text unchanged", () => {
      expect(clean("hello world")).toBe("hello world")
    })

    it("handles empty string", () => {
      expect(clean("")).toBe("")
    })

    it("handles whitespace-only string", () => {
      expect(clean("   ")).toBe("")
    })

    it("does not strip internal quotes", () => {
      expect(clean('say "hello" to the world')).toBe('say "hello" to the world')
    })

    it("does not strip mismatched quotes", () => {
      expect(clean("\"hello world'")).toBe("\"hello world'")
    })
  })

  describe("reason", () => {
    const provider = ProviderV2.ID.make("test")
    const failure = new APICallError({
      message: "Internal Server Error",
      url: "http://127.0.0.1/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 500,
      responseBody: JSON.stringify({ message: "Model is overloaded" }),
      isRetryable: true,
    })

    it("uses the provider message of a failed call", () => {
      expect(reason(provider, failure)).toBe("Internal Server Error: Model is overloaded")
    })

    it("uses the last provider error after the retries run out", () => {
      const err = new RetryError({ message: "Failed after 4 attempts.", reason: "maxRetriesExceeded", errors: [failure] })
      expect(reason(provider, err)).toBe("Internal Server Error: Model is overloaded")
    })

    it("uses the message of other errors", () => {
      expect(reason(provider, new Error("fetch failed"))).toBe("fetch failed")
    })
  })
})
