import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import {
	cursorPositionAtom,
	showAutocompleteAtom,
	suggestionsAtom,
	argumentSuggestionsAtom,
	selectedIndexAtom,
	fileMentionSuggestionsAtom,
} from "../ui.js"
import { textBufferStringAtom, textBufferStateAtom } from "../textBuffer.js"
import {
	exitPromptVisibleAtom,
	exitRequestCounterAtom,
	keyboardHandlerAtom,
	submissionCallbackAtom,
	submitInputAtom,
} from "../keyboard.js"
import { pendingApprovalAtom } from "../approval.js"
import { historyDataAtom, historyModeAtom, historyIndexAtom as _historyIndexAtom } from "../history.js"
import { chatMessagesAtom } from "../extension.js"
import { extensionServiceAtom, isServiceReadyAtom } from "../service.js"
import type { Key } from "../../../types/keyboard.js"
import type { CommandSuggestion, ArgumentSuggestion, FileMentionSuggestion } from "../../../services/autocomplete.js"
import type { Command } from "../../../commands/core/types.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"
import type { ExtensionService } from "../../../services/extension.js"

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
		it("should call submission callback when Enter is pressed with text", async () => {
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
			await store.set(keyboardHandlerAtom, enterKey)

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 10))

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
			store.set(submissionCallbackAtom, { callback: "not a function" as unknown as (() => void) | null })

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
			store.set(submitInputAtom, buffer as unknown as string)

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

			// Should complete to '/mode'
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/mode")
		})

		it("should complete command even when user types wrong letters", () => {
			// Type '/modl' - typo, but 'model' should still be suggested
			const chars = ["/", "m", "o", "d", "l"]
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

			// Autocomplete should now be visible
			expect(store.get(showAutocompleteAtom)).toBe(true)

			// Set up autocomplete suggestions
			const mockCommand: Command = {
				name: "model",
				description: "Manage models",
				aliases: [],
				usage: "/model <subcommand>",
				examples: ["/model info"],
				category: "settings",
				handler: vi.fn(),
			}
			const mockSuggestion: CommandSuggestion = {
				command: mockCommand,
				matchScore: 70,
				highlightedName: "model",
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

			// Should replace '/modl' with '/model' (not '/modlmodel')
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/model")
		})

		it("should complete argument by replacing partial text", () => {
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

			// Should replace 'tes' with 'test' to complete '/mode test'
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/mode test")
		})

		it("should replace partial argument with full suggestion", () => {
			// Bug fix: Type '/model info gpt' with suggestion 'openai/gpt-5'
			// This test verifies the fix where Tab was incorrectly appending instead of replacing
			const input = "/model info gpt"
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

			// Set up argument suggestions
			const mockArgumentSuggestion: ArgumentSuggestion = {
				value: "openai/gpt-5",
				description: "OpenAI GPT-5 model",
				matchScore: 90,
				highlightedValue: "openai/gpt-5",
			}
			store.set(argumentSuggestionsAtom, [mockArgumentSuggestion])
			store.set(suggestionsAtom, []) // No command suggestions
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

			// Should replace 'gpt' with 'openai/gpt-5' (not append to get 'gptopenai/gpt-5')
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/model info openai/gpt-5")
		})

		it("should complete argument from empty with trailing space", () => {
			// Type '/model info ' (with trailing space)
			const input = "/model info "
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

			// Set up argument suggestions
			const mockArgumentSuggestion: ArgumentSuggestion = {
				value: "openai/gpt-4",
				description: "OpenAI GPT-4 model",
				matchScore: 100,
				highlightedValue: "openai/gpt-4",
			}
			store.set(argumentSuggestionsAtom, [mockArgumentSuggestion])
			store.set(suggestionsAtom, [])
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

			// Should add the full suggestion value
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/model info openai/gpt-4")
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
			const mockMessage = {
				ts: Date.now(),
				type: "say", // Not "ask", so approvalOptions will be empty
				say: "test",
				text: "test message",
			} as ExtensionChatMessage
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
			const mockMessage = {
				ts: Date.now(),
				type: "say", // Not "ask", so approvalOptions will be empty
				say: "test",
				text: "test message",
			} as ExtensionChatMessage
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

	describe("history navigation", () => {
		it("should display most recent entry when entering history mode with up arrow", () => {
			// Set up history with multiple entries
			store.set(historyDataAtom, {
				version: "1.0.0",
				entries: [
					{ prompt: "/help", timestamp: 1 },
					{ prompt: "/mode ask", timestamp: 2 },
					{ prompt: "what time is now?", timestamp: 3 },
				],
				maxSize: 500,
			})

			// Ensure input is empty
			expect(store.get(textBufferStringAtom)).toBe("")

			// Press up arrow to enter history mode
			const upKey: Key = {
				name: "up",
				sequence: "\x1b[A",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, upKey)

			// Should display the most recent entry
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("what time is now?")

			// Should be in history mode
			expect(store.get(historyModeAtom)).toBe(true)
		})

		it("should navigate to older entries on subsequent up presses", () => {
			// Set up history with multiple entries
			store.set(historyDataAtom, {
				version: "1.0.0",
				entries: [
					{ prompt: "/help", timestamp: 1 },
					{ prompt: "/mode ask", timestamp: 2 },
					{ prompt: "what time is now?", timestamp: 3 },
				],
				maxSize: 500,
			})

			// Press up arrow to enter history mode (shows most recent)
			const upKey: Key = {
				name: "up",
				sequence: "\x1b[A",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}

			// First press - enter history mode
			store.set(keyboardHandlerAtom, upKey)
			expect(store.get(textBufferStringAtom)).toBe("what time is now?")
			expect(store.get(historyModeAtom)).toBe(true)

			// Second press - navigate to older
			store.set(keyboardHandlerAtom, upKey)
			expect(store.get(textBufferStringAtom)).toBe("/mode ask")

			// Third press - navigate to oldest
			store.set(keyboardHandlerAtom, upKey)
			expect(store.get(textBufferStringAtom)).toBe("/help")
		})

		it("should not enter history mode when input is not empty", () => {
			// Set up history
			store.set(historyDataAtom, {
				version: "1.0.0",
				entries: [{ prompt: "test", timestamp: 1 }],
				maxSize: 500,
			})

			// Type some text
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

			// Press up arrow
			const upKey: Key = {
				name: "up",
				sequence: "\x1b[A",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, upKey)

			// Should not enter history mode
			expect(store.get(historyModeAtom)).toBe(false)
			// Text should remain unchanged
			expect(store.get(textBufferStringAtom)).toBe("hi")
		})
	})

	describe("file mention suggestions", () => {
		it("should clear suggestions and add space on ESC without clearing buffer", () => {
			// Type some text first
			const input = "check @confi"
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

			// Verify initial buffer
			expect(store.get(textBufferStringAtom)).toBe("check @confi")

			// Set up file mention suggestions (simulating file autocomplete)
			const mockFileSuggestion: FileMentionSuggestion = {
				type: "file",
				value: "config.json",
				description: "Configuration file",
				matchScore: 90,
				highlightedValue: "config.json",
			}
			store.set(fileMentionSuggestionsAtom, [mockFileSuggestion])

			// Verify suggestions are set
			expect(store.get(fileMentionSuggestionsAtom).length).toBe(1)

			// Press ESC
			const escapeKey: Key = {
				name: "escape",
				sequence: "\x1b",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, escapeKey)

			// File mention suggestions should be cleared
			expect(store.get(fileMentionSuggestionsAtom).length).toBe(0)

			// Buffer should have a space added (not cleared)
			expect(store.get(textBufferStringAtom)).toBe("check @confi ")

			// Cursor should be after the space
			const cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(13) // "check @confi " has 13 characters
		})

		it("should clear buffer on ESC when no file mention suggestions", () => {
			// Type some text
			const input = "some text"
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

			// Verify buffer has content
			expect(store.get(textBufferStringAtom)).toBe("some text")

			// Ensure no file mention suggestions
			store.set(fileMentionSuggestionsAtom, [])

			// Press ESC
			const escapeKey: Key = {
				name: "escape",
				sequence: "\x1b",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, escapeKey)

			// Buffer should be cleared (normal ESC behavior)
			expect(store.get(textBufferStringAtom)).toBe("")
		})
	})

	describe("global hotkeys", () => {
		beforeEach(() => {
			// Mock the extension service to prevent "ExtensionService not available" error
			const mockService: Partial<ExtensionService> = {
				initialize: vi.fn(),
				dispose: vi.fn(),
				on: vi.fn(),
				off: vi.fn(),
				sendWebviewMessage: vi.fn().mockResolvedValue(undefined),
				isReady: vi.fn().mockReturnValue(true),
			}
			store.set(extensionServiceAtom, mockService as ExtensionService)
			store.set(isServiceReadyAtom, true)
		})

		it("should cancel task when ESC is pressed while streaming", async () => {
			// Set up streaming state by adding a partial message
			// isStreamingAtom returns true when the last message is partial
			const streamingMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Processing...",
				partial: true, // This makes isStreamingAtom return true
			}
			store.set(chatMessagesAtom, [streamingMessage])

			// Type some text first
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

			// Verify we have text in the buffer
			expect(store.get(textBufferStringAtom)).toBe("hello")

			// Press ESC while streaming
			const escapeKey: Key = {
				name: "escape",
				sequence: "\x1b",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			await store.set(keyboardHandlerAtom, escapeKey)

			// When streaming, ESC should cancel the task and NOT clear the buffer
			// (because it returns early from handleGlobalHotkeys)
			expect(store.get(textBufferStringAtom)).toBe("hello")
		})

		it("should clear buffer when ESC is pressed while NOT streaming", async () => {
			// Set up non-streaming state by adding a complete message
			const completeMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Done",
				partial: false, // This makes isStreamingAtom return false
			}
			store.set(chatMessagesAtom, [completeMessage])

			// Type some text
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

			// Verify we have text in the buffer
			expect(store.get(textBufferStringAtom)).toBe("hello")

			// Press ESC while NOT streaming
			const escapeKey: Key = {
				name: "escape",
				sequence: "\x1b",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			await store.set(keyboardHandlerAtom, escapeKey)

			// When not streaming, ESC should clear the buffer (normal behavior)
			expect(store.get(textBufferStringAtom)).toBe("")
		})

		it("should require confirmation before exiting on Ctrl+C", async () => {
			const ctrlCKey: Key = {
				name: "c",
				sequence: "\u0003",
				ctrl: true,
				meta: false,
				shift: false,
				paste: false,
			}

			await store.set(keyboardHandlerAtom, ctrlCKey)

			expect(store.get(exitPromptVisibleAtom)).toBe(true)
			expect(store.get(exitRequestCounterAtom)).toBe(0)

			await store.set(keyboardHandlerAtom, ctrlCKey)

			expect(store.get(exitPromptVisibleAtom)).toBe(false)
			expect(store.get(exitRequestCounterAtom)).toBe(1)
		})
	})
})
