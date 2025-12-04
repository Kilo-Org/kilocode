import { describe, it, expect, beforeEach } from "vitest"
import { prevEdit, prevEditLruCache, setPrevEdit, getPrevEditsDescending } from "./prevEditLruCache"

describe("prevEditLruCache", () => {
	beforeEach(() => {
		// Clear cache before each test
		prevEditLruCache.clear()
	})

	const createMockEdit = (
		timestamp: number,
		fileUri: string = "file:///test.ts",
		workspaceUri: string = "file:///workspace",
	): prevEdit => ({
		unidiff: `--- test.ts\n+++ test.ts\n@@ -1,1 +1,1 @@\n-old\n+new`,
		fileUri,
		workspaceUri,
		timestamp,
	})

	describe("setPrevEdit", () => {
		it("should add edit to cache", () => {
			const edit = createMockEdit(Date.now())

			setPrevEdit(edit)

			const edits = getPrevEditsDescending()
			expect(edits).toHaveLength(1)
			expect(edits[0]).toEqual(edit)
		})

		it("should generate unique keys for same file and timestamp", () => {
			const timestamp = Date.now()
			const edit1 = createMockEdit(timestamp)
			const edit2 = createMockEdit(timestamp)

			setPrevEdit(edit1)
			setPrevEdit(edit2)

			const edits = getPrevEditsDescending()
			expect(edits).toHaveLength(2)
		})

		it("should add multiple edits from different files", () => {
			const edit1 = createMockEdit(1000, "file:///file1.ts")
			const edit2 = createMockEdit(2000, "file:///file2.ts")
			const edit3 = createMockEdit(3000, "file:///file3.ts")

			setPrevEdit(edit1)
			setPrevEdit(edit2)
			setPrevEdit(edit3)

			const edits = getPrevEditsDescending()
			expect(edits).toHaveLength(3)
		})
	})

	describe("getPrevEditsDescending", () => {
		it("should return empty array when cache is empty", () => {
			const edits = getPrevEditsDescending()

			expect(edits).toEqual([])
		})

		it("should return edits in descending order (most recent first)", () => {
			const edit1 = createMockEdit(1000)
			const edit2 = createMockEdit(2000)
			const edit3 = createMockEdit(3000)

			setPrevEdit(edit1)
			setPrevEdit(edit2)
			setPrevEdit(edit3)

			const edits = getPrevEditsDescending()

			// Most recent should be first
			expect(edits[0].timestamp).toBe(3000)
			expect(edits[1].timestamp).toBe(2000)
			expect(edits[2].timestamp).toBe(1000)
		})

		it("should return at most 5 edits", () => {
			// Add 7 edits
			for (let i = 0; i < 7; i++) {
				setPrevEdit(createMockEdit(1000 + i * 1000))
			}

			const edits = getPrevEditsDescending()

			expect(edits.length).toBeLessThanOrEqual(5)
		})
	})

	describe("LRU behavior", () => {
		it("should evict oldest edit when cache exceeds max size", () => {
			const edits: prevEdit[] = []

			// Add 6 edits (max size is 5)
			for (let i = 0; i < 6; i++) {
				const edit = createMockEdit(1000 + i * 1000)
				edits.push(edit)
				setPrevEdit(edit)
			}

			const cachedEdits = getPrevEditsDescending()

			// Should only have 5 edits
			expect(cachedEdits).toHaveLength(5)

			// First edit (oldest) should have been evicted
			const timestamps = cachedEdits.map((e) => e.timestamp)
			expect(timestamps).not.toContain(1000)

			// Most recent 5 should be present
			expect(timestamps).toContain(2000)
			expect(timestamps).toContain(3000)
			expect(timestamps).toContain(4000)
			expect(timestamps).toContain(5000)
			expect(timestamps).toContain(6000)
		})

		it("should maintain max size of 5 edits", () => {
			// Add many edits
			for (let i = 0; i < 10; i++) {
				setPrevEdit(createMockEdit(1000 + i * 1000))
			}

			const edits = getPrevEditsDescending()

			expect(edits).toHaveLength(5)
		})

		it("should keep most recent edits when evicting", () => {
			// Add 10 edits
			for (let i = 0; i < 10; i++) {
				setPrevEdit(createMockEdit(1000 + i * 1000))
			}

			const edits = getPrevEditsDescending()

			// Should have the 5 most recent timestamps
			expect(edits[0].timestamp).toBe(10000)
			expect(edits[1].timestamp).toBe(9000)
			expect(edits[2].timestamp).toBe(8000)
			expect(edits[3].timestamp).toBe(7000)
			expect(edits[4].timestamp).toBe(6000)
		})
	})

	describe("cache operations", () => {
		it("should clear all edits when cleared", () => {
			setPrevEdit(createMockEdit(1000))
			setPrevEdit(createMockEdit(2000))
			setPrevEdit(createMockEdit(3000))

			expect(getPrevEditsDescending()).toHaveLength(3)

			prevEditLruCache.clear()

			expect(getPrevEditsDescending()).toHaveLength(0)
		})

		it("should handle mixed workspace URIs", () => {
			const edit1 = createMockEdit(1000, "file:///test.ts", "file:///workspace1")
			const edit2 = createMockEdit(2000, "file:///test.ts", "file:///workspace2")

			setPrevEdit(edit1)
			setPrevEdit(edit2)

			const edits = getPrevEditsDescending()

			expect(edits).toHaveLength(2)
			expect(edits[0].workspaceUri).toBe("file:///workspace2")
			expect(edits[1].workspaceUri).toBe("file:///workspace1")
		})

		it("should store complete diff information", () => {
			const edit = createMockEdit(1000)
			edit.unidiff = `--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;`

			setPrevEdit(edit)

			const edits = getPrevEditsDescending()

			expect(edits[0].unidiff).toContain("const b = 2")
			expect(edits[0].unidiff).toContain("const b = 3")
		})
	})

	describe("edge cases", () => {
		it("should handle rapid successive edits", () => {
			const timestamp = Date.now()

			// Add multiple edits with same timestamp
			for (let i = 0; i < 3; i++) {
				setPrevEdit(createMockEdit(timestamp))
			}

			const edits = getPrevEditsDescending()

			// All should be stored due to unique key generation
			expect(edits).toHaveLength(3)
			expect(edits.every((e) => e.timestamp === timestamp)).toBe(true)
		})

		it("should handle edits with very close timestamps", () => {
			setPrevEdit(createMockEdit(1000000))
			setPrevEdit(createMockEdit(1000001))
			setPrevEdit(createMockEdit(1000002))

			const edits = getPrevEditsDescending()

			expect(edits).toHaveLength(3)
			expect(edits[0].timestamp).toBe(1000002)
			expect(edits[2].timestamp).toBe(1000000)
		})
	})
})
