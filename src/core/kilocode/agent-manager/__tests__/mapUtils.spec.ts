import { describe, it, expect } from "vitest"
import { renameMapKey } from "../mapUtils"

describe("renameMapKey", () => {
	it("moves value from old key to new key", () => {
		const map = new Map<string, number>([["a", 1]])

		const result = renameMapKey(map, "a", "b")

		expect(result).toBe(true)
		expect(map.get("a")).toBeUndefined()
		expect(map.get("b")).toBe(1)
	})

	it("returns false when old key does not exist", () => {
		const map = new Map<string, number>()

		const result = renameMapKey(map, "a", "b")

		expect(result).toBe(false)
		expect(map.size).toBe(0)
	})

	it("overwrites existing value at new key", () => {
		const map = new Map<string, number>([
			["a", 1],
			["b", 2],
		])

		const result = renameMapKey(map, "a", "b")

		expect(result).toBe(true)
		expect(map.get("a")).toBeUndefined()
		expect(map.get("b")).toBe(1)
		expect(map.size).toBe(1)
	})

	it("works with complex value types", () => {
		const map = new Map<string, { name: string }>([["old", { name: "test" }]])

		renameMapKey(map, "old", "new")

		expect(map.get("new")).toEqual({ name: "test" })
	})
})
