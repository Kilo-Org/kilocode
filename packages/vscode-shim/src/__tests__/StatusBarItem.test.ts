import { StatusBarItem } from "../classes/StatusBarItem.js"
import { StatusBarAlignment } from "../types.js"

describe("StatusBarItem", () => {
	describe("constructor", () => {
		it("should create with alignment", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			expect(item.alignment).toBe(StatusBarAlignment.Left)
		})

		it("should create with alignment and priority", () => {
			const item = new StatusBarItem(StatusBarAlignment.Right, 100)

			expect(item.alignment).toBe(StatusBarAlignment.Right)
			expect(item.priority).toBe(100)
		})

		it("should have undefined priority when not provided", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			expect(item.priority).toBeUndefined()
		})
	})

	describe("text property", () => {
		it("should have empty text initially", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			expect(item.text).toBe("")
		})

		it("should allow setting text", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			item.text = "Hello"

			expect(item.text).toBe("Hello")
		})
	})

	describe("tooltip property", () => {
		it("should be undefined initially", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			expect(item.tooltip).toBeUndefined()
		})

		it("should allow setting tooltip", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			item.tooltip = "My tooltip"

			expect(item.tooltip).toBe("My tooltip")
		})

		it("should allow setting to undefined", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)
			item.tooltip = "tooltip"

			item.tooltip = undefined

			expect(item.tooltip).toBeUndefined()
		})
	})

	describe("command property", () => {
		it("should be undefined initially", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			expect(item.command).toBeUndefined()
		})

		it("should allow setting command", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			item.command = "myExtension.doSomething"

			expect(item.command).toBe("myExtension.doSomething")
		})
	})

	describe("color property", () => {
		it("should be undefined initially", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			expect(item.color).toBeUndefined()
		})

		it("should allow setting color", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			item.color = "#ff0000"

			expect(item.color).toBe("#ff0000")
		})
	})

	describe("backgroundColor property", () => {
		it("should be undefined initially", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			expect(item.backgroundColor).toBeUndefined()
		})

		it("should allow setting backgroundColor", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			item.backgroundColor = "#00ff00"

			expect(item.backgroundColor).toBe("#00ff00")
		})
	})

	describe("isVisible property", () => {
		it("should be false initially", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			expect(item.isVisible).toBe(false)
		})

		it("should be true after show()", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			item.show()

			expect(item.isVisible).toBe(true)
		})

		it("should be false after hide()", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)
			item.show()

			item.hide()

			expect(item.isVisible).toBe(false)
		})
	})

	describe("show()", () => {
		it("should make item visible", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			item.show()

			expect(item.isVisible).toBe(true)
		})

		it("should be idempotent", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			item.show()
			item.show()

			expect(item.isVisible).toBe(true)
		})
	})

	describe("hide()", () => {
		it("should make item invisible", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)
			item.show()

			item.hide()

			expect(item.isVisible).toBe(false)
		})

		it("should be safe to call when already hidden", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			expect(() => item.hide()).not.toThrow()
			expect(item.isVisible).toBe(false)
		})
	})

	describe("dispose()", () => {
		it("should make item invisible", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)
			item.show()

			item.dispose()

			expect(item.isVisible).toBe(false)
		})

		it("should be safe to call multiple times", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			expect(() => {
				item.dispose()
				item.dispose()
			}).not.toThrow()
		})
	})

	describe("alignment property", () => {
		it("should be readonly", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left)

			// TypeScript prevents reassignment at compile time
			// Just verify the value is what we expect
			expect(item.alignment).toBe(StatusBarAlignment.Left)
		})
	})

	describe("priority property", () => {
		it("should be readonly", () => {
			const item = new StatusBarItem(StatusBarAlignment.Left, 50)

			expect(item.priority).toBe(50)
		})
	})
})
