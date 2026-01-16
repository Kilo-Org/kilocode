import { createStore } from "jotai"
import {
	pastedTextReferencesAtom,
	pastedTextReferenceCounterAtom,
	addPastedTextReferenceAtom,
	clearPastedTextReferencesAtom,
	getPastedTextReferencesAtom,
	formatPastedTextReference,
	PASTE_LINE_THRESHOLD,
} from "../keyboard.js"

describe("pasted text reference atoms", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	describe("pastedTextReferencesAtom", () => {
		it("should initialize with empty map", () => {
			const refs = store.get(pastedTextReferencesAtom)
			expect(refs.size).toBe(0)
		})
	})

	describe("pastedTextReferenceCounterAtom", () => {
		it("should initialize with 0", () => {
			const counter = store.get(pastedTextReferenceCounterAtom)
			expect(counter).toBe(0)
		})
	})

	describe("addPastedTextReferenceAtom", () => {
		it("should store text and return reference number", () => {
			const text = "line one\nline two\nline three"
			const refNumber = store.set(addPastedTextReferenceAtom, text)

			expect(refNumber).toBe(1)
		})

		it("should increment counter for each paste", () => {
			store.set(addPastedTextReferenceAtom, "first paste")
			const ref2 = store.set(addPastedTextReferenceAtom, "second paste")
			const ref3 = store.set(addPastedTextReferenceAtom, "third paste")

			expect(ref2).toBe(2)
			expect(ref3).toBe(3)
		})

		it("should store text content in references map", () => {
			const text = "stored content\nwith lines"
			const refNumber = store.set(addPastedTextReferenceAtom, text)

			const refs = store.get(pastedTextReferencesAtom)
			expect(refs.get(refNumber)).toBe(text)
		})
	})

	describe("clearPastedTextReferencesAtom", () => {
		it("should clear all references", () => {
			store.set(addPastedTextReferenceAtom, "text 1")
			store.set(addPastedTextReferenceAtom, "text 2")

			store.set(clearPastedTextReferencesAtom)

			const refs = store.get(pastedTextReferencesAtom)
			expect(refs.size).toBe(0)
		})

		it("should reset counter to 0", () => {
			store.set(addPastedTextReferenceAtom, "text 1")
			store.set(addPastedTextReferenceAtom, "text 2")

			store.set(clearPastedTextReferencesAtom)

			const counter = store.get(pastedTextReferenceCounterAtom)
			expect(counter).toBe(0)
		})

		it("should allow new references after clear", () => {
			store.set(addPastedTextReferenceAtom, "text 1")
			store.set(clearPastedTextReferencesAtom)

			const refNumber = store.set(addPastedTextReferenceAtom, "new text")
			expect(refNumber).toBe(1)
		})
	})

	describe("getPastedTextReferencesAtom", () => {
		it("should return empty object when no references", () => {
			const refs = store.get(getPastedTextReferencesAtom)
			expect(refs).toEqual({})
		})

		it("should return references as plain object", () => {
			store.set(addPastedTextReferenceAtom, "text one")
			store.set(addPastedTextReferenceAtom, "text two")

			const refs = store.get(getPastedTextReferencesAtom)
			expect(refs).toEqual({
				1: "text one",
				2: "text two",
			})
		})
	})

	describe("formatPastedTextReference", () => {
		it("should format reference correctly", () => {
			const result = formatPastedTextReference(1, 25)
			expect(result).toBe("[Pasted text #1 +25 lines]")
		})

		it("should handle large numbers", () => {
			const result = formatPastedTextReference(999, 1000)
			expect(result).toBe("[Pasted text #999 +1000 lines]")
		})

		it("should handle single line", () => {
			const result = formatPastedTextReference(1, 1)
			expect(result).toBe("[Pasted text #1 +1 lines]")
		})
	})

	describe("PASTE_LINE_THRESHOLD", () => {
		it("should be a positive number", () => {
			expect(PASTE_LINE_THRESHOLD).toBeGreaterThan(0)
		})

		it("should be at least 5 lines", () => {
			// Reasonable minimum to avoid abbreviating small pastes
			expect(PASTE_LINE_THRESHOLD).toBeGreaterThanOrEqual(5)
		})
	})
})
