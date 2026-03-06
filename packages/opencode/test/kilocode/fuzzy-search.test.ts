import { test, expect, describe } from "bun:test"
import { search } from "../../src/kilocode/fuzzy-search"

const models = [
  { title: "Claude Sonnet 4", category: "Anthropic" },
  { title: "Claude Haiku 3.5", category: "Anthropic" },
  { title: "GPT-4o", category: "OpenAI" },
  { title: "Claude Opus 4", category: "Anthropic" },
  { title: "Gemini 2.5 Pro", category: "Google" },
  { title: "o3", category: "OpenAI" },
  { title: "Llama 4 Scout", category: "Meta" },
  { title: "DeepSeek V3", category: "DeepSeek" },
]

describe("fuzzy-search", () => {
  describe("exact and substring matching", () => {
    test("exact model name returns the model", () => {
      const results = search("Claude Sonnet 4", models)
      expect(results[0]!.title).toBe("Claude Sonnet 4")
    })

    test("partial model name matches", () => {
      const results = search("sonnet", models)
      expect(results[0]!.title).toBe("Claude Sonnet 4")
    })

    test("category name matches all models in category", () => {
      const results = search("claude", models)
      const titles = results.map((r) => r.title)
      expect(titles).toContain("Claude Sonnet 4")
      expect(titles).toContain("Claude Haiku 3.5")
      expect(titles).toContain("Claude Opus 4")
    })
  })

  describe("out-of-order multi-word queries", () => {
    test("reversed partial words match", () => {
      const results = search("claud sont", models)
      expect(results[0]!.title).toBe("Claude Sonnet 4")
    })

    test("fully reversed words match", () => {
      const results = search("sonnet claude", models)
      expect(results[0]!.title).toBe("Claude Sonnet 4")
    })

    test("category + title cross-field search", () => {
      const results = search("anthropic opus", models)
      expect(results[0]!.title).toBe("Claude Opus 4")
    })

    test("category + title reversed", () => {
      const results = search("meta llama", models)
      expect(results[0]!.title).toBe("Llama 4 Scout")
    })
  })

  describe("typo tolerance", () => {
    test("transposed characters match", () => {
      const results = search("cluade", models)
      const titles = results.map((r) => r.title)
      expect(titles).toContain("Claude Sonnet 4")
      expect(titles).toContain("Claude Haiku 3.5")
      expect(titles).toContain("Claude Opus 4")
    })

    test("doubled character typo matches", () => {
      const results = search("gptt", models)
      expect(results[0]!.title).toBe("GPT-4o")
    })

    test("missing vowel matches", () => {
      const results = search("hiku", models)
      expect(results[0]!.title).toBe("Claude Haiku 3.5")
    })

    test("typo in multi-word query matches", () => {
      const results = search("opnai gpt", models)
      expect(results[0]!.title).toBe("GPT-4o")
    })

    test("partial with number matches", () => {
      const results = search("deep v3", models)
      expect(results[0]!.title).toBe("DeepSeek V3")
    })
  })

  describe("edge cases", () => {
    test("empty query returns all items in original order", () => {
      const results = search("", models)
      expect(results).toEqual(models)
    })

    test("whitespace-only query returns all items", () => {
      const results = search("   ", models)
      expect(results).toEqual(models)
    })

    test("gibberish returns no results", () => {
      const results = search("xyzabc", models)
      expect(results).toHaveLength(0)
    })

    test("single character query works", () => {
      const results = search("o", models)
      expect(results.length).toBeGreaterThan(0)
    })

    test("handles items without category", () => {
      const items = [{ title: "Test Model" }, { title: "Other Model", category: "Provider" }]
      const results = search("test", items)
      expect(results[0]!.title).toBe("Test Model")
    })

    test("no separator matches (gpt4 -> GPT-4o)", () => {
      const results = search("gpt4", models)
      expect(results[0]!.title).toBe("GPT-4o")
    })
  })

  describe("ranking quality", () => {
    test("exact word match ranks above partial match", () => {
      const results = search("opus", models)
      expect(results[0]!.title).toBe("Claude Opus 4")
    })

    test("title match ranks above category-only match", () => {
      const items = [
        { title: "Foo", category: "Claude" },
        { title: "Claude Bar", category: "Other" },
      ]
      const results = search("claude", items)
      expect(results[0]!.title).toBe("Claude Bar")
    })

    test("closer match ranks higher", () => {
      const results = search("gem pro", models)
      expect(results[0]!.title).toBe("Gemini 2.5 Pro")
    })
  })
})
