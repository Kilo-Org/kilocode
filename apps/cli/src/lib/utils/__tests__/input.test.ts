import type { Key } from "ink"

import { GLOBAL_INPUT_SEQUENCES, isGlobalInputSequence, matchesGlobalSequence } from "../input.js"

function createKey(overrides: Partial<Key> = {}): Key {
	return {
		upArrow: false,
		downArrow: false,
		leftArrow: false,
		rightArrow: false,
		pageDown: false,
		pageUp: false,
		home: false,
		end: false,
		return: false,
		escape: false,
		ctrl: false,
		shift: false,
		tab: false,
		backspace: false,
		delete: false,
		meta: false,
		...overrides,
	}
}

describe("globalInputSequences", () => {
	describe("GLOBAL_INPUT_SEQUENCES registry", () => {
		it("should have ctrl-c registered", () => {
			const seq = GLOBAL_INPUT_SEQUENCES.find((s) => s.id === "ctrl-c")
			expect(seq).toBeDefined()
			expect(seq?.description).toContain("Exit")
		})

		it("should have ctrl-m registered", () => {
			const seq = GLOBAL_INPUT_SEQUENCES.find((s) => s.id === "ctrl-m")
			expect(seq).toBeDefined()
			expect(seq?.description).toContain("mode")
		})
	})

	describe("isGlobalInputSequence", () => {
		describe("Ctrl+C detection", () => {
			it("should match standard Ctrl+C", () => {
				const result = isGlobalInputSequence("c", createKey({ ctrl: true }))
				expect(result).toBeDefined()
				expect(result?.id).toBe("ctrl-c")
			})

			it("should not match plain 'c' key", () => {
				const result = isGlobalInputSequence("c", createKey())
				expect(result).toBeUndefined()
			})
		})

		describe("Ctrl+M detection", () => {
			it("should match standard Ctrl+M", () => {
				const result = isGlobalInputSequence("m", createKey({ ctrl: true }))
				expect(result).toBeDefined()
				expect(result?.id).toBe("ctrl-m")
			})

			it("should match CSI u encoding for Ctrl+M", () => {
				const result = isGlobalInputSequence("\x1b[109;5u", createKey())
				expect(result).toBeDefined()
				expect(result?.id).toBe("ctrl-m")
			})

			it("should match input ending with CSI u sequence", () => {
				const result = isGlobalInputSequence("[109;5u", createKey())
				expect(result).toBeDefined()
				expect(result?.id).toBe("ctrl-m")
			})

			it("should not match plain 'm' key", () => {
				const result = isGlobalInputSequence("m", createKey())
				expect(result).toBeUndefined()
			})
		})

		it("should return undefined for non-global sequences", () => {
			const result = isGlobalInputSequence("a", createKey())
			expect(result).toBeUndefined()
		})

		it("should return undefined for regular text input", () => {
			const result = isGlobalInputSequence("hello", createKey())
			expect(result).toBeUndefined()
		})
	})

	describe("matchesGlobalSequence", () => {
		it("should return true for matching sequence ID", () => {
			const result = matchesGlobalSequence("c", createKey({ ctrl: true }), "ctrl-c")
			expect(result).toBe(true)
		})

		it("should return false for non-matching sequence ID", () => {
			const result = matchesGlobalSequence("c", createKey({ ctrl: true }), "ctrl-m")
			expect(result).toBe(false)
		})

		it("should return false for non-existent sequence ID", () => {
			const result = matchesGlobalSequence("c", createKey({ ctrl: true }), "non-existent")
			expect(result).toBe(false)
		})

		it("should match ctrl-m with CSI u encoding", () => {
			const result = matchesGlobalSequence("\x1b[109;5u", createKey(), "ctrl-m")
			expect(result).toBe(true)
		})
	})

	describe("extensibility", () => {
		it("should have unique IDs for all sequences", () => {
			const ids = GLOBAL_INPUT_SEQUENCES.map((s) => s.id)
			const uniqueIds = new Set(ids)
			expect(uniqueIds.size).toBe(ids.length)
		})

		it("should have descriptions for all sequences", () => {
			for (const seq of GLOBAL_INPUT_SEQUENCES) {
				expect(seq.description).toBeTruthy()
				expect(seq.description.length).toBeGreaterThan(0)
			}
		})
	})
})
