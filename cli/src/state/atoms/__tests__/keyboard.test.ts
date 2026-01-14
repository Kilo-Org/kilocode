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

// Helper to simulate typing text
const type = (store: ReturnType<typeof createStore>, text: string) => {
	for (const char of text) {
		press(store, char)
	}
}

// Helper to simulate a key press
const press = (store: ReturnType<typeof createStore>, name: string, options: Partial<Key> = {}) => {
	const key: Key = {
		name,
		sequence: options.sequence ?? name,
		ctrl: options.ctrl ?? false,
		meta: options.meta ?? false,
		shift: options.shift ?? false,
		paste: options.paste ?? false,
	}

	// Add special sequences for certain keys
	const sequenceMap: Record<string, string> = {
		backspace: "\x7f",
		return: "\r",
		tab: "\t",
		escape: "\x1b",
		up: options.meta ? "\x1b[1;3A" : "\x1b[A",
		down: options.meta ? "\x1b[1;3B" : "\x1b[B",
		left: options.meta ? "\x1b[1;3D" : "\x1b[D",
		right: options.meta ? "\x1b[1;3C" : "\x1b[C",
	}
	if (sequenceMap[name] && !options.sequence) {
		key.sequence = sequenceMap[name]
	}

	return store.set(keyboardHandlerAtom, key)
}

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
			press(store, "h")

			// Check that buffer was updated
			const updatedText = store.get(textBufferStringAtom)
			expect(updatedText).toBe("h")
		})

		it("should update textBufferAtom when typing multiple characters", () => {
			// Type 'hello'
			type(store, "hello")

			const text = store.get(textBufferStringAtom)
			expect(text).toBe("hello")
		})

		it("should update cursor position when typing", () => {
			// Type 'hi'
			type(store, "hi")

			const cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(2)
			expect(cursor.row).toBe(0)
		})

		it("should handle backspace correctly", () => {
			// Type 'hello'
			type(store, "hello")

			// Press backspace
			press(store, "backspace")

			const text = store.get(textBufferStringAtom)
			expect(text).toBe("hell")
		})

		it("should handle newline insertion with Shift+Enter", () => {
			// Type 'hello'
			type(store, "hello")

			// Press Shift+Enter
			press(store, "return", { shift: true })

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
			type(store, "hello")

			// Press Enter
			await press(store, "return")

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(mockCallback).toHaveBeenCalledWith("hello")
		})

		it("should not call submission callback when callback is null", () => {
			// Don't set a callback
			store.set(submissionCallbackAtom, { callback: null })

			// Type 'hello'
			type(store, "hello")

			// Press Enter - should not throw error
			expect(() => press(store, "return")).not.toThrow()
		})

		it("should not call submission callback when text is empty", () => {
			const mockCallback = vi.fn()
			store.set(submissionCallbackAtom, { callback: mockCallback })

			// Press Enter without typing anything
			press(store, "return")

			expect(mockCallback).not.toHaveBeenCalled()
		})

		it("should not call submission callback when text is only whitespace", () => {
			const mockCallback = vi.fn()
			store.set(submissionCallbackAtom, { callback: mockCallback })

			// Type spaces
			type(store, "   ")

			// Press Enter
			press(store, "return")

			expect(mockCallback).not.toHaveBeenCalled()
		})

		it("should handle non-function callback gracefully", () => {
			// Set callback to a non-function value
			store.set(submissionCallbackAtom, { callback: "not a function" as unknown as (() => void) | null })

			// Type 'hello'
			type(store, "hello")

			// Press Enter - should not throw error
			expect(() => press(store, "return")).not.toThrow()
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
			type(store, "/mo")

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
			press(store, "tab")

			// Should complete to '/mode'
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/mode")
		})

		it("should complete command even when user types wrong letters", () => {
			// Type '/modl' - typo, but 'model' should still be suggested
			type(store, "/modl")

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
			press(store, "tab")

			// Should replace '/modl' with '/model' (not '/modlmodel')
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/model")
		})

		it("should complete argument by replacing partial text", () => {
			// Type '/mode tes' - this will automatically trigger autocomplete
			type(store, "/mode tes")

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
			press(store, "tab")

			// Should replace 'tes' with 'test' to complete '/mode test'
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/mode test")
		})

		it("should replace partial argument with full suggestion", () => {
			// Bug fix: Type '/model info gpt' with suggestion 'openai/gpt-5'
			// This test verifies the fix where Tab was incorrectly appending instead of replacing
			type(store, "/model info gpt")

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
			press(store, "tab")

			// Should replace 'gpt' with 'openai/gpt-5' (not append to get 'gptopenai/gpt-5')
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/model info openai/gpt-5")
		})

		it("should complete argument from empty with trailing space", () => {
			// Type '/model info ' (with trailing space)
			type(store, "/model info ")

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
			press(store, "tab")

			// Should add the full suggestion value
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/model info openai/gpt-4")
		})

		it("should handle exact match completion", () => {
			// Type '/help' - this will automatically trigger autocomplete
			type(store, "/help")

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
			press(store, "tab")

			// Should not add anything (already complete)
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("/help")
		})

		it("should update cursor position after tab completion", () => {
			// Type '/mo' - this will automatically trigger autocomplete
			type(store, "/mo")

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
			press(store, "tab")

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
			// Should not throw and should not produce NaN
			expect(() => press(store, "down")).not.toThrow()
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
			// Should not throw and should not produce NaN
			expect(() => press(store, "up")).not.toThrow()
			const selectedIndex = store.get(selectedIndexAtom)
			expect(selectedIndex).not.toBeNaN()
			expect(selectedIndex).toBe(0) // Should remain unchanged
		})

		it("should handle empty suggestions array without NaN", () => {
			// Type "/" to trigger autocomplete mode
			press(store, "/")

			// Autocomplete should now be visible
			expect(store.get(showAutocompleteAtom)).toBe(true)

			// Set up empty suggestions
			store.set(suggestionsAtom, [])
			store.set(argumentSuggestionsAtom, [])
			store.set(selectedIndexAtom, 0)

			// Press down arrow
			// Should not throw and should not produce NaN
			expect(() => press(store, "down")).not.toThrow()
			const selectedIndex = store.get(selectedIndexAtom)
			expect(selectedIndex).not.toBeNaN()
			expect(selectedIndex).toBe(0) // Should remain unchanged
		})

		it("should handle empty suggestions array on up arrow without NaN", () => {
			// Type "/" to trigger autocomplete mode
			press(store, "/")

			// Autocomplete should now be visible
			expect(store.get(showAutocompleteAtom)).toBe(true)

			// Set up empty suggestions
			store.set(suggestionsAtom, [])
			store.set(argumentSuggestionsAtom, [])
			store.set(selectedIndexAtom, 0)

			// Press up arrow
			// Should not throw and should not produce NaN
			expect(() => press(store, "up")).not.toThrow()
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
			press(store, "up")

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

			// First press - enter history mode
			press(store, "up")
			expect(store.get(textBufferStringAtom)).toBe("what time is now?")
			expect(store.get(historyModeAtom)).toBe(true)

			// Second press - navigate to older
			press(store, "up")
			expect(store.get(textBufferStringAtom)).toBe("/mode ask")

			// Third press - navigate to oldest
			press(store, "up")
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
			type(store, "hi")

			// Press up arrow
			press(store, "up")

			// Should not enter history mode
			expect(store.get(historyModeAtom)).toBe(false)
			// Text should remain unchanged
			expect(store.get(textBufferStringAtom)).toBe("hi")
		})
	})

	describe("file mention suggestions", () => {
		it("should clear suggestions and add space on ESC without clearing buffer", () => {
			// Type some text first
			type(store, "check @confi")

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
			press(store, "escape")

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
			type(store, "some text")

			// Verify buffer has content
			expect(store.get(textBufferStringAtom)).toBe("some text")

			// Ensure no file mention suggestions
			store.set(fileMentionSuggestionsAtom, [])

			// Press ESC
			press(store, "escape")

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
			type(store, "hello")

			// Verify we have text in the buffer
			expect(store.get(textBufferStringAtom)).toBe("hello")

			// Press ESC while streaming
			await press(store, "escape")

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
			type(store, "hello")

			// Verify we have text in the buffer
			expect(store.get(textBufferStringAtom)).toBe("hello")

			// Press ESC while NOT streaming
			await press(store, "escape")

			// When not streaming, ESC should clear the buffer (normal behavior)
			expect(store.get(textBufferStringAtom)).toBe("")
		})

		it("should require confirmation before exiting on Ctrl+C", async () => {
			await press(store, "c", { ctrl: true })

			expect(store.get(exitPromptVisibleAtom)).toBe(true)
			expect(store.get(exitRequestCounterAtom)).toBe(0)

			await press(store, "c", { ctrl: true })

			expect(store.get(exitPromptVisibleAtom)).toBe(false)
			expect(store.get(exitRequestCounterAtom)).toBe(1)
		})

		it("should clear text buffer when Ctrl+C is pressed", async () => {
			// Type some text first
			type(store, "test")

			// Verify we have text in the buffer
			expect(store.get(textBufferStringAtom)).toBe("test")

			// Press Ctrl+C
			await press(store, "c", { ctrl: true })

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
			await press(store, "tab", { shift: true })

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
			// DEFAULT_MODES order: architect, code, ask, debug, orchestrator
			store.set(extensionModeAtom, "orchestrator")
			store.set(customModesAtom, [])

			// Press Shift+Tab
			await press(store, "tab", { shift: true })

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Should have wrapped around to the first mode (architect)
			const newMode = store.get(extensionModeAtom)
			expect(newMode).toBe("architect")
		})

		it("should include custom modes in the cycle", async () => {
			// Set initial mode to "orchestrator" (last default mode)
			store.set(extensionModeAtom, "orchestrator")
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
			await press(store, "tab", { shift: true })

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Should have cycled to the custom mode (after orchestrator)
			const newMode = store.get(extensionModeAtom)
			expect(newMode).toBe("custom-mode")
		})

		it("should not cycle mode when Tab is pressed without Shift", async () => {
			// Set initial mode
			store.set(extensionModeAtom, "code")
			store.set(customModesAtom, [])

			// Type some text first to avoid history mode
			type(store, "hi")

			// Press Tab without Shift
			await press(store, "tab")

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
			type(store, "/help")

			// Simulate the "auto-select first item" behavior from autocomplete that can set selectedIndex to 0.
			// In the buggy behavior, followup mode is still active and this causes Enter to submit the followup suggestion instead.
			store.set(selectedIndexAtom, 0)

			// Press Enter to submit.
			await press(store, "return")

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
			type(store, "/clear")

			await press(store, "return")
			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(mockCallback).toHaveBeenCalledWith("/clear")
			expect(store.get(followupSuggestionsAtom)).toHaveLength(0)

			// Re-seed followup and type /new
			store.set(setFollowupSuggestionsAtom, [{ answer: "Yes, continue" }, { answer: "No, stop" }])
			type(store, "/new")
			await press(store, "return")
			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(mockCallback).toHaveBeenCalledWith("/new")
			expect(store.get(followupSuggestionsAtom)).toHaveLength(0)
		})
	})

	describe("paste abbreviation", () => {
		it("should insert small pastes directly into buffer", () => {
			// Small paste (less than threshold)
			const smallPaste = "line1\nline2\nline3"
			press(store, "", { paste: true, sequence: smallPaste })

			// Should insert text directly
			const text = store.get(textBufferStringAtom)
			expect(text).toBe(smallPaste)
		})

		it("should abbreviate large pastes as references", async () => {
			// Large paste (10+ lines to trigger abbreviation)
			const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`)
			const largePaste = lines.join("\n")
			press(store, "", { paste: true, sequence: largePaste })

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
			press(store, "", { paste: true, sequence: largePaste })

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
			press(store, "", { paste: true, sequence: createLargePaste(1) })

			// Wait for first paste to complete
			await vi.waitFor(() => {
				const text = store.get(textBufferStringAtom)
				expect(text).toContain("[Pasted text #1 +11 lines]")
			})

			// Add a space
			press(store, " ")

			// Second large paste
			press(store, "", { paste: true, sequence: createLargePaste(2) })

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
			press(store, "", { paste: true, sequence: boundaryPaste })

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
			press(store, "", { paste: true, sequence: smallPaste })

			// Should insert directly
			const text = store.get(textBufferStringAtom)
			expect(text).toBe(smallPaste)
			expect(text).not.toContain("[Pasted text")
		})

		it("should convert tabs to spaces in both direct and abbreviated pastes", async () => {
			// Small paste with tabs
			const smallWithTabs = "col1\tcol2\ncol3\tcol4"
			press(store, "", { paste: true, sequence: smallWithTabs })

			const text = store.get(textBufferStringAtom)
			expect(text).not.toContain("\t")
			expect(text).toContain("col1  col2") // tabs converted to 2 spaces

			// Large paste with tabs
			const largeWithTabs = "col1\tcol2\n" + Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n")
			press(store, "", { paste: true, sequence: largeWithTabs })

			// Should be stored in references map without tabs
			await vi.waitFor(() => {
				const refs = store.get(pastedTextReferencesAtom)
				const storedText = refs.get(1) // first large paste
				expect(storedText).toBeDefined()
				expect(storedText).not.toContain("\t")
				expect(storedText).toContain("col1  col2")
			})
		})
	})

	describe("word navigation", () => {
		it("should move cursor to previous word with Meta+B", () => {
			// Type "hello world test"
			type(store, "hello world test")

			// Cursor should be at end
			let cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(16) // "hello world test" has 16 characters

			// Press Meta+B (previous word)
			press(store, "b", { meta: true })

			// Should move to start of "test"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(12) // Position of "t" in "hello world test"

			// Press Meta+B again
			press(store, "b", { meta: true })

			// Should move to start of "world"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(6) // Position of "w" in "hello world test"

			// Press Meta+B again
			press(store, "b", { meta: true })

			// Should move to start of "hello"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(0) // Start of text
		})

		it("should move cursor to next word with Meta+F", () => {
			// Type "hello world test"
			type(store, "hello world test")

			// Move cursor to start
			press(store, "a", { ctrl: true })

			let cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(0)

			// Press Meta+F (next word)
			press(store, "f", { meta: true })

			// Should move to start of "world"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(6) // Position of "w" in "hello world test"

			// Press Meta+F again
			press(store, "f", { meta: true })

			// Should move to start of "test"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(12) // Position of "t" in "hello world test"

			// Press Meta+F again
			press(store, "f", { meta: true })

			// Should move to end of text
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(16) // End of text
		})

		it("should handle word navigation across lines", () => {
			// Type "hello\nworld"
			type(store, "hello")

			// Add newline
			press(store, "return", { shift: true })

			// Type "world"
			type(store, "world")

			// Should have "hello\nworld"
			const text = store.get(textBufferStringAtom)
			expect(text).toBe("hello\nworld")

			// Cursor should already be on second line at end of "world" after typing
			let cursor = store.get(cursorPositionAtom)
			expect(cursor.row).toBe(1)
			expect(cursor.col).toBe(5) // End of "world"

			// Press Meta+F (next word) - should stay on same line since no more words
			press(store, "f", { meta: true })

			cursor = store.get(cursorPositionAtom)
			expect(cursor.row).toBe(1)
			expect(cursor.col).toBe(5) // End of "world"

			// Press Meta+B (previous word) - should move to previous line
			press(store, "b", { meta: true })

			cursor = store.get(cursorPositionAtom)
			expect(cursor.row).toBe(0)
			expect(cursor.col).toBe(0) // Start of "hello"
		})

		it("should handle empty text gracefully", () => {
			// Empty buffer
			expect(store.get(textBufferStringAtom)).toBe("")

			// Press Meta+B - should not crash
			expect(() => press(store, "b", { meta: true })).not.toThrow()

			// Press Meta+F - should not crash
			expect(() => press(store, "f", { meta: true })).not.toThrow()
		})

		it("should handle single word correctly", () => {
			// Type "hello"
			type(store, "hello")

			// Move cursor to middle of word
			press(store, "left")
			press(store, "left")

			let cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(3) // Position before 'l' in "hello"

			// Press Meta+B - should move to start of word
			press(store, "b", { meta: true })

			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(0) // Start of "hello"

			// Press Meta+F - should move to end of word
			press(store, "f", { meta: true })

			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(5) // End of "hello"
		})

		it("should move cursor to previous word with Meta+Left arrow", () => {
			// Type "hello world test"
			type(store, "hello world test")

			// Cursor should be at end
			let cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(16) // "hello world test" has 16 characters

			// Press Meta+Left (previous word)
			press(store, "left", { meta: true })

			// Should move to start of "test"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(12) // Position of "t" in "hello world test"

			// Press Meta+Left again
			press(store, "left", { meta: true })

			// Should move to start of "world"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(6) // Position of "w" in "hello world test"

			// Press Meta+Left again
			press(store, "left", { meta: true })

			// Should move to start of "hello"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(0) // Start of text
		})

		it("should move cursor to next word with Meta+Right arrow", () => {
			// Type "hello world test"
			type(store, "hello world test")

			// Move cursor to start
			press(store, "a", { ctrl: true })

			let cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(0)

			// Press Meta+Right (next word)
			press(store, "right", { meta: true })

			// Should move to start of "world"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(6) // Position of "w" in "hello world test"

			// Press Meta+Right again
			press(store, "right", { meta: true })

			// Should move to start of "test"
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(12) // Position of "t" in "hello world test"

			// Press Meta+Right again
			press(store, "right", { meta: true })

			// Should move to end of text
			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(16) // End of text
		})

		it("should move one character with plain Left/Right arrows (no meta)", () => {
			// Type "hello"
			type(store, "hello")

			// Cursor should be at end
			let cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(5)

			// Press plain Left (no meta) - should move one character
			press(store, "left")

			cursor = store.get(cursorPositionAtom)
			expect(cursor.col).toBe(4) // Moved one character left

			// Press plain Right (no meta) - should move one character
			press(store, "right")

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
			await press(store, "1")

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
			await press(store, "2")

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
			await press(store, "3")

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
			await press(store, "2")

			// Selection should remain unchanged
			const selectedIndex = store.get(selectedIndexAtom)
			expect(selectedIndex).toBe(0)
		})
	})
})
