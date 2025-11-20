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

			// Should match all three: "test", "testing" at word start, and "the test" at word boundary
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

	describe("API compatibility with fzf", () => {
		it("should return results with item property", () => {
			const items = [{ id: 1, name: "foo" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("foo")

			expect(results[0]).toHaveProperty("item")
			expect(results[0].item).toEqual({ id: 1, name: "foo" })
		})

		it("should return results with positions property", () => {
			const items = [{ id: 1, name: "foo" }]
			const fzf = new Fzf(items, { selector: (item) => item.name })
			const results = fzf.find("foo")

			expect(results[0]).toHaveProperty("positions")
			expect(results[0].positions).toBeInstanceOf(Set)
		})
	})
})
