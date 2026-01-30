/**
 * Tests for the /shortcuts command
 */

import { describe, it, expect, vi } from "vitest"
import { shortcutsCommand } from "../shortcuts.js"
import { createMockContext } from "./helpers/mockContext.js"

describe("shortcutsCommand", () => {
	describe("command metadata", () => {
		it("should have correct name", () => {
			expect(shortcutsCommand.name).toBe("shortcuts")
		})

		it("should have correct aliases", () => {
			expect(shortcutsCommand.aliases).toEqual(["keys", "hotkeys"])
		})

		it("should have correct description", () => {
			expect(shortcutsCommand.description).toBe("Show keyboard shortcuts")
		})

		it("should have correct usage", () => {
			expect(shortcutsCommand.usage).toBe("/shortcuts")
		})

		it("should have correct category", () => {
			expect(shortcutsCommand.category).toBe("system")
		})

		it("should have examples", () => {
			expect(shortcutsCommand.examples).toEqual(["/shortcuts", "/keys", "/hotkeys"])
		})
	})

	describe("handler", () => {
		it("should output shortcut help", async () => {
			const addMessage = vi.fn()
			const context = createMockContext({
				input: "/shortcuts",
				addMessage,
			})

			await shortcutsCommand.handler(context)

			expect(addMessage).toHaveBeenCalledTimes(1)
			const message = addMessage.mock.calls[0]![0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("**Keyboard Shortcuts**")
			expect(message.content).toContain("Shift+Tab")
			expect(message.content).toContain("!")
			expect(message.content).toMatch(/(Cmd\+C|Ctrl\+C)/)
		})
	})
})
