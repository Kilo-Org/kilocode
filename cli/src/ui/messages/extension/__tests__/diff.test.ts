import { describe, it, expect } from "vitest"
import {
	parseDiffContent,
	calculateDiffStats,
	parseInsertContent,
	isUnifiedDiffFormat,
	parseNewFileContent,
	formatDiffSummary,
	type ParsedDiffLine,
	type DiffStats,
} from "../diff.js"

describe("parseDiffContent", () => {
	describe("unified diff format", () => {
		it("should parse a simple unified diff", () => {
			const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line 1
-old line 2
+new line 2
 line 3`

			const result = parseDiffContent(diff)

			expect(result).toHaveLength(7)
			expect(result[0]).toEqual({ type: "header", content: "--- a/file.txt" })
			expect(result[1]).toEqual({ type: "header", content: "+++ b/file.txt" })
			expect(result[2]).toEqual({ type: "header", content: "@@ -1,3 +1,3 @@" })
			expect(result[3]).toEqual({ type: "context", content: "line 1", oldLineNum: 1, newLineNum: 1 })
			expect(result[4]).toEqual({ type: "deletion", content: "old line 2", oldLineNum: 2 })
			expect(result[5]).toEqual({ type: "addition", content: "new line 2", newLineNum: 2 })
			expect(result[6]).toEqual({ type: "context", content: "line 3", oldLineNum: 3, newLineNum: 3 })
		})

		it("should handle multiple hunks", () => {
			const diff = `@@ -1,2 +1,2 @@
-old1
+new1
@@ -10,2 +10,2 @@
-old10
+new10`

			const result = parseDiffContent(diff)

			// First hunk
			expect(result[0]).toEqual({ type: "header", content: "@@ -1,2 +1,2 @@" })
			expect(result[1]).toEqual({ type: "deletion", content: "old1", oldLineNum: 1 })
			expect(result[2]).toEqual({ type: "addition", content: "new1", newLineNum: 1 })

			// Second hunk
			expect(result[3]).toEqual({ type: "header", content: "@@ -10,2 +10,2 @@" })
			expect(result[4]).toEqual({ type: "deletion", content: "old10", oldLineNum: 10 })
			expect(result[5]).toEqual({ type: "addition", content: "new10", newLineNum: 10 })
		})

		it("should return empty array for empty input", () => {
			expect(parseDiffContent("")).toEqual([])
		})
	})

	describe("SEARCH/REPLACE format", () => {
		it("should parse a simple SEARCH/REPLACE block without markers", () => {
			const startLineMarker = ":start" + "_line:5"
			const diff = `<<<<<<< SEARCH
${startLineMarker}
-------
old content
=======
new content
>>>>>>> REPLACE`

			const result = parseDiffContent(diff)

			// Markers are now filtered out - only actual code changes are returned
			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({ type: "deletion", content: "old content", oldLineNum: 5 })
			expect(result[1]).toEqual({ type: "addition", content: "new content", newLineNum: 5 })
		})

		it("should handle multi-line SEARCH/REPLACE", () => {
			const startLineMarker = ":start" + "_line:1"
			const diff = `<<<<<<< SEARCH
${startLineMarker}
-------
line 1
line 2
=======
new line 1
new line 2
new line 3
>>>>>>> REPLACE`

			const result = parseDiffContent(diff)

			// Count deletions and additions
			const deletions = result.filter((l) => l.type === "deletion")
			const additions = result.filter((l) => l.type === "addition")

			expect(deletions).toHaveLength(2)
			expect(additions).toHaveLength(3)

			// Check line numbers
			expect(deletions[0].oldLineNum).toBe(1)
			expect(deletions[1].oldLineNum).toBe(2)
			expect(additions[0].newLineNum).toBe(1)
			expect(additions[1].newLineNum).toBe(2)
			expect(additions[2].newLineNum).toBe(3)
		})

		it("should handle SEARCH/REPLACE without start_line", () => {
			const diff = `<<<<<<< SEARCH
-------
old
=======
new
>>>>>>> REPLACE`

			const result = parseDiffContent(diff)

			const deletions = result.filter((l) => l.type === "deletion")
			const additions = result.filter((l) => l.type === "addition")

			expect(deletions).toHaveLength(1)
			expect(additions).toHaveLength(1)
			expect(deletions[0].oldLineNum).toBe(1) // Default to line 1
			expect(additions[0].newLineNum).toBe(1)
		})
	})

	describe("edge cases", () => {
		it("should handle hunk header without count (e.g., @@ -5 +5 @@)", () => {
			const diff = `@@ -5 +5 @@
-old line
+new line`

			const result = parseDiffContent(diff)

			expect(result[0]).toEqual({ type: "header", content: "@@ -5 +5 @@" })
			expect(result[1]).toEqual({ type: "deletion", content: "old line", oldLineNum: 5 })
			expect(result[2]).toEqual({ type: "addition", content: "new line", newLineNum: 5 })
		})

		it("should handle lines without standard prefix as context", () => {
			const diff = `@@ -1,2 +1,2 @@
no prefix line
-deleted
+added`

			const result = parseDiffContent(diff)

			// Line without prefix should be treated as context
			expect(result[1]).toEqual({ type: "context", content: "no prefix line" })
			expect(result[2]).toEqual({ type: "deletion", content: "deleted", oldLineNum: 1 })
			expect(result[3]).toEqual({ type: "addition", content: "added", newLineNum: 1 })
		})

		it("should handle consecutive deletions followed by consecutive additions", () => {
			const diff = `@@ -1,4 +1,4 @@
-old1
-old2
-old3
+new1
+new2
+new3`

			const result = parseDiffContent(diff)

			const deletions = result.filter((l) => l.type === "deletion")
			const additions = result.filter((l) => l.type === "addition")

			expect(deletions).toHaveLength(3)
			expect(additions).toHaveLength(3)
			expect(deletions[0].oldLineNum).toBe(1)
			expect(deletions[1].oldLineNum).toBe(2)
			expect(deletions[2].oldLineNum).toBe(3)
			expect(additions[0].newLineNum).toBe(1)
			expect(additions[1].newLineNum).toBe(2)
			expect(additions[2].newLineNum).toBe(3)
		})

		it("should handle empty SEARCH block (addition only)", () => {
			const startLineMarker = ":start" + "_line:10"
			const diff = `<<<<<<< SEARCH
${startLineMarker}
-------
=======
new content line 1
new content line 2
>>>>>>> REPLACE`

			const result = parseDiffContent(diff)

			// Markers are filtered out - only actual code changes
			const deletions = result.filter((l) => l.type === "deletion")
			const additions = result.filter((l) => l.type === "addition")

			expect(deletions).toHaveLength(0)
			expect(additions).toHaveLength(2)
			expect(additions[0].newLineNum).toBe(10)
			expect(additions[1].newLineNum).toBe(11)
		})

		it("should handle empty REPLACE block (deletion only)", () => {
			const startLineMarker = ":start" + "_line:5"
			const diff = `<<<<<<< SEARCH
${startLineMarker}
-------
line to delete 1
line to delete 2
=======
>>>>>>> REPLACE`

			const result = parseDiffContent(diff)

			// Markers are filtered out - only actual code changes
			const deletions = result.filter((l) => l.type === "deletion")
			const additions = result.filter((l) => l.type === "addition")

			expect(deletions).toHaveLength(2)
			expect(additions).toHaveLength(0)
			expect(deletions[0].oldLineNum).toBe(5)
			expect(deletions[1].oldLineNum).toBe(6)
		})

		it("should handle content before SEARCH/REPLACE blocks as context", () => {
			const startLineMarker = ":start" + "_line:1"
			const diff = `Some preamble text
<<<<<<< SEARCH
${startLineMarker}
-------
old
=======
new
>>>>>>> REPLACE
Some trailing text`

			const result = parseDiffContent(diff)

			// Markers are filtered out - only context and actual code changes
			// First line should be context
			expect(result[0]).toEqual({ type: "context", content: "Some preamble text" })
			// Last line should be context
			expect(result[result.length - 1]).toEqual({ type: "context", content: "Some trailing text" })
		})

		it("should handle malformed start_line directive gracefully", () => {
			const startLineMarker = ":start" + "_line:abc"
			const diff = `<<<<<<< SEARCH
${startLineMarker}
-------
old content
=======
new content
>>>>>>> REPLACE`

			const result = parseDiffContent(diff)

			// Markers are filtered out - only actual code changes
			// Should still parse, defaulting to line 1 when parsing fails
			const deletions = result.filter((l) => l.type === "deletion")
			const additions = result.filter((l) => l.type === "addition")

			expect(deletions).toHaveLength(1)
			expect(additions).toHaveLength(1)
			// NaN from parseInt should result in default behavior
			expect(deletions[0].oldLineNum).toBe(1)
		})
	})
})

describe("calculateDiffStats", () => {
	it("should count additions and deletions", () => {
		const lines: ParsedDiffLine[] = [
			{ type: "header", content: "@@ -1,3 +1,4 @@" },
			{ type: "context", content: "unchanged" },
			{ type: "deletion", content: "removed 1" },
			{ type: "deletion", content: "removed 2" },
			{ type: "addition", content: "added 1" },
			{ type: "addition", content: "added 2" },
			{ type: "addition", content: "added 3" },
		]

		const stats = calculateDiffStats(lines)

		expect(stats.added).toBe(3)
		expect(stats.removed).toBe(2)
	})

	it("should return zeros for empty input", () => {
		const stats = calculateDiffStats([])

		expect(stats.added).toBe(0)
		expect(stats.removed).toBe(0)
	})

	it("should handle only additions", () => {
		const lines: ParsedDiffLine[] = [
			{ type: "addition", content: "new 1" },
			{ type: "addition", content: "new 2" },
		]

		const stats = calculateDiffStats(lines)

		expect(stats.added).toBe(2)
		expect(stats.removed).toBe(0)
	})

	it("should handle only deletions", () => {
		const lines: ParsedDiffLine[] = [
			{ type: "deletion", content: "old 1" },
			{ type: "deletion", content: "old 2" },
		]

		const stats = calculateDiffStats(lines)

		expect(stats.added).toBe(0)
		expect(stats.removed).toBe(2)
	})

	it("should ignore markers and headers", () => {
		const lines: ParsedDiffLine[] = [
			{ type: "marker", content: "<<<<<<< SEARCH" },
			{ type: "header", content: "@@ -1,1 +1,1 @@" },
			{ type: "context", content: "unchanged" },
		]

		const stats = calculateDiffStats(lines)

		expect(stats.added).toBe(0)
		expect(stats.removed).toBe(0)
	})
})

describe("formatDiffSummary", () => {
	describe("full format (default)", () => {
		it("should format additions and removals", () => {
			const stats: DiffStats = { added: 5, removed: 3 }
			expect(formatDiffSummary(stats)).toBe("⎿ +5, -3")
		})

		it("should format additions only", () => {
			const stats: DiffStats = { added: 5, removed: 0 }
			expect(formatDiffSummary(stats)).toBe("⎿ +5")
		})

		it("should format removals only", () => {
			const stats: DiffStats = { added: 0, removed: 3 }
			expect(formatDiffSummary(stats)).toBe("⎿ -3")
		})

		it("should return empty string for no changes", () => {
			const stats: DiffStats = { added: 0, removed: 0 }
			expect(formatDiffSummary(stats)).toBe("")
		})
	})

	describe("additions-only format", () => {
		it("should format additions with 'lines' suffix", () => {
			const stats: DiffStats = { added: 5, removed: 0 }
			expect(formatDiffSummary(stats, "additions-only")).toBe("⎿ +5 lines")
		})

		it("should ignore removals in additions-only format", () => {
			const stats: DiffStats = { added: 5, removed: 3 }
			expect(formatDiffSummary(stats, "additions-only")).toBe("⎿ +5 lines")
		})

		it("should return empty string for no additions", () => {
			const stats: DiffStats = { added: 0, removed: 3 }
			expect(formatDiffSummary(stats, "additions-only")).toBe("")
		})
	})
})

describe("parseInsertContent", () => {
	it("should parse raw content as additions starting at specified line", () => {
		const content = `line 1
line 2
line 3`

		const result = parseInsertContent(content, 10)

		expect(result).toHaveLength(3)
		expect(result[0]).toEqual({ type: "addition", content: "line 1", newLineNum: 10 })
		expect(result[1]).toEqual({ type: "addition", content: "line 2", newLineNum: 11 })
		expect(result[2]).toEqual({ type: "addition", content: "line 3", newLineNum: 12 })
	})

	it("should default to line 1 when no start line specified", () => {
		const content = "single line"

		const result = parseInsertContent(content)

		expect(result).toHaveLength(1)
		expect(result[0]).toEqual({ type: "addition", content: "single line", newLineNum: 1 })
	})

	it("should return empty array for empty content", () => {
		expect(parseInsertContent("")).toEqual([])
	})

	it("should handle content with empty lines", () => {
		const content = `first

third`

		const result = parseInsertContent(content, 5)

		expect(result).toHaveLength(3)
		expect(result[0]).toEqual({ type: "addition", content: "first", newLineNum: 5 })
		expect(result[1]).toEqual({ type: "addition", content: "", newLineNum: 6 })
		expect(result[2]).toEqual({ type: "addition", content: "third", newLineNum: 7 })
	})

	it("should handle single line content", () => {
		const result = parseInsertContent("only one line", 42)

		expect(result).toHaveLength(1)
		expect(result[0]).toEqual({ type: "addition", content: "only one line", newLineNum: 42 })
	})

	it("should handle line number 0 (end of file indicator)", () => {
		const result = parseInsertContent("appended line", 0)

		expect(result).toHaveLength(1)
		// Line 0 should be treated as-is (caller handles "end" display)
		expect(result[0]).toEqual({ type: "addition", content: "appended line", newLineNum: 0 })
	})
})

describe("isUnifiedDiffFormat", () => {
	it("should return true for content with hunk headers (@@)", () => {
		expect(isUnifiedDiffFormat("@@ -1,3 +1,3 @@\n-old\n+new")).toBe(true)
		expect(isUnifiedDiffFormat("some text\n@@ -5 +5 @@")).toBe(true)
	})

	it("should return true for content starting with file header (---)", () => {
		expect(isUnifiedDiffFormat("--- a/file.txt\n+++ b/file.txt")).toBe(true)
	})

	it("should return false for raw content without diff markers", () => {
		expect(isUnifiedDiffFormat("just some text")).toBe(false)
		expect(isUnifiedDiffFormat("line 1\nline 2\nline 3")).toBe(false)
	})

	it("should return false for SEARCH/REPLACE format", () => {
		expect(isUnifiedDiffFormat("<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE")).toBe(false)
	})

	it("should return false for empty string", () => {
		expect(isUnifiedDiffFormat("")).toBe(false)
	})

	it("should handle --- in middle of content (not at start)", () => {
		// --- must be at start to be considered a file header
		expect(isUnifiedDiffFormat("some text\n--- not a header")).toBe(false)
	})
})

describe("parseNewFileContent", () => {
	it("should parse unified diff format when detected", () => {
		const diff = `--- a/file.txt
+++ b/file.txt
@@ -0,0 +1,2 @@
+line 1
+line 2`

		const result = parseNewFileContent(diff)

		// Should use parseDiffContent for unified diff
		expect(result.some((l) => l.type === "header")).toBe(true)
		const additions = result.filter((l) => l.type === "addition")
		expect(additions).toHaveLength(2)
	})

	it("should parse raw content as additions when not unified diff", () => {
		const content = `line 1
line 2
line 3`

		const result = parseNewFileContent(content)

		expect(result).toHaveLength(3)
		expect(result[0]).toEqual({ type: "addition", content: "line 1", newLineNum: 1 })
		expect(result[1]).toEqual({ type: "addition", content: "line 2", newLineNum: 2 })
		expect(result[2]).toEqual({ type: "addition", content: "line 3", newLineNum: 3 })
	})

	it("should return empty array for empty content", () => {
		expect(parseNewFileContent("")).toEqual([])
	})

	it("should start line numbers at 1 for raw content", () => {
		const result = parseNewFileContent("single line")

		expect(result).toHaveLength(1)
		expect(result[0].newLineNum).toBe(1)
	})

	it("should handle content with @@ in middle (not a hunk header)", () => {
		// @@ anywhere in content triggers unified diff detection
		const content = "email@@domain.com"

		const result = parseNewFileContent(content)

		// This will be detected as unified diff format due to @@
		// but parseDiffContent will handle it gracefully
		expect(result.length).toBeGreaterThan(0)
	})
})

describe("parseDiffContent - partial/streaming markers", () => {
	describe("should filter out partial SEARCH/REPLACE markers from streaming", () => {
		it("should filter partial start marker '<<<<'", () => {
			const searchMarker = "<<<<<<< SEARCH"
			const replaceMarker = ">>>>>>> REPLACE"
			const separator = "======="
			const diff = `${searchMarker}
-------
old content
${separator}
new content
${replaceMarker}
<<<<`

			const result = parseDiffContent(diff)

			// Should not contain the partial marker '<<<<'
			const hasPartialMarker = result.some((l) => l.content.includes("<<<<"))
			expect(hasPartialMarker).toBe(false)

			// Should still have the actual diff content
			const deletions = result.filter((l) => l.type === "deletion")
			const additions = result.filter((l) => l.type === "addition")
			expect(deletions).toHaveLength(1)
			expect(additions).toHaveLength(1)
		})

		it("should filter incomplete start marker '<<<<<<< S'", () => {
			const searchMarker = "<<<<<<< SEARCH"
			const replaceMarker = ">>>>>>> REPLACE"
			const separator = "======="
			const diff = `${searchMarker}
-------
old content
${separator}
new content
${replaceMarker}
<<<<<<< S`

			const result = parseDiffContent(diff)

			// Should not contain the incomplete marker
			const hasIncompleteMarker = result.some((l) => l.content === "<<<<<<< S")
			expect(hasIncompleteMarker).toBe(false)
		})

		it("should filter partial end marker '>>>>>>'", () => {
			const searchMarker = "<<<<<<< SEARCH"
			const separator = "======="
			const diff = `${searchMarker}
-------
old content
${separator}
new content
>>>>>>`

			const result = parseDiffContent(diff)

			// Should not contain the partial marker '>>>>>>'
			const hasPartialMarker = result.some((l) => l.content === ">>>>>>")
			expect(hasPartialMarker).toBe(false)

			// Should still have the actual diff content
			const deletions = result.filter((l) => l.type === "deletion")
			const additions = result.filter((l) => l.type === "addition")
			expect(deletions).toHaveLength(1)
			expect(additions).toHaveLength(1)
		})

		it("should filter content that is only partial markers", () => {
			// This simulates streaming where only partial content has arrived
			const diff = `<<<<<<< S`

			const result = parseDiffContent(diff)

			// Should return empty or filter out the partial marker
			const hasPartialMarker = result.some((l) => l.content.startsWith("<<<<"))
			expect(hasPartialMarker).toBe(false)
		})

		it("should handle multiple partial markers in streaming content", () => {
			const searchMarker = "<<<<<<< SEARCH"
			const replaceMarker = ">>>>>>> REPLACE"
			const separator = "======="
			const diff = `${searchMarker}
-------
old line 1
old line 2
${separator}
new line 1
${replaceMarker}
<<<<
<<<<<<< S
>>>>>>`

			const result = parseDiffContent(diff)

			// Should not contain any partial markers
			const hasPartialStartMarker = result.some(
				(l) => l.content.startsWith("<<<<") && !l.content.startsWith("<<<<<<< SEARCH"),
			)
			const hasPartialEndMarker = result.some(
				(l) => l.content.startsWith(">>>>") && !l.content.startsWith(">>>>>>> REPLACE"),
			)
			expect(hasPartialStartMarker).toBe(false)
			expect(hasPartialEndMarker).toBe(false)

			// Should still have the actual diff content
			const deletions = result.filter((l) => l.type === "deletion")
			const additions = result.filter((l) => l.type === "addition")
			expect(deletions).toHaveLength(2)
			expect(additions).toHaveLength(1)
		})

		it("should handle trailing partial marker after valid diff", () => {
			// Real-world case from the bug report
			const searchMarker = "<<<<<<< SEARCH"
			const separator = "======="
			const diff = `${searchMarker}
-------
"hint": "Prem Enter per enviar, Shift+Enter per nova línia",
"addImage": "Add image",
"removeImage": "Remove image"
${separator}
"hint": "Prem Enter per enviar, Shift+Enter per nova línia",
"addImage": "Afegir imatge",
"removeImage": "Eliminar imatge"
>>>>>>`

			const result = parseDiffContent(diff)

			// Should not contain the partial marker
			const hasPartialMarker = result.some((l) => l.content === ">>>>>>")
			expect(hasPartialMarker).toBe(false)

			// Should have the correct number of changes
			const deletions = result.filter((l) => l.type === "deletion")
			const additions = result.filter((l) => l.type === "addition")
			expect(deletions).toHaveLength(3)
			expect(additions).toHaveLength(3)
		})

		it("should handle content with only '<<<<' (no complete SEARCH marker)", () => {
			// When streaming starts and only partial marker has arrived
			const diff = `<<<<`

			const result = parseDiffContent(diff)

			// Should filter out the partial marker
			expect(result.every((l) => !l.content.includes("<<<<"))).toBe(true)
		})

		it("should not filter legitimate content that happens to start with < or >", () => {
			const searchMarker = "<<<<<<< SEARCH"
			const replaceMarker = ">>>>>>> REPLACE"
			const separator = "======="
			const diff = `${searchMarker}
-------
<div>old content</div>
${separator}
<div>new content</div>
${replaceMarker}`

			const result = parseDiffContent(diff)

			// Should preserve the HTML content
			const deletions = result.filter((l) => l.type === "deletion")
			const additions = result.filter((l) => l.type === "addition")
			expect(deletions).toHaveLength(1)
			expect(additions).toHaveLength(1)
			expect(deletions[0].content).toBe("<div>old content</div>")
			expect(additions[0].content).toBe("<div>new content</div>")
		})

		it("should handle partial equals marker", () => {
			const searchMarker = "<<<<<<< SEARCH"
			const diff = `${searchMarker}
-------
old content
===`

			const result = parseDiffContent(diff)

			// Partial equals should be filtered if it looks like a marker
			// But actual content with === should be preserved
			const deletions = result.filter((l) => l.type === "deletion")
			expect(deletions).toHaveLength(1)
			expect(deletions[0].content).toBe("old content")
		})

		it("should filter git merge conflict start marker '<<<<<<< Updated upstream'", () => {
			const searchMarker = "<<<<<<< SEARCH"
			const replaceMarker = ">>>>>>> REPLACE"
			const separator = "======="
			const diff = `${searchMarker}
-------
old content
${separator}
new content
${replaceMarker}
<<<<<<< Updated upstream`

			const result = parseDiffContent(diff)

			// Should not contain the git conflict marker
			const hasGitMarker = result.some((l) => l.content.includes("<<<<<<< Updated upstream"))
			expect(hasGitMarker).toBe(false)

			// Should still have the actual diff content
			const deletions = result.filter((l) => l.type === "deletion")
			const additions = result.filter((l) => l.type === "addition")
			expect(deletions).toHaveLength(1)
			expect(additions).toHaveLength(1)
		})

		it("should filter git merge conflict end marker '>>>>>>> Stashed changes'", () => {
			const searchMarker = "<<<<<<< SEARCH"
			const replaceMarker = ">>>>>>> REPLACE"
			const separator = "======="
			const diff = `${searchMarker}
-------
old content
${separator}
new content
${replaceMarker}
>>>>>>> Stashed changes`

			const result = parseDiffContent(diff)

			// Should not contain the git conflict marker
			const hasGitMarker = result.some((l) => l.content.includes(">>>>>>> Stashed changes"))
			expect(hasGitMarker).toBe(false)

			// Should still have the actual diff content
			const deletions = result.filter((l) => l.type === "deletion")
			const additions = result.filter((l) => l.type === "addition")
			expect(deletions).toHaveLength(1)
			expect(additions).toHaveLength(1)
		})

		it("should filter git merge conflict marker '<<<<<<< HEAD'", () => {
			const diff = `<<<<<<< HEAD`

			const result = parseDiffContent(diff)

			// Should filter out the git conflict marker
			const hasGitMarker = result.some((l) => l.content.includes("<<<<<<< HEAD"))
			expect(hasGitMarker).toBe(false)
		})

		it("should filter git merge conflict marker with branch name '>>>>>>> feature/branch-name'", () => {
			const searchMarker = "<<<<<<< SEARCH"
			const replaceMarker = ">>>>>>> REPLACE"
			const separator = "======="
			const diff = `${searchMarker}
-------
old content
${separator}
new content
${replaceMarker}
>>>>>>> feature/branch-name`

			const result = parseDiffContent(diff)

			// Should not contain the git conflict marker
			const hasGitMarker = result.some((l) => l.content.includes(">>>>>>> feature/branch-name"))
			expect(hasGitMarker).toBe(false)
		})
	})
})

describe("parseDiffContent - unified diff format with git conflict markers", () => {
	it("should filter git conflict markers from unified diff deletions", () => {
		const diff = `@@ -10,7 +10,3 @@
 import { logs } from "../../services/logs.js"
-<<<<<<< Updated upstream
-=======
-import { convertImagesToDataUrls } from "../../media/image-utils.js"
->>>>>>> Stashed changes
 
 export interface StdinMessage {`

		const result = parseDiffContent(diff)

		// Should not contain any git conflict markers
		const hasGitMarker = result.some(
			(l) =>
				l.content.includes("<<<<<<< Updated upstream") ||
				l.content.includes(">>>>>>> Stashed changes") ||
				l.content === "=======",
		)
		expect(hasGitMarker).toBe(false)

		// Should still have the legitimate content
		const hasLegitimateContent = result.some((l) => l.content.includes("import { logs }"))
		expect(hasLegitimateContent).toBe(true)
	})

	it("should filter git conflict markers from unified diff additions", () => {
		const diff = `@@ -1,3 +1,7 @@
 line 1
+<<<<<<< HEAD
+new content from HEAD
+=======
+new content from branch
+>>>>>>> feature-branch
 line 2`

		const result = parseDiffContent(diff)

		// Should not contain any git conflict markers
		const hasGitMarker = result.some(
			(l) =>
				l.content.includes("<<<<<<< HEAD") ||
				l.content.includes(">>>>>>> feature-branch") ||
				l.content === "=======",
		)
		expect(hasGitMarker).toBe(false)
	})

	it("should filter ======= separator from unified diff", () => {
		const diff = `@@ -1,3 +1,3 @@
 line 1
-=======
+new line
 line 2`

		const result = parseDiffContent(diff)

		// Should not contain the separator as content
		const hasSeparator = result.some((l) => l.content === "=======")
		expect(hasSeparator).toBe(false)

		// Should have the new line
		const hasNewLine = result.some((l) => l.content === "new line" && l.type === "addition")
		expect(hasNewLine).toBe(true)
	})

	it("should filter escaped git conflict markers (with backslash prefix)", () => {
		const diff = `@@ -1,7 +1,3 @@
 import { logs } from "../../services/logs.js"
-\\<<<<<<< Updated upstream
-\\=======
-import { convertImagesToDataUrls } from "../../media/image-utils.js"
-\\>>>>>>> Stashed changes
 
 export interface StdinMessage {`

		const result = parseDiffContent(diff)

		// Should not contain any escaped git conflict markers
		const hasEscapedMarker = result.some(
			(l) =>
				l.content.includes("\\<<<<<<< Updated upstream") ||
				l.content.includes("\\=======") ||
				l.content.includes("\\>>>>>>> Stashed changes"),
		)
		expect(hasEscapedMarker).toBe(false)

		// Should still have the legitimate content
		const hasLegitimateContent = result.some((l) => l.content.includes("import { logs }"))
		expect(hasLegitimateContent).toBe(true)
	})

	it("should filter escaped partial markers", () => {
		const diff = `@@ -1,3 +1,1 @@
	line 1
-\\<<<<
-\\>>>>>>`

		const result = parseDiffContent(diff)

		// Should not contain escaped partial markers
		const hasEscapedPartialMarker = result.some((l) => l.content === "\\<<<<" || l.content === "\\>>>>>>")
		expect(hasEscapedPartialMarker).toBe(false)
	})

	it("should filter partial markers with leading whitespace (bug report case)", () => {
		// This is the exact case from the bug report where markers appear with indentation
		// e.g., "               <<<<" or "               <<<<<<< S"
		const diff = `@@ -1,3 +1,1 @@
	line 1
-               <<<<
-               <<<<<<< S`

		const result = parseDiffContent(diff)

		// Should not contain partial markers even with leading whitespace
		const hasPartialMarker = result.some((l) => l.content.includes("<<<<") || l.content.includes("<<<<<<< S"))
		expect(hasPartialMarker).toBe(false)
	})

	it("should filter markers with tabs and spaces", () => {
		const diff = `@@ -1,2 +1,1 @@
	line 1
-		<<<<`

		const result = parseDiffContent(diff)

		// Should not contain partial markers with tab indentation
		const hasPartialMarker = result.some((l) => l.content.includes("<<<<"))
		expect(hasPartialMarker).toBe(false)
	})

	it("should filter partial markers appearing as additions (exact bug report case)", () => {
		// This reproduces the exact bug from the report where >>>>>> appears as an addition
		// The output showed: "      92 + >>>>>>"
		const diff = `@@ -89,3 +89,4 @@
	"hint": "Prem Enter per enviar, Shift+Enter per nova línia",
-"addImage": "Add image",
-"removeImage": "Remove image"
+"hint": "Prem Enter per enviar, Shift+Enter per nova línia",
+"addImage": "Afegir imatge",
+"removeImage": "Eliminar imatge"
+>>>>>>`

		const result = parseDiffContent(diff)

		// Should not contain the partial marker as an addition
		const hasPartialMarker = result.some((l) => l.type === "addition" && l.content === ">>>>>>")
		expect(hasPartialMarker).toBe(false)

		// Should still have the legitimate additions
		const hasLegitimateAddition = result.some((l) => l.type === "addition" && l.content.includes("Afegir imatge"))
		expect(hasLegitimateAddition).toBe(true)
	})

	it("should filter partial markers appearing as only content (empty diff case)", () => {
		// This reproduces the case where the entire diff content is just a partial marker
		// The output showed: "⏺︎ Update( webview-ui/src/i18n/locales/es/agentManager.json)\n           <<<<"
		const diff = `           <<<<`

		const result = parseDiffContent(diff)

		// Should return empty or no partial markers
		const hasPartialMarker = result.some((l) => l.content.includes("<<<<"))
		expect(hasPartialMarker).toBe(false)
	})

	it("should filter <<<<<<< S partial marker appearing as only content", () => {
		// This reproduces: "⏺︎ Update( webview-ui/src/i18n/locales/pt-BR/agentManager.json)\n           <<<<<<< S"
		const diff = `           <<<<<<< S`

		const result = parseDiffContent(diff)

		// Should return empty or no partial markers
		const hasPartialMarker = result.some((l) => l.content.includes("<<<<"))
		expect(hasPartialMarker).toBe(false)
	})
})
