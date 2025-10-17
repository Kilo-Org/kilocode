import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import {
	cursorPositionAtom,
	showAutocompleteAtom,
	suggestionsAtom,
	argumentSuggestionsAtom,
	selectedIndexAtom,
} from "../ui.js"
import { textBufferStringAtom, textBufferStateAtom } from "../textBuffer.js"
import { keyboardHandlerAtom, submissionCallbackAtom, submitInputAtom } from "../keyboard.js"
import { pendingApprovalAtom } from "../approval.js"
import type { Key } from "../../../types/keyboard.js"
import type { CommandSuggestion, ArgumentSuggestion } from "../../../services/autocomplete.js"
import type { Command } from "../../../commands/core/types.js"

describe("keypress atoms", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	describe("text input handling", () => {
		it("should update textBufferAtom when typing characters", () => {
			// Initial state
			const initialText = store.get(textBufferStringAtom)
			expect(initialText).toBe("")

			// Simulate typing 'h'
			const key: Key = {
				name: "h",
				sequence: "h",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}

			store.set(keyboardHandlerAtom, key)

			// Check that buffer was updated
			const updatedText = store.get(textBufferStringAtom)
			expect(updatedText).toBe("h")
		})

		it("should update textBufferAtom when typing multiple characters", () => {
			// Type 'hello'
			const chars = ["h", "e", "l", "l", "o"]
			for (const char of chars) {
				const key: Key = {
					name: char,
					sequence: char,
					ctrl: false,
					meta: false,
					shift: false,
					paste: false,
				}
				store.set(keyboardHandlerAtom, key)
			}

			const text = store.get(textBufferStringAtom)
			expect(text).toBe("hello")
		})

		it("should update cursor position when typing", () => {
			// Type 'hi'
			const chars = ["h", "i"]
			for (const char of chars) {
				const key: Key = {
					name: char,
					sequence: char,
					ctrl: false,
					meta: false,
					shift: false,
					paste: false,
				}
				store.set(keyboardHandlerAtom, key)
			}

			const cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(2)
			expect(cursor.row).toBe(0)
		})

		it("should handle backspace correctly", () => {
			// Type 'hello'
			const chars = ["h", "e", "l", "l", "o"]
			for (const char of chars) {
				const key: Key = {
					name: char,
					sequence: char,
					ctrl: false,
					meta: false,
					shift: false,
					paste: false,
				}
				store.set(keyboardHandlerAtom, key)
			}

			// Press backspace
			const backspaceKey: Key = {
				name: "backspace",
				sequence: "\x7f",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, backspaceKey)

			const text = store.get(textBufferStringAtom)
			expect(text).toBe("hell")
		})

		it("should handle newline insertion with Shift+Enter", () => {
			// Type 'hello'
			const chars = ["h", "e", "l", "l", "o"]
			for (const char of chars) {
				const key: Key = {
					name: char,
					sequence: char,
					ctrl: false,
					meta: false,
					shift: false,
					paste: false,
				}
				store.set(keyboardHandlerAtom, key)
			}

			// Press Shift+Enter
			const shiftEnterKey: Key = {
				name: "return",
				sequence: "\r",
				ctrl: false,
				meta: false,
				shift: true,
				paste: false,
			}
			store.set(keyboardHandlerAtom, shiftEnterKey)

			const text = store.get(textBufferStringAtom)
			const state = store.get(textBufferStateAtom)
			expect(text).toBe("hello\n")
			expect(state.lines.length).toBe(2)
		})
	})

	describe("submission callback", () => {
		it("should call submission callback when Enter is pressed with text", () => {
			const mockCallback = vi.fn()
			store.set(submissionCallbackAtom, { callback: mockCallback })

			// Type 'hello'
			const chars = ["h", "e", "l", "l", "o"]
			for (const char of chars) {
				const key: Key = {
					name: char,
					sequence: char,
					ctrl: false,
					meta: false,
					shift: false,
					paste: false,
				}
				store.set(keyboardHandlerAtom, key)
			}

			// Press Enter
			const enterKey: Key = {
				name: "return",
				sequence: "\r",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, enterKey)

			expect(mockCallback).toHaveBeenCalledWith("hello")
		})

		it("should not call submission callback when callback is null", () => {
			// Don't set a callback
			store.set(submissionCallbackAtom, { callback: null })

			// Type 'hello'
			const chars = ["h", "e", "l", "l", "o"]
			for (const char of chars) {
				const key: Key = {
					name: char,
					sequence: char,
					ctrl: false,
					meta: false,
					shift: false,
					paste: false,
				}
				store.set(keyboardHandlerAtom, key)
			}

			// Press Enter - should not throw error
			const enterKey: Key = {
				name: "return",
				sequence: "\r",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			expect(() => store.set(keyboardHandlerAtom, enterKey)).not.toThrow()
		})

		it("should not call submission callback when text is empty", () => {
			const mockCallback = vi.fn()
			store.set(submissionCallbackAtom, { callback: mockCallback })

			// Press Enter without typing anything
			const enterKey: Key = {
				name: "return",
				sequence: "\r",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, enterKey)

			expect(mockCallback).not.toHaveBeenCalled()
		})

		it("should not call submission callback when text is only whitespace", () => {
			const mockCallback = vi.fn()
			store.set(submissionCallbackAtom, { callback: mockCallback })

			// Type spaces
			const spaces = [" ", " ", " "]
			for (const space of spaces) {
				const key: Key = {
					name: "space",
					sequence: space,
					ctrl: false,
					meta: false,
					shift: false,
					paste: false,
				}
				store.set(keyboardHandlerAtom, key)
			}

			// Press Enter
			const enterKey: Key = {
				name: "return",
				sequence: "\r",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, enterKey)

			expect(mockCallback).not.toHaveBeenCalled()
		})

		it("should handle non-function callback gracefully", () => {
			// Set callback to a non-function value
			store.set(submissionCallbackAtom, { callback: "not a function" as any })

			// Type 'hello'
			const chars = ["h", "e", "l", "l", "o"]
			for (const char of chars) {
				const key: Key = {
					name: char,
					sequence: char,
					ctrl: false,
					meta: false,
					shift: false,
					paste: false,
				}
				store.set(keyboardHandlerAtom, key)
			}

			// Press Enter - should not throw error
			const enterKey: Key = {
				name: "return",
				sequence: "\r",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			expect(() => store.set(keyboardHandlerAtom, enterKey)).not.toThrow()
		})

		it("should convert Buffer to string when submitting", () => {
			const mockCallback = vi.fn()
			store.set(submissionCallbackAtom, { callback: mockCallback })

			// Submit a Buffer instead of string
			const buffer = Buffer.from("/help")
			store.set(submitInputAtom, buffer as any)

			// Should convert Buffer to string and call callback
			expect(mockCallback).toHaveBeenCalledWith("/help")
		})
	})

	describe("tab autocomplete", () => {
		it("should complete command by appending only missing part", () => {
			// Type '/mo' - this will automatically trigger autocomplete
			const chars = ["/", "m", "o"]
			for (const char of chars) {
				const key: Key = {
					name: char,
					sequence: char,
					ctrl: false,
					meta: false,
					shift: false,
					paste: false,
				}
				store.set(keyboardHandlerAtom, key)
			}

			// Autocomplete should now be visible (derived from text starting with "/")
			expect(store.get(showAutocompleteAtom)).toBe(true)

			// Set up autocomplete suggestions
			const mockCommand: Command = {
				name: "mode",
				description: "Switch mode",
				aliases: [],
				usage: "/mode <mode-name>",
				examples: ["/mode code"],
				category: "navigation",
				handler: vi.fn(),
			}
			const mockSuggestion: CommandSuggestion = {
				command: mockCommand,
				matchScore: 90,
				highlightedName: "mode",
			}
			store.set(suggestionsAtom, [mockSuggestion])
			store.set(selectedIndexAtom, 0)

			// Press Tab
			const tabKey: Key = {
				name: "tab",
				sequence: "\t",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, tabKey)

			// Should append only 'de' to complete '/mode'
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/mode")
		})

		it("should complete argument by appending only missing part", () => {
			// Type '/mode tes' - this will automatically trigger autocomplete
			const input = "/mode tes"
			for (const char of input) {
				const key: Key = {
					name: char,
					sequence: char,
					ctrl: false,
					meta: false,
					shift: false,
					paste: false,
				}
				store.set(keyboardHandlerAtom, key)
			}

			// Autocomplete should now be visible (derived from text starting with "/")
			expect(store.get(showAutocompleteAtom)).toBe(true)

			// Set up autocomplete suggestions
			const mockArgumentSuggestion: ArgumentSuggestion = {
				value: "test",
				description: "Test mode",
				matchScore: 90,
				highlightedValue: "test",
			}
			store.set(argumentSuggestionsAtom, [mockArgumentSuggestion])
			store.set(selectedIndexAtom, 0)

			// Press Tab
			const tabKey: Key = {
				name: "tab",
				sequence: "\t",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, tabKey)

			// Should append only 't' to complete '/mode test'
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/mode test")
		})

		it("should handle exact match completion", () => {
			// Type '/help' - this will automatically trigger autocomplete
			const input = "/help"
			for (const char of input) {
				const key: Key = {
					name: char,
					sequence: char,
					ctrl: false,
					meta: false,
					shift: false,
					paste: false,
				}
				store.set(keyboardHandlerAtom, key)
			}

			// Autocomplete should now be visible (derived from text starting with "/")
			expect(store.get(showAutocompleteAtom)).toBe(true)

			// Set up autocomplete suggestions
			const mockCommand: Command = {
				name: "help",
				description: "Show help",
				aliases: [],
				usage: "/help",
				examples: ["/help"],
				category: "system",
				handler: vi.fn(),
			}
			const mockSuggestion: CommandSuggestion = {
				command: mockCommand,
				matchScore: 100,
				highlightedName: "help",
			}
			store.set(suggestionsAtom, [mockSuggestion])
			store.set(selectedIndexAtom, 0)

			// Press Tab
			const tabKey: Key = {
				name: "tab",
				sequence: "\t",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, tabKey)

			// Should not add anything (already complete)
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/help")
		})

		it("should update cursor position after tab completion", () => {
			// Type '/mo' - this will automatically trigger autocomplete
			const chars = ["/", "m", "o"]
			for (const char of chars) {
				const key: Key = {
					name: char,
					sequence: char,
					ctrl: false,
					meta: false,
					shift: false,
					paste: false,
				}
				store.set(keyboardHandlerAtom, key)
			}

			// Autocomplete should now be visible (derived from text starting with "/")
			expect(store.get(showAutocompleteAtom)).toBe(true)

			// Set up autocomplete suggestions
			const mockCommand: Command = {
				name: "mode",
				description: "Switch mode",
				aliases: [],
				usage: "/mode <mode-name>",
				examples: ["/mode code"],
				category: "navigation",
				handler: vi.fn(),
			}
			const mockSuggestion: CommandSuggestion = {
				command: mockCommand,
				matchScore: 90,
				highlightedName: "mode",
			}
			store.set(suggestionsAtom, [mockSuggestion])
			store.set(selectedIndexAtom, 0)

			// Press Tab
			const tabKey: Key = {
				name: "tab",
				sequence: "\t",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, tabKey)

			// Cursor should be at end of completed text
			const cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(5) // '/mode' has 5 characters
		})
	})

	describe("empty array guards", () => {
		it("should handle empty approvalOptions array without NaN", () => {
			// Set up approval mode with a message that produces empty options
			// (non-ask message type will result in empty approvalOptions)
			const mockMessage: any = {
				ts: Date.now(),
				type: "say", // Not "ask", so approvalOptions will be empty
				say: "test",
				text: "test message",
			}
			store.set(pendingApprovalAtom, mockMessage)
			store.set(selectedIndexAtom, 0)

			// Press down arrow
			const downKey: Key = {
				name: "down",
				sequence: "\x1b[B",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}

			// Should not throw and should not produce NaN
			expect(() => store.set(keyboardHandlerAtom, downKey)).not.toThrow()
			const selectedIndex = store.get(selectedIndexAtom)
			expect(selectedIndex).not.toBeNaN()
			expect(selectedIndex).toBe(0) // Should remain unchanged
		})

		it("should handle empty approvalOptions array on up arrow without NaN", () => {
			// Set up approval mode with a message that produces empty options
			const mockMessage: any = {
				ts: Date.now(),
				type: "say", // Not "ask", so approvalOptions will be empty
				say: "test",
				text: "test message",
			}
			store.set(pendingApprovalAtom, mockMessage)
			store.set(selectedIndexAtom, 0)

			// Press up arrow
			const upKey: Key = {
				name: "up",
				sequence: "\x1b[A",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}

			// Should not throw and should not produce NaN
			expect(() => store.set(keyboardHandlerAtom, upKey)).not.toThrow()
			const selectedIndex = store.get(selectedIndexAtom)
			expect(selectedIndex).not.toBeNaN()
			expect(selectedIndex).toBe(0) // Should remain unchanged
		})

		it("should handle empty suggestions array without NaN", () => {
			// Type "/" to trigger autocomplete mode
			const slashKey: Key = {
				name: "/",
				sequence: "/",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, slashKey)

			// Autocomplete should now be visible
			expect(store.get(showAutocompleteAtom)).toBe(true)

			// Set up empty suggestions
			store.set(suggestionsAtom, [])
			store.set(argumentSuggestionsAtom, [])
			store.set(selectedIndexAtom, 0)

			// Press down arrow
			const downKey: Key = {
				name: "down",
				sequence: "\x1b[B",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}

			// Should not throw and should not produce NaN
			expect(() => store.set(keyboardHandlerAtom, downKey)).not.toThrow()
			const selectedIndex = store.get(selectedIndexAtom)
			expect(selectedIndex).not.toBeNaN()
			expect(selectedIndex).toBe(0) // Should remain unchanged
		})

		it("should handle empty suggestions array on up arrow without NaN", () => {
			// Type "/" to trigger autocomplete mode
			const slashKey: Key = {
				name: "/",
				sequence: "/",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, slashKey)

			// Autocomplete should now be visible
			expect(store.get(showAutocompleteAtom)).toBe(true)

			// Set up empty suggestions
			store.set(suggestionsAtom, [])
			store.set(argumentSuggestionsAtom, [])
			store.set(selectedIndexAtom, 0)

			// Press up arrow
			const upKey: Key = {
				name: "up",
				sequence: "\x1b[A",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}

			// Should not throw and should not produce NaN
			expect(() => store.set(keyboardHandlerAtom, upKey)).not.toThrow()
			const selectedIndex = store.get(selectedIndexAtom)
			expect(selectedIndex).not.toBeNaN()
			expect(selectedIndex).toBe(0) // Should remain unchanged
		})
	})
})
