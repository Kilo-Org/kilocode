import { describe, it, expect } from "bun:test"
import {
  suggestionConsideredDuplication,
  postprocessAutocompleteSuggestion,
} from "../../src/services/autocomplete/classic-auto-complete/uselessSuggestionFilter"

describe("suggestionConsideredDuplication", () => {
  describe("DuplicatesFromPrefixOrSuffix", () => {
    it("filters empty suggestion", () => {
      expect(suggestionConsideredDuplication({ suggestion: "", prefix: "abc", suffix: "" })).toBe(true)
    })

    it("filters whitespace-only suggestion", () => {
      expect(suggestionConsideredDuplication({ suggestion: "   ", prefix: "abc", suffix: "" })).toBe(true)
    })

    it("filters suggestion already at end of prefix", () => {
      expect(
        suggestionConsideredDuplication({ suggestion: "return x", prefix: "function foo() {\n  return x", suffix: "" }),
      ).toBe(true)
    })

    it("filters suggestion already at start of suffix", () => {
      expect(
        suggestionConsideredDuplication({
          suggestion: "const y = 2",
          prefix: "const x = 1\n",
          suffix: "const y = 2\n",
        }),
      ).toBe(true)
    })

    it("passes unique suggestion not in prefix or suffix", () => {
      expect(
        suggestionConsideredDuplication({
          suggestion: "const result = x + y",
          prefix: "function add(x, y) {\n  ",
          suffix: "\n}",
        }),
      ).toBe(false)
    })
  })

  describe("DuplicatesFromEdgeLines (multiline)", () => {
    it("filters multiline when first line matches last prefix line", () => {
      expect(
        suggestionConsideredDuplication({
          suggestion: "  return x\n  return y",
          prefix: "function foo() {\n  return x",
          suffix: "\n}",
        }),
      ).toBe(true)
    })

    it("filters multiline when last line matches first suffix line", () => {
      expect(
        suggestionConsideredDuplication({
          suggestion: "const a = 1\nconst b = 2",
          prefix: "function setup() {\n",
          suffix: "const b = 2\n}",
        }),
      ).toBe(true)
    })

    it("does not treat single-line suggestion as edge-line duplicate", () => {
      expect(
        suggestionConsideredDuplication({
          suggestion: "const x = 1",
          prefix: "function foo() {\n",
          suffix: "const x = 2\n}",
        }),
      ).toBe(false)
    })
  })

  describe("containsRepetitivePhraseFromPrefix", () => {
    it("filters looping suggestion with repeated phrase", () => {
      const phrase = "the beginning. We are going to start from "
      const suggestion = phrase + phrase + phrase + phrase
      expect(
        suggestionConsideredDuplication({
          suggestion,
          prefix: "Let's start from ",
          suffix: "",
        }),
      ).toBe(true)
    })

    it("passes short suggestion without repetition", () => {
      expect(
        suggestionConsideredDuplication({
          suggestion: "const x = getValue()",
          prefix: "// compute\n",
          suffix: "",
        }),
      ).toBe(false)
    })
  })

  describe("normalizeToCompleteLine", () => {
    it("expands partial prefix tail + suffix head and detects duplication", () => {
      expect(
        suggestionConsideredDuplication({
          suggestion: "onst x = 1",
          prefix: "// line\nc",
          suffix: " // end\nmore",
        }),
      ).toBe(false)
    })
  })
})

describe("postprocessAutocompleteSuggestion", () => {
  it("returns undefined for duplicate suggestion", () => {
    const result = postprocessAutocompleteSuggestion({
      suggestion: "return x",
      prefix: "function foo() {\n  return x",
      suffix: "",
      model: "codestral",
    })
    expect(result).toBeUndefined()
  })

  it("returns the suggestion when it is unique", () => {
    const result = postprocessAutocompleteSuggestion({
      suggestion: "  return x + y;",
      prefix: "function add(x, y) {\n",
      suffix: "\n}",
      model: "codestral",
    })
    expect(result).toBe("  return x + y;")
  })

  it("returns undefined for empty suggestion", () => {
    const result = postprocessAutocompleteSuggestion({
      suggestion: "",
      prefix: "const x = ",
      suffix: "",
      model: "gpt-4",
    })
    expect(result).toBeUndefined()
  })
})
