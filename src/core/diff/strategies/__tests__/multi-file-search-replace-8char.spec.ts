import { describe, it, expect } from "vitest"
import { MultiFileSearchReplaceDiffStrategy } from "../multi-file-search-replace"

describe("MultiFileSearchReplaceDiffStrategy - 8-character marker support", () => {
	it("should handle 8 '<' characters in SEARCH marker (PR #9456 use case)", async () => {
		const strategy = new MultiFileSearchReplaceDiffStrategy()
		const originalContent = "line 1\nline 2\nline 3"

		const diff = `<<<<<<<< SEARCH
:start_line:1
-------
line 1
=======
modified line 1
>>>>>>>> REPLACE`

		const result = await strategy.applyDiff(originalContent, diff)

		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe("modified line 1\nline 2\nline 3")
		}
	})

	it("should handle 7 '<' characters in SEARCH marker (standard)", async () => {
		const strategy = new MultiFileSearchReplaceDiffStrategy()
		const originalContent = "line 1\nline 2\nline 3"

		const diff = `<<<<<<< SEARCH
:start_line:1
-------
line 1
=======
modified line 1
>>>>>>> REPLACE`

		const result = await strategy.applyDiff(originalContent, diff)

		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe("modified line 1\nline 2\nline 3")
		}
	})

	it("should handle 8 '>' characters in REPLACE marker", async () => {
		const strategy = new MultiFileSearchReplaceDiffStrategy()
		const originalContent = "line 1\nline 2\nline 3"

		const diff = `<<<<<<< SEARCH
:start_line:2
-------
line 2
=======
modified line 2
>>>>>>>> REPLACE`

		const result = await strategy.applyDiff(originalContent, diff)

		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe("line 1\nmodified line 2\nline 3")
		}
	})

	it("should handle optional '<' at end of REPLACE marker", async () => {
		const strategy = new MultiFileSearchReplaceDiffStrategy()
		const originalContent = "line 1\nline 2\nline 3"

		const diff = `<<<<<<< SEARCH
:start_line:3
-------
line 3
=======
modified line 3
>>>>>>> REPLACE<`

		const result = await strategy.applyDiff(originalContent, diff)

		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe("line 1\nline 2\nmodified line 3")
		}
	})

	it("should handle mixed 7 and 8 character markers in same diff", async () => {
		const strategy = new MultiFileSearchReplaceDiffStrategy()
		const originalContent = "line 1\nline 2\nline 3"

		const diff = `<<<<<<<< SEARCH
:start_line:1
-------
line 1
=======
modified line 1
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line:3
-------
line 3
=======
modified line 3
>>>>>>>> REPLACE`

		const result = await strategy.applyDiff(originalContent, diff)

		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe("modified line 1\nline 2\nmodified line 3")
		}
	})

	it("should reject markers with too many characters (9+)", async () => {
		const strategy = new MultiFileSearchReplaceDiffStrategy()
		const originalContent = "line 1\nline 2\nline 3"

		const diff = `<<<<<<<<< SEARCH
:start_line:1
-------
line 1
=======
modified line 1
>>>>>>> REPLACE`

		const result = await strategy.applyDiff(originalContent, diff)

		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toContain("Diff block is malformed")
		}
	})

	it("should reject markers with too few characters (6-)", async () => {
		const strategy = new MultiFileSearchReplaceDiffStrategy()
		const originalContent = "line 1\nline 2\nline 3"

		const diff = `<<<<<< SEARCH
:start_line:1
-------
line 1
=======
modified line 1
>>>>>>> REPLACE`

		const result = await strategy.applyDiff(originalContent, diff)

		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toContain("Diff block is malformed")
		}
	})

	it("should handle validation with 8 character markers", () => {
		const strategy = new MultiFileSearchReplaceDiffStrategy()

		const diff = `<<<<<<<< SEARCH
:start_line:1
-------
content
=======
new content
>>>>>>>> REPLACE`

		const result = strategy["validateMarkerSequencing"](diff)

		expect(result.success).toBe(true)
	})

	it("should detect merge conflict with 8 character prefix", () => {
		const strategy = new MultiFileSearchReplaceDiffStrategy()

		const diff = `<<<<<<<< SEARCH
:start_line:1
-------
content
<<<<<<<< HEAD
conflict content
=======
new content
>>>>>>>> REPLACE`

		const result = strategy["validateMarkerSequencing"](diff)

		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toContain("merge conflict")
		}
	})
})
