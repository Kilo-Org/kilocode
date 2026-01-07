// kilocode_change - new file
import { describe, it, expect } from "vitest"
import { Fzf } from "../word-boundary-fzf"

describe("Fzf - Word Boundary Matching", () => {
	describe("Basic word boundary matching", () => {
		it("should match at word start", () => {
			const items = [
				{ id: 1, name: "fool org" },
				{ id: 2, name: "faoboc" },
				{ id: 3, name: "the fool" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("foo")

			// Should match "fool org" and "the fool" but NOT "faoboc"
			expect(results).toHaveLength(2)
			expect(results.map((r) => r.item.id)).toContain(1)
			expect(results.map((r) => r.item.id)).toContain(3)
			expect(results.map((r) => r.item.id)).not.toContain(2)
		})

		it("should match at text start", () => {
			const items = [
				{ id: 1, name: "foo bar" },
				{ id: 2, name: "the foo" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("foo")

			// Both should match, in original order
			expect(results).toHaveLength(2)
			expect(results[0].item.id).toBe(1)
			expect(results[1].item.id).toBe(2)
		})

		it("should not match when query is not at word boundary", () => {
			const items = [{ id: 1, name: "faoboc" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("foo")

			expect(results).toHaveLength(0)
		})
	})

	describe("Case insensitivity", () => {
		it("should match case-insensitively", () => {
			const items = [
				{ id: 1, name: "Foo Bar" },
				{ id: 2, name: "FOO BAZ" },
				{ id: 3, name: "foo qux" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("foo")

			expect(results).toHaveLength(3)
		})

		it("should handle mixed case queries", () => {
			const items = [{ id: 1, name: "foo bar" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("FoO")

			expect(results).toHaveLength(1)
		})
	})

	describe("Word separators", () => {
		it("should recognize space as word separator", () => {
			const items = [{ id: 1, name: "hello world" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("wor")

			expect(results).toHaveLength(1)
		})

		it("should recognize hyphen as word separator", () => {
			const items = [{ id: 1, name: "hello-world" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("wor")

			expect(results).toHaveLength(1)
		})

		it("should recognize underscore as word separator", () => {
			const items = [{ id: 1, name: "hello_world" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("wor")

			expect(results).toHaveLength(1)
		})

		it("should recognize slash as word separator", () => {
			const items = [{ id: 1, name: "hello/world" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("wor")

			expect(results).toHaveLength(1)
		})

		it("should recognize dot as word separator", () => {
			const items = [{ id: 1, name: "hello.world" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("wor")

			expect(results).toHaveLength(1)
		})
	})

	describe("Empty and whitespace queries", () => {
		it("should return all items for empty query", () => {
			const items = [
				{ id: 1, name: "foo" },
				{ id: 2, name: "bar" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("")

			expect(results).toHaveLength(2)
		})

		it("should return all items for whitespace-only query", () => {
			const items = [
				{ id: 1, name: "foo" },
				{ id: 2, name: "bar" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("   ")

			expect(results).toHaveLength(2)
		})
	})

	describe("Matching behavior", () => {
		it("should match exact word matches", () => {
			const items = [
				{ id: 1, name: "test" },
				{ id: 2, name: "testing" },
				{ id: 3, name: "the test" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("test")

			// Should match all three: "test" and "testing" at word start, and "the test" at word boundary
			expect(results).toHaveLength(3)
			expect(results[0].item.id).toBe(1)
			expect(results[1].item.id).toBe(2)
			expect(results[2].item.id).toBe(3)
		})

		it("should preserve original order", () => {
			const items = [
				{ id: 1, name: "foo bar" },
				{ id: 2, name: "bar foo" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("foo")

			// Both match, original order preserved
			expect(results).toHaveLength(2)
			expect(results[0].item.id).toBe(1)
			expect(results[1].item.id).toBe(2)
		})

		it("should match prefix queries", () => {
			const items = [
				{ id: 1, name: "foobar" },
				{ id: 2, name: "foo" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("foob")

			// "foobar" should match with "foob"
			expect(results).toHaveLength(1)
			expect(results[0].item.id).toBe(1)
		})
	})

	describe("Word boundary matching only", () => {
		it("should only match at word boundaries, not arbitrary substrings", () => {
			const items = [
				{ id: 1, name: "foo bar" },
				{ id: 2, name: "barfoo" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("foo")

			// Only "foo bar" should match (at word start), not "barfoo" (substring)
			expect(results).toHaveLength(1)
			expect(results[0].item.id).toBe(1)
		})
	})

	describe("Real-world use cases", () => {
		it("should work with mode selector options", () => {
			const items = [
				{ value: "code", label: "Code", description: "Write code" },
				{ value: "architect", label: "Architect", description: "Design systems" },
				{ value: "debug", label: "Debug", description: "Fix bugs" },
			]
			const fzf = new Fzf(items, {
				selector: (item) => [item.label, item.value].join(" "),
			})

			const results = fzf.find("cod")
			expect(results).toHaveLength(1)
			expect(results[0].item.value).toBe("code")
		})

		it("should find model names with hyphens when query contains hyphen", () => {
			const items = [
				{ id: 1, name: "OpenAI: gpt-5 mini" },
				{ id: 2, name: "OpenAI: gpt-4" },
				{ id: 3, name: "Anthropic: claude-3" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("gpt-5")
			// Should match "OpenAI: gpt-5 mini"
			expect(results).toHaveLength(1)
			expect(results[0].item.id).toBe(1)
		})

		it("should find model names with hyphens when query omits hyphen", () => {
			const items = [
				{ id: 1, name: "OpenAI: gpt-5 mini" },
				{ id: 2, name: "OpenAI: gpt-4" },
				{ id: 3, name: "Anthropic: claude-3" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("gpt5")
			// Should match "OpenAI: gpt-5 mini" (gpt + 5)
			expect(results).toHaveLength(1)
			expect(results[0].item.id).toBe(1)
		})

		it("should find model names when query has trailing hyphen", () => {
			const items = [
				{ id: 1, name: "OpenAI: gpt-5 mini" },
				{ id: 2, name: "OpenAI: gpt-4" },
				{ id: 3, name: "Anthropic: claude-3" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("gpt-")
			// Should match all gpt models
			expect(results).toHaveLength(2)
			expect(results.map((r) => r.item.id)).toContain(1)
			expect(results.map((r) => r.item.id)).toContain(2)
		})

		it("should work with file paths", () => {
			const items = [
				{ path: "src/components/ui/select-dropdown.tsx" },
				{ path: "src/lib/word-boundary-fzf.ts" },
				{ path: "src/services/code-index/manager.ts" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.path })

			const results = fzf.find("code")
			// Should match both "code-index" and potentially others
			expect(results.length).toBeGreaterThan(0)
			expect(results.some((r) => r.item.path.includes("code-index"))).toBe(true)
		})

		it("should handle multi-word searches", () => {
			const items = [{ name: "React Component" }, { name: "Vue Component" }, { name: "Angular Component" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("react")
			expect(results).toHaveLength(1)
			expect(results[0].item.name).toBe("React Component")
		})

		it("should match multi-word queries with all words present", () => {
			const items = [
				{ name: "Claude Sonnet 3.5" },
				{ name: "Claude Opus" },
				{ name: "GPT-4 Sonnet" },
				{ name: "Sonnet Model" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("claude sonnet")
			// Should only match items containing both "claude" AND "sonnet"
			expect(results).toHaveLength(1)
			expect(results[0].item.name).toBe("Claude Sonnet 3.5")
		})

		it("should not match if any word in multi-word query is missing", () => {
			const items = [{ name: "Claude Opus" }, { name: "GPT Sonnet" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("claude sonnet")
			// Neither item has both words
			expect(results).toHaveLength(0)
		})
	})

	describe("Acronym matching", () => {
		it("should match acronyms from word starts", () => {
			const items = [{ name: "Claude Sonnet" }, { name: "Claude Opus" }, { name: "GPT Sonnet" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("clso")
			// Should match "Claude Sonnet" (Cl + So)
			expect(results.length).toBeGreaterThan(0)
			expect(results.some((r) => r.item.name === "Claude Sonnet")).toBe(true)
		})

		it("should match partial acronyms", () => {
			const items = [{ name: "Claude Sonnet 3.5" }, { name: "Claude Opus" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("cls")
			// Should match "Claude Sonnet 3.5" (Cl + S)
			expect(results.length).toBeGreaterThan(0)
			expect(results.some((r) => r.item.name === "Claude Sonnet 3.5")).toBe(true)
		})

		it("should match both direct and acronym matches", () => {
			const items = [{ name: "clso tool" }, { name: "Claude Sonnet" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("clso")
			// Both should match, in original order
			expect(results).toHaveLength(2)
			expect(results[0].item.name).toBe("clso tool")
			expect(results[1].item.name).toBe("Claude Sonnet")
		})

		it("should not match if acronym letters are not at word starts", () => {
			const items = [{ name: "aclbso" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("clso")
			// Should not match because 'cl' and 'so' are not at word boundaries
			expect(results).toHaveLength(0)
		})
	})

	describe("Trimming and space handling", () => {
		it("should trim leading and trailing spaces from query", () => {
			const items = [
				{ id: 1, name: "foo bar" },
				{ id: 2, name: "foo" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			// Query with leading space should match same as without
			const resultsWithSpace = fzf.find(" foo")
			const resultsWithoutSpace = fzf.find("foo")

			expect(resultsWithSpace).toHaveLength(2)
			expect(resultsWithoutSpace).toHaveLength(2)
			expect(resultsWithSpace.map((r) => r.item.id)).toEqual(resultsWithoutSpace.map((r) => r.item.id))
		})

		it("should trim trailing spaces from query", () => {
			const items = [
				{ id: 1, name: "foo bar" },
				{ id: 2, name: "foo" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			// Query with trailing space should match same as without
			const resultsWithSpace = fzf.find("foo ")
			const resultsWithoutSpace = fzf.find("foo")

			expect(resultsWithSpace).toHaveLength(2)
			expect(resultsWithoutSpace).toHaveLength(2)
			expect(resultsWithSpace.map((r) => r.item.id)).toEqual(resultsWithoutSpace.map((r) => r.item.id))
		})

		it("should handle query with spaces on both sides", () => {
			const items = [{ id: 1, name: "foo bar" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("  foo  ")
			expect(results).toHaveLength(1)
			expect(results[0].item.id).toBe(1)
		})
	})

	describe("Backtracking for word matches (recursive)", () => {
		it("should match word that appears later in text", () => {
			const items = [
				{ id: 1, name: "google gemini" },
				{ id: 2, name: "gemini pro" },
				{ id: 3, name: "google em emini" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("gemini")
			// Should match both items
			expect(results).toHaveLength(3)
			expect(results.map((r) => r.item.id)).toContain(1)
			expect(results.map((r) => r.item.id)).toContain(2)
			expect(results.map((r) => r.item.id)).toContain(3)
		})

		it("should match partial word that appears later", () => {
			const items = [
				{ id: 1, name: "Microsoft Copilot" },
				{ id: 2, name: "GitHub Copilot" },
				{ id: 3, name: "Copilot Pro" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("copilot")
			// Should match all three items
			expect(results).toHaveLength(3)
		})

		it("should match when query word is not the first word", () => {
			const items = [
				{ id: 1, name: "The Quick Brown Fox" },
				{ id: 2, name: "Brown Bear" },
				{ id: 3, name: "Quick Start Guide" },
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("brown")
			// Should match items 1 and 2
			expect(results).toHaveLength(2)
			expect(results.map((r) => r.item.id)).toContain(1)
			expect(results.map((r) => r.item.id)).toContain(2)
		})

		it("should still respect word boundaries with backtracking", () => {
			const items = [
				{ id: 1, name: "google gemini" },
				{ id: 2, name: "googlegemini" }, // no space, not a word boundary
			]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("gemini")
			// Should only match item 1 where gemini is a separate word
			expect(results).toHaveLength(1)
			expect(results[0].item.id).toBe(1)
		})
	})

	describe("Edge cases", () => {
		it("should handle empty items array", () => {
			const fzf = new Fzf([], { selector: (item: any) => item.name })
			const results = fzf.find("foo")

			expect(results).toHaveLength(0)
		})

		it("should handle items with empty strings", () => {
			const items = [{ id: 1, name: "" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("foo")

			expect(results).toHaveLength(0)
		})

		it("should handle special characters in query", () => {
			const items = [{ id: 1, name: "foo-bar" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("foob")

			// Should match "foo-bar" with "foob" (foo + b from bar)
			expect(results).toHaveLength(1)
		})
	})

	describe("camelCase and PascalCase support", () => {
		it("should recognize camelCase as word boundary", () => {
			const items = [{ name: "gitRebase" }, { name: "newFile" }, { name: "httpRequest" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("gr")
			// Should match "gitRebase" (gr at word boundary)
			expect(results).toHaveLength(1)
			expect(results[0].item.name).toBe("gitRebase")
		})

		it("should match PascalCase acronyms", () => {
			const items = [{ name: "NewFileCreation" }, { name: "HttpRequest" }, { name: "APIClient" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("NFC")
			// Should match "NewFileCreation" (N + F + C)
			expect(results.length).toBeGreaterThan(0)
			expect(results.some((r) => r.item.name === "NewFileCreation")).toBe(true)
		})

		it("should handle mixed case scenarios", () => {
			const items = [{ name: "gitRebase" }, { name: "newFile" }, { name: "GitRebase" }, { name: "NewFile" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("GitR")
			// Should match both gitRebase and GitRebase
			expect(results.length).toBeGreaterThanOrEqual(2)
			expect(results.some((r) => r.item.name === "gitRebase")).toBe(true)
			expect(results.some((r) => r.item.name === "GitRebase")).toBe(true)
		})

		it("should split camelCase at uppercase transitions", () => {
			const items = [{ name: "parseMarkdownContent" }, { name: "renderHtmlTemplate" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })

			const results = fzf.find("pmc")
			// Should match "parseMarkdownContent" (P + M + C)
			expect(results.length).toBeGreaterThan(0)
			expect(results.some((r) => r.item.name === "parseMarkdownContent")).toBe(true)
		})
	})

	describe("API compatibility with fzf", () => {
		it("should return results with item property", () => {
			const items = [{ id: 1, name: "foo" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("foo")

			expect(results[0]).toHaveProperty("item")
			expect(results[0].item).toEqual({ id: 1, name: "foo" })
		})
	})
})
