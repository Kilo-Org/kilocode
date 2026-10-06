import { describe, it, expect } from "bun:test"
import { HEADER_PROVIDER_ROUTING } from "@kilocode/kilo-gateway"
import { clean, headers, INSTRUCTION } from "../../src/kilocode/enhance-prompt"
import type { Provider } from "../../src/provider/provider"

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

  describe("headers", () => {
    const routing = { order: ["gmicloud/fp8"], only: ["gmicloud/fp8"], allow_fallbacks: false }
    const model = (npm: string) => ({ providerID: "kilo", api: { npm } }) as unknown as Provider.Model
    const decode = (result: Record<string, string>) => {
      const raw = result[HEADER_PROVIDER_ROUTING]
      return raw === undefined ? undefined : JSON.parse(decodeURIComponent(raw))
    }

    it("carries the model's routing to the gateway on every transport", () => {
      expect(decode(headers(model("@kilocode/kilo-gateway"), { provider: routing }))).toEqual(routing)
    })

    it("omits routing for other providers and models without it", () => {
      expect(decode(headers(model("@ai-sdk/openai"), { provider: routing }))).toBeUndefined()
      expect(decode(headers(model("@kilocode/kilo-gateway"), {}))).toBeUndefined()
    })
  })
})
