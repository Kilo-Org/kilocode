import { TextEditorDecorationType } from "../classes/TextEditorDecorationType.js"

describe("TextEditorDecorationType", () => {
	describe("constructor", () => {
		it("should create with a key", () => {
			const decoration = new TextEditorDecorationType("my-decoration")

			expect(decoration.key).toBe("my-decoration")
		})

		it("should allow any string key", () => {
			const decoration = new TextEditorDecorationType("decoration-12345")

			expect(decoration.key).toBe("decoration-12345")
		})
	})

	describe("key property", () => {
		it("should be accessible", () => {
			const decoration = new TextEditorDecorationType("test-key")

			expect(decoration.key).toBe("test-key")
		})

		it("should be mutable", () => {
			const decoration = new TextEditorDecorationType("original")

			decoration.key = "modified"

			expect(decoration.key).toBe("modified")
		})
	})

	describe("dispose()", () => {
		it("should not throw when called", () => {
			const decoration = new TextEditorDecorationType("test")

			expect(() => decoration.dispose()).not.toThrow()
		})

		it("should be safe to call multiple times", () => {
			const decoration = new TextEditorDecorationType("test")

			expect(() => {
				decoration.dispose()
				decoration.dispose()
				decoration.dispose()
			}).not.toThrow()
		})
	})

	describe("Disposable interface", () => {
		it("should implement Disposable interface", () => {
			const decoration = new TextEditorDecorationType("test")

			expect(typeof decoration.dispose).toBe("function")
		})
	})
})
