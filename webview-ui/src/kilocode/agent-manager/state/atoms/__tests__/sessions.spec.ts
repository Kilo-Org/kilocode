import { createStore } from "jotai"
import { versionCountAtom, generateVersionLabels, type VersionCount, MAX_VERSION_COUNT } from "../sessions"

describe("Agent Manager Sessions Atoms - Version Mode", () => {
	describe("versionCountAtom", () => {
		it("should have a default value of 1", () => {
			const store = createStore()
			const value = store.get(versionCountAtom)
			expect(value).toBe(1)
		})

		it("should accept valid version counts (1-4)", () => {
			const store = createStore()

			store.set(versionCountAtom, 1)
			expect(store.get(versionCountAtom)).toBe(1)

			store.set(versionCountAtom, 2)
			expect(store.get(versionCountAtom)).toBe(2)

			store.set(versionCountAtom, 3)
			expect(store.get(versionCountAtom)).toBe(3)

			store.set(versionCountAtom, 4)
			expect(store.get(versionCountAtom)).toBe(4)
		})
	})

	describe("MAX_VERSION_COUNT", () => {
		it("should be 4", () => {
			expect(MAX_VERSION_COUNT).toBe(4)
		})
	})

	describe("VersionCount type", () => {
		it("should allow values 1, 2, 3, 4", () => {
			// Type check - these should compile
			const v1: VersionCount = 1
			const v2: VersionCount = 2
			const v3: VersionCount = 3
			const v4: VersionCount = 4

			expect([v1, v2, v3, v4]).toEqual([1, 2, 3, 4])
		})
	})

	describe("generateVersionLabels", () => {
		it("should return single label without suffix for version count 1", () => {
			const labels = generateVersionLabels("Build todo app", 1)
			expect(labels).toEqual(["Build todo app"])
		})

		it("should return labels with (v1), (v2) suffixes for version count 2", () => {
			const labels = generateVersionLabels("Build todo app", 2)
			expect(labels).toEqual(["Build todo app (v1)", "Build todo app (v2)"])
		})

		it("should return labels with (v1), (v2), (v3) suffixes for version count 3", () => {
			const labels = generateVersionLabels("Build todo app", 3)
			expect(labels).toEqual(["Build todo app (v1)", "Build todo app (v2)", "Build todo app (v3)"])
		})

		it("should return labels with (v1), (v2), (v3), (v4) suffixes for version count 4", () => {
			const labels = generateVersionLabels("Build todo app", 4)
			expect(labels).toEqual([
				"Build todo app (v1)",
				"Build todo app (v2)",
				"Build todo app (v3)",
				"Build todo app (v4)",
			])
		})

		it("should handle empty prompt", () => {
			const labels = generateVersionLabels("", 2)
			expect(labels).toEqual([" (v1)", " (v2)"])
		})

		it("should handle long prompts", () => {
			const longPrompt = "A".repeat(100)
			const labels = generateVersionLabels(longPrompt, 2)
			expect(labels[0]).toBe(`${longPrompt} (v1)`)
			expect(labels[1]).toBe(`${longPrompt} (v2)`)
		})
	})
})
