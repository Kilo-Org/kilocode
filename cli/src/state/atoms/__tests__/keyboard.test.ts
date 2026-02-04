import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import {
	cursorPositionAtom,
	showAutocompleteAtom,
	suggestionsAtom,
	argumentSuggestionsAtom,
	selectedIndexAtom,
	fileMentionSuggestionsAtom,
	setFollowupSuggestionsAtom,
	followupSuggestionsAtom,
} from "../ui.js"
import { textBufferStringAtom, textBufferStateAtom } from "../textBuffer.js"
import {
	exitPromptVisibleAtom,
	exitRequestCounterAtom,
	keyboardHandlerAtom,
	submissionCallbackAtom,
	submitInputAtom,
	pastedTextReferencesAtom,
} from "../keyboard.js"
import { pendingApprovalAtom, approvalOptionsAtom } from "../approval.js"
import { historyDataAtom, historyModeAtom, historyIndexAtom as _historyIndexAtom } from "../history.js"
import { chatMessagesAtom, extensionModeAtom, customModesAtom } from "../extension.js"
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

		it("should clear text buffer when Ctrl+C is pressed", async () => {
			// Type some text first
			const chars = ["t", "e", "s", "t"]
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
			expect(store.get(textBufferStringAtom)).toBe("test")

			// Press Ctrl+C
			const ctrlCKey: Key = {
				name: "c",
				sequence: "\u0003",
				ctrl: true,
				meta: false,
				shift: false,
				paste: false,
			}
			await store.set(keyboardHandlerAtom, ctrlCKey)

			// Text buffer should be cleared
			expect(store.get(textBufferStringAtom)).toBe("")

			// Exit prompt should be visible
			expect(store.get(exitPromptVisibleAtom)).toBe(true)
		})

		it("should cycle to next mode when Shift+Tab is pressed", async () => {
			// Set initial mode to "code"
			store.set(extensionModeAtom, "code")
			store.set(customModesAtom, [])

			// Press Shift+Tab
			const shiftTabKey: Key = {
				name: "tab",
				sequence: "\t",
				ctrl: false,
				meta: false,
				shift: true,
				paste: false,
			}
			await store.set(keyboardHandlerAtom, shiftTabKey)

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Should have cycled to the next mode
			// DEFAULT_MODES order: architect, code, ask, debug, orchestrator
			// code is at index 1, so next is ask at index 2
			const newMode = store.get(extensionModeAtom)
			expect(newMode).toBe("ask")
		})

		it("should wrap around to first mode when at the last mode", async () => {
			// Set initial mode to the last default mode
			// DEFAULT_MODES order: architect, code, ask, debug, orchestrator, review
			store.set(extensionModeAtom, "review")
			store.set(customModesAtom, [])

			// Press Shift+Tab
			const shiftTabKey: Key = {
				name: "tab",
				sequence: "\t",
				ctrl: false,
				meta: false,
				shift: true,
				paste: false,
			}
			await store.set(keyboardHandlerAtom, shiftTabKey)

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Should have wrapped around to the first mode (architect)
			const newMode = store.get(extensionModeAtom)
			expect(newMode).toBe("architect")
		})

		it("should include custom modes in the cycle", async () => {
			// Set initial mode to "review" (last default mode)
			store.set(extensionModeAtom, "review")
			// Add a custom mode
			store.set(customModesAtom, [
				{
					slug: "custom-mode",
					name: "Custom Mode",
					description: "A custom mode for testing",
					roleDefinition: "You are a custom assistant",
					groups: [],
				},
			])

			// Press Shift+Tab
			const shiftTabKey: Key = {
				name: "tab",
				sequence: "\t",
				ctrl: false,
				meta: false,
				shift: true,
				paste: false,
			}
			await store.set(keyboardHandlerAtom, shiftTabKey)

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Should have cycled to the custom mode (after review)
			const newMode = store.get(extensionModeAtom)
			expect(newMode).toBe("custom-mode")
		})

		it("should not cycle mode when Tab is pressed without Shift", async () => {
			// Set initial mode
			store.set(extensionModeAtom, "code")
			store.set(customModesAtom, [])

			// Type some text first to avoid history mode
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

			// Press Tab without Shift
			const tabKey: Key = {
				name: "tab",
				sequence: "\t",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			await store.set(keyboardHandlerAtom, tabKey)

			// Mode should remain unchanged
			const mode = store.get(extensionModeAtom)
			expect(mode).toBe("code")
		})
	})

	describe("followup suggestions vs slash command input", () => {
		it("should submit typed /command (not followup suggestion) when input starts with '/'", async () => {
			const mockCallback = vi.fn()
			store.set(submissionCallbackAtom, { callback: mockCallback })

			// Followup suggestions are active (ask_followup_question), which normally takes priority over autocomplete.
			store.set(setFollowupSuggestionsAtom, [{ answer: "Yes, continue" }, { answer: "No, stop" }])

			// Type a slash command.
			for (const char of ["/", "h", "e", "l", "p"]) {
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

			// Simulate the "auto-select first item" behavior from autocomplete that can set selectedIndex to 0.
			// In the buggy behavior, followup mode is still active and this causes Enter to submit the followup suggestion instead.
			store.set(selectedIndexAtom, 0)

			// Press Enter to submit.
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

			expect(mockCallback).toHaveBeenCalledWith("/help")
			// Followup should remain active after running a slash command.
			expect(store.get(followupSuggestionsAtom)).toHaveLength(2)
			// Followup should not auto-select after command execution.
			expect(store.get(selectedIndexAtom)).toBe(-1)
		})

		it("should dismiss followup suggestions for /clear and /new commands", async () => {
			const mockCallback = vi.fn()
			store.set(submissionCallbackAtom, { callback: mockCallback })

			store.set(setFollowupSuggestionsAtom, [{ answer: "Yes, continue" }, { answer: "No, stop" }])

			// Type /clear
			for (const char of ["/", "c", "l", "e", "a", "r"]) {
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

			const enterKey: Key = {
				name: "return",
				sequence: "\r",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			await store.set(keyboardHandlerAtom, enterKey)
			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(mockCallback).toHaveBeenCalledWith("/clear")
			expect(store.get(followupSuggestionsAtom)).toHaveLength(0)

			// Re-seed followup and type /new
			store.set(setFollowupSuggestionsAtom, [{ answer: "Yes, continue" }, { answer: "No, stop" }])
			for (const char of ["/", "n", "e", "w"]) {
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
			await store.set(keyboardHandlerAtom, enterKey)
			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(mockCallback).toHaveBeenCalledWith("/new")
			expect(store.get(followupSuggestionsAtom)).toHaveLength(0)
		})
	})

	describe("paste abbreviation", () => {
		it("should insert small pastes directly into buffer", () => {
			// Small paste (less than threshold)
			const smallPaste = "line1\nline2\nline3"
			const pasteKey: Key = {
				name: "",
				sequence: smallPaste,
				ctrl: false,
				meta: false,
				shift: false,
				paste: true,
			}

			store.set(keyboardHandlerAtom, pasteKey)

			// Should insert text directly
			const text = store.get(textBufferStringAtom)
			expect(text).toBe(smallPaste)
		})

		it("should abbreviate large pastes as references", async () => {
			// Large paste (10+ lines to trigger abbreviation)
			const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`)
			const largePaste = lines.join("\n")
			const pasteKey: Key = {
				name: "",
				sequence: largePaste,
				ctrl: false,
				meta: false,
				shift: false,
				paste: true,
			}

			store.set(keyboardHandlerAtom, pasteKey)

			// Wait for async paste operation to complete
			await vi.waitFor(() => {
				const text = store.get(textBufferStringAtom)
				expect(text).toContain("[Pasted text #1 +15 lines]")
			})

			// Should insert abbreviated reference
			const text = store.get(textBufferStringAtom)
			expect(text).not.toContain("line 1")
		})

		it("should store full text in references map for large pastes", async () => {
			const lines = Array.from({ length: 12 }, (_, i) => `content line ${i + 1}`)
			const largePaste = lines.join("\n")
			const pasteKey: Key = {
				name: "",
				sequence: largePaste,
				ctrl: false,
				meta: false,
				shift: false,
				paste: true,
			}

			store.set(keyboardHandlerAtom, pasteKey)

			// Wait for async paste operation to complete
			await vi.waitFor(() => {
				const refs = store.get(pastedTextReferencesAtom)
				expect(refs.get(1)).toBe(largePaste)
			})
		})

		it("should increment reference numbers for multiple large pastes", async () => {
			const createLargePaste = (id: number) => {
				const lines = Array.from({ length: 11 }, (_, i) => `paste${id} line ${i + 1}`)
				return lines.join("\n")
			}

			// First large paste
			store.set(keyboardHandlerAtom, {
				name: "",
				sequence: createLargePaste(1),
				ctrl: false,
				meta: false,
				shift: false,
				paste: true,
			})

			// Wait for first paste to complete
			await vi.waitFor(() => {
				const text = store.get(textBufferStringAtom)
				expect(text).toContain("[Pasted text #1 +11 lines]")
			})

			// Add a space
			store.set(keyboardHandlerAtom, {
				name: "space",
				sequence: " ",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			})

			// Second large paste
			store.set(keyboardHandlerAtom, {
				name: "",
				sequence: createLargePaste(2),
				ctrl: false,
				meta: false,
				shift: false,
				paste: true,
			})

			// Wait for second paste to complete
			await vi.waitFor(() => {
				const text = store.get(textBufferStringAtom)
				expect(text).toContain("[Pasted text #2 +11 lines]")
			})
		})

		it("should handle paste at exactly threshold boundary", async () => {
			// Exactly 10 lines (threshold)
			const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`)
			const boundaryPaste = lines.join("\n")
			const pasteKey: Key = {
				name: "",
				sequence: boundaryPaste,
				ctrl: false,
				meta: false,
				shift: false,
				paste: true,
			}

			store.set(keyboardHandlerAtom, pasteKey)

			// Wait for async paste operation to complete
			await vi.waitFor(() => {
				const text = store.get(textBufferStringAtom)
				expect(text).toContain("[Pasted text #1 +10 lines]")
			})
		})

		it("should not abbreviate paste just below threshold", () => {
			// 9 lines (below threshold)
			const lines = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`)
			const smallPaste = lines.join("\n")
			const pasteKey: Key = {
				name: "",
				sequence: smallPaste,
				ctrl: false,
				meta: false,
				shift: false,
				paste: true,
			}

			store.set(keyboardHandlerAtom, pasteKey)

			// Should insert directly
			const text = store.get(textBufferStringAtom)
			expect(text).toBe(smallPaste)
			expect(text).not.toContain("[Pasted text")
		})

		it("should convert tabs to spaces in both direct and abbreviated pastes", () => {
			// Small paste with tabs
			const smallWithTabs = "col1\tcol2\ncol3\tcol4"
			store.set(keyboardHandlerAtom, {
				name: "",
				sequence: smallWithTabs,
				ctrl: false,
				meta: false,
				shift: false,
				paste: true,
			})

			const text = store.get(textBufferStringAtom)
			expect(text).not.toContain("\t")
			expect(text).toContain("col1  col2") // tabs converted to 2 spaces
		})
	})

	describe("word navigation", () => {
		it("should move cursor to previous word with Meta+B", () => {
			// Type "hello world test"
			const input = "hello world test"
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

			// Cursor should be at end
			let cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(16) // "hello world test" has 16 characters

			// Press Meta+B (previous word)
			const metaBKey: Key = {
				name: "b",
				sequence: "b",
				ctrl: false,
				meta: true,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, metaBKey)

			// Should move to start of "test"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(12) // Position of "t" in "hello world test"

			// Press Meta+B again
			store.set(keyboardHandlerAtom, metaBKey)

			// Should move to start of "world"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(6) // Position of "w" in "hello world test"

			// Press Meta+B again
			store.set(keyboardHandlerAtom, metaBKey)

			// Should move to start of "hello"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(0) // Start of text
		})

		it("should move cursor to next word with Meta+F", () => {
			// Type "hello world test"
			const input = "hello world test"
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

			// Move cursor to start
			const homeKey: Key = {
				name: "a",
				sequence: "a",
				ctrl: true,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, homeKey)

			let cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(0)

			// Press Meta+F (next word)
			const metaFKey: Key = {
				name: "f",
				sequence: "f",
				ctrl: false,
				meta: true,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, metaFKey)

			// Should move to start of "world"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(6) // Position of "w" in "hello world test"

			// Press Meta+F again
			store.set(keyboardHandlerAtom, metaFKey)

			// Should move to start of "test"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(12) // Position of "t" in "hello world test"

			// Press Meta+F again
			store.set(keyboardHandlerAtom, metaFKey)

			// Should move to end of text
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(16) // End of text
		})

		it("should handle word navigation across lines", () => {
			// Type "hello\nworld"
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

			// Add newline
			const enterKey: Key = {
				name: "return",
				sequence: "\r",
				ctrl: false,
				meta: false,
				shift: true, // Shift+Enter for newline
				paste: false,
			}
			store.set(keyboardHandlerAtom, enterKey)

			// Type "world"
			const worldChars = ["w", "o", "r", "l", "d"]
			for (const char of worldChars) {
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

			// Should have "hello\nworld"
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("hello\nworld")

			// Cursor should already be on second line at end of "world" after typing
			let cursor = store.get(cursorPositionAtom)
			expect(cursor.row).toBe(1)
			expect(cursor.col).toBe(5) // End of "world"

			// Press Meta+F (next word) - should stay on same line since no more words
			const metaFKey: Key = {
				name: "f",
				sequence: "f",
				ctrl: false,
				meta: true,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, metaFKey)

			cursor = store.get(cursorPositionAtom)
			expect(cursor.row).toBe(1)
			expect(cursor.col).toBe(5) // End of "world"

			// Press Meta+B (previous word) - should move to previous line
			const metaBKey: Key = {
				name: "b",
				sequence: "b",
				ctrl: false,
				meta: true,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, metaBKey)

			cursor = store.get(cursorPositionAtom)
			expect(cursor.row).toBe(0)
			expect(cursor.col).toBe(0) // Start of "hello"
		})

		it("should handle empty text gracefully", () => {
			// Empty buffer
			expect(store.get(textBufferStringAtom)).toBe("")

			// Press Meta+B - should not crash
			const metaBKey: Key = {
				name: "b",
				sequence: "b",
				ctrl: false,
				meta: true,
				shift: false,
				paste: false,
			}
			expect(() => store.set(keyboardHandlerAtom, metaBKey)).not.toThrow()

			// Press Meta+F - should not crash
			const metaFKey: Key = {
				name: "f",
				sequence: "f",
				ctrl: false,
				meta: true,
				shift: false,
				paste: false,
			}
			expect(() => store.set(keyboardHandlerAtom, metaFKey)).not.toThrow()
		})

		it("should handle single word correctly", () => {
			// Type "hello"
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

			// Move cursor to middle of word
			const leftKey: Key = {
				name: "left",
				sequence: "\x1b[D",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, leftKey)
			store.set(keyboardHandlerAtom, leftKey)

			let cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(3) // Position before 'l' in "hello"

			// Press Meta+B - should move to start of word
			const metaBKey: Key = {
				name: "b",
				sequence: "b",
				ctrl: false,
				meta: true,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, metaBKey)

			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(0) // Start of "hello"

			// Press Meta+F - should move to end of word
			const metaFKey: Key = {
				name: "f",
				sequence: "f",
				ctrl: false,
				meta: true,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, metaFKey)

			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(5) // End of "hello"
		})

		it("should move cursor to previous word with Meta+Left arrow", () => {
			// Type "hello world test"
			const input = "hello world test"
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

			// Cursor should be at end
			let cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(16) // "hello world test" has 16 characters

			// Press Meta+Left (previous word)
			const metaLeftKey: Key = {
				name: "left",
				sequence: "\x1b[1;3D",
				ctrl: false,
				meta: true,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, metaLeftKey)

			// Should move to start of "test"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(12) // Position of "t" in "hello world test"

			// Press Meta+Left again
			store.set(keyboardHandlerAtom, metaLeftKey)

			// Should move to start of "world"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(6) // Position of "w" in "hello world test"

			// Press Meta+Left again
			store.set(keyboardHandlerAtom, metaLeftKey)

			// Should move to start of "hello"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(0) // Start of text
		})

		it("should move cursor to next word with Meta+Right arrow", () => {
			// Type "hello world test"
			const input = "hello world test"
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

			// Move cursor to start
			const homeKey: Key = {
				name: "a",
				sequence: "a",
				ctrl: true,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, homeKey)

			let cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(0)

			// Press Meta+Right (next word)
			const metaRightKey: Key = {
				name: "right",
				sequence: "\x1b[1;3C",
				ctrl: false,
				meta: true,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, metaRightKey)

			// Should move to start of "world"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(6) // Position of "w" in "hello world test"

			// Press Meta+Right again
			store.set(keyboardHandlerAtom, metaRightKey)

			// Should move to start of "test"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(12) // Position of "t" in "hello world test"

			// Press Meta+Right again
			store.set(keyboardHandlerAtom, metaRightKey)

			// Should move to end of text
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(16) // End of text
		})

		it("should move one character with plain Left/Right arrows (no meta)", () => {
			// Type "hello"
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

			// Cursor should be at end
			let cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(5)

			// Press plain Left (no meta) - should move one character
			const leftKey: Key = {
				name: "left",
				sequence: "\x1b[D",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, leftKey)

			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(4) // Moved one character left

			// Press plain Right (no meta) - should move one character
			const rightKey: Key = {
				name: "right",
				sequence: "\x1b[C",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			store.set(keyboardHandlerAtom, rightKey)

			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(5) // Moved one character right
		})
	})

	describe("approval mode number key hotkeys", () => {
		it("should select and execute option when pressing number key hotkey (1, 2, 3)", async () => {
			// Set up a command approval with hierarchical options
			// Command "mkdir test-dir" should generate:
			// - Run Command (y)
			// - Always Run "mkdir" (1)
			// - Always Run "mkdir test-dir" (2)
			// - Reject (n)
			const mockMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "command",
				text: "mkdir test-dir",
				partial: false,
				isAnswered: false,
				say: "assistant",
			}
			store.set(pendingApprovalAtom, mockMessage)

			// Verify we have the expected options with number hotkeys
			const options = store.get(approvalOptionsAtom)
			expect(options.length).toBeGreaterThanOrEqual(4)
			expect(options[0].hotkey).toBe("y") // Run Command
			expect(options[1].hotkey).toBe("1") // Always Run "mkdir"
			expect(options[2].hotkey).toBe("2") // Always Run "mkdir test-dir"
			expect(options[options.length - 1].hotkey).toBe("n") // Reject

			// Press "1" key - should select the "Always Run mkdir" option
			const key1: Key = {
				name: "1",
				sequence: "1",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			await store.set(keyboardHandlerAtom, key1)

			// The option at index 1 should be selected
			const selectedIndex = store.get(selectedIndexAtom)
			expect(selectedIndex).toBe(1)
		})

		it("should select option 2 when pressing '2' key", async () => {
			const mockMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "command",
				text: "mkdir test-dir",
				partial: false,
				isAnswered: false,
				say: "assistant",
			}
			store.set(pendingApprovalAtom, mockMessage)

			// Press "2" key
			const key2: Key = {
				name: "2",
				sequence: "2",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			await store.set(keyboardHandlerAtom, key2)

			// The option at index 2 should be selected
			const selectedIndex = store.get(selectedIndexAtom)
			expect(selectedIndex).toBe(2)
		})

		it("should select option 3 when pressing '3' key for command with 3 hierarchy levels", async () => {
			// Command with 3 parts: "mkdir test-dir && touch test-dir/file.ts"
			// Should generate:
			// - Run Command (y)
			// - Always Run "mkdir" (1)
			// - Always Run "mkdir test-dir" (2)
			// - Always Run "mkdir test-dir && touch test-dir/file.ts" (3)
			// - Reject (n)
			const mockMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "command",
				text: "mkdir test-dir && touch test-dir/file.ts",
				partial: false,
				isAnswered: false,
				say: "assistant",
			}
			store.set(pendingApprovalAtom, mockMessage)

			// Verify we have option with hotkey "3"
			const options = store.get(approvalOptionsAtom)
			const option3 = options.find((opt) => opt.hotkey === "3")
			expect(option3).toBeDefined()

			// Press "3" key
			const key3: Key = {
				name: "3",
				sequence: "3",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			await store.set(keyboardHandlerAtom, key3)

			// The option at index 3 should be selected
			const selectedIndex = store.get(selectedIndexAtom)
			expect(selectedIndex).toBe(3)
		})

		it("should not select anything when pressing number key that has no matching hotkey", async () => {
			// Simple command with only 1 hierarchy level
			const mockMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "command",
				text: "ls",
				partial: false,
				isAnswered: false,
				say: "assistant",
			}
			store.set(pendingApprovalAtom, mockMessage)

			// Verify we only have options with hotkeys y, 1, n (no 2 or 3)
			const options = store.get(approvalOptionsAtom)
			expect(options.find((opt) => opt.hotkey === "2")).toBeUndefined()
			expect(options.find((opt) => opt.hotkey === "3")).toBeUndefined()

			// Initial selection should be 0
			expect(store.get(selectedIndexAtom)).toBe(0)

			// Press "2" key - should not change selection since there's no option with hotkey "2"
			const key2: Key = {
				name: "2",
				sequence: "2",
				ctrl: false,
				meta: false,
				shift: false,
				paste: false,
			}
			await store.set(keyboardHandlerAtom, key2)

			// Selection should remain unchanged
			const selectedIndex = store.get(selectedIndexAtom)
			expect(selectedIndex).toBe(0)
		})
	})
})
