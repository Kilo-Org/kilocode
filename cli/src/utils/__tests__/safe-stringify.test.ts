import { describe, it, expect } from "vitest"
import { safeStringify, argToString, argsToMessage } from "../safe-stringify.js"

describe("safe-stringify", () => {
	describe("safeStringify", () => {
		it("should handle circular references in objects", () => {
			const obj: { a: number; self?: unknown } = { a: 1 }
			obj.self = obj

			expect(() => {
				safeStringify(obj)
			}).not.toThrow()

			const result = safeStringify(obj) as { a: number; self: string }
			expect(result.a).toBe(1)
			expect(result.self).toBe("[Circular]")
		})

		it("should handle circular references in arrays", () => {
			const arr: unknown[] = [1, 2]
			arr.push(arr)

			expect(() => {
				safeStringify(arr)
			}).not.toThrow()

			const result = safeStringify(arr) as unknown[]
			expect(result[0]).toBe(1)
			expect(result[1]).toBe(2)
			expect(result[2]).toBe("[Circular]")
		})

		it("should handle nested circular references", () => {
			const obj1: { name: string; ref?: unknown } = { name: "obj1" }
			const obj2: { name: string; ref?: unknown } = { name: "obj2" }
			obj1.ref = obj2
			obj2.ref = obj1

			expect(() => {
				safeStringify(obj1)
			}).not.toThrow()

			const result = safeStringify(obj1) as { name: string; ref: { name: string; ref: string } }
			expect(result.name).toBe("obj1")
			expect(result.ref.name).toBe("obj2")
			expect(result.ref.ref).toBe("[Circular]")
		})

		it("should handle Error objects", () => {
			const error = new Error("Test error")
			const result = safeStringify(error) as { message: string; name: string; stack: string }

			expect(result.message).toBe("Test error")
			expect(result.name).toBe("Error")
			expect(result.stack).toBeDefined()
		})

		it("should handle custom Error objects with additional properties", () => {
			class CustomError extends Error {
				code: string
				constructor(message: string, code: string) {
					super(message)
					this.name = "CustomError"
					this.code = code
				}
			}

			const error = new CustomError("Custom error", "ERR_CUSTOM")
			const result = safeStringify(error) as { message: string; name: string; code: string }

			expect(result.message).toBe("Custom error")
			expect(result.name).toBe("CustomError")
			expect(result.code).toBe("ERR_CUSTOM")
		})

		it("should handle Date objects", () => {
			const date = new Date("2024-01-01T00:00:00.000Z")
			const result = safeStringify(date)

			expect(result).toBe("2024-01-01T00:00:00.000Z")
		})

		it("should handle RegExp objects", () => {
			const regex = /test\d+/gi
			const result = safeStringify(regex)

			expect(result).toBe("/test\\d+/gi")
		})

		it("should handle null and undefined", () => {
			expect(safeStringify(null)).toBeNull()
			expect(safeStringify(undefined)).toBeUndefined()
		})

		it("should handle primitives", () => {
			expect(safeStringify(42)).toBe(42)
			expect(safeStringify("hello")).toBe("hello")
			expect(safeStringify(true)).toBe(true)
		})

		it("should handle ExtensionContext-like circular structures", () => {
			// Simulate the ExtensionContext circular reference structure
			const subscriptions: unknown[] = []
			const contextProxy = {
				originalContext: null as unknown,
			}
			const context = {
				subscriptions,
				extensionPath: "/path/to/extension",
			}

			// Create circular reference
			contextProxy.originalContext = context
			subscriptions.push({ contextProxy })

			expect(() => {
				safeStringify(context)
			}).not.toThrow()

			const result = safeStringify(context) as {
				subscriptions: Array<{ contextProxy: { originalContext: string } }>
				extensionPath: string
			}
			expect(result.extensionPath).toBe("/path/to/extension")
			expect(result.subscriptions[0]?.contextProxy.originalContext).toBe("[Circular]")
		})
	})

	describe("argToString", () => {
		it("should handle string arguments", () => {
			expect(argToString("hello")).toBe("hello")
		})

		it("should handle object arguments", () => {
			const result = argToString({ a: 1, b: 2 })
			expect(result).toBe('{"a":1,"b":2}')
		})

		it("should handle circular references", () => {
			const obj: { a: number; self?: unknown } = { a: 1 }
			obj.self = obj

			expect(() => {
				argToString(obj)
			}).not.toThrow()

			const result = argToString(obj)
			expect(result).toContain('"a":1')
			expect(result).toContain('"self":"[Circular]"')
		})
	})

	describe("argsToMessage", () => {
		it("should handle multiple arguments", () => {
			const result = argsToMessage(["hello", 42, { a: 1 }])
			expect(result).toBe('hello 42 {"a":1}')
		})

		it("should handle circular references in arguments", () => {
			const obj: { a: number; self?: unknown } = { a: 1 }
			obj.self = obj

			expect(() => {
				argsToMessage(["test", obj])
			}).not.toThrow()

			const result = argsToMessage(["test", obj])
			expect(result).toContain("test")
			expect(result).toContain('"a":1')
			expect(result).toContain('"self":"[Circular]"')
		})

		it("should handle empty arguments", () => {
			expect(argsToMessage([])).toBe("")
		})
	})
})
