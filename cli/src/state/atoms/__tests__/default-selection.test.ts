/**
 * Tests for default selection behavior in dropdown menus
 *
 * This test file verifies that when dropdown menus appear (slash commands,
 * argument suggestions, file mentions, approval menus), the first entry
 * is selected by default.
 */

import { describe, it, expect, vi } from "vitest"
import { createStore } from "jotai"
import {
	selectedIndexAtom,
	suggestionsAtom,
	argumentSuggestionsAtom,
	fileMentionSuggestionsAtom,
	setSuggestionsAtom,
	setArgumentSuggestionsAtom,
	setFileMentionSuggestionsAtom,
	setFollowupSuggestionsAtom,
	followupSuggestionsAtom,
} from "../ui.js"
import { setPendingApprovalAtom, pendingApprovalAtom, approvalOptionsAtom } from "../approval.js"
import type { CommandSuggestion, ArgumentSuggestion, FileMentionSuggestion } from "../../../services/autocomplete.js"
import type { Command } from "../../../commands/core/types.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"

// Helper to create a mock command
const createMockCommand = (name: string): Command => ({
	name,
	description: `${name} command`,
	aliases: [],
	usage: `/${name}`,
	examples: [`/${name}`],
	category: "test",
	handler: vi.fn(),
})

// Helper to create a mock command suggestion
const createCommandSuggestion = (name: string): CommandSuggestion => ({
	command: createMockCommand(name),
	matchScore: 90,
	highlightedName: name,
})

// Helper to create a mock argument suggestion
const createArgumentSuggestion = (value: string): ArgumentSuggestion => ({
	value,
	description: `${value} description`,
	matchScore: 90,
	highlightedValue: value,
})

// Helper to create a mock file mention suggestion
const createFileMentionSuggestion = (path: string): FileMentionSuggestion => ({
	value: path,
	description: `in ${path.split("/").slice(0, -1).join("/")}`,
	matchScore: 90,
	highlightedValue: path,
	type: "file",
})

// Helper to create a mock approval message
const createApprovalMessage = (ask: string, text: string = "{}"): ExtensionChatMessage => ({
	type: "ask",
	ask,
	text,
	ts: Date.now(),
	partial: false,
	isAnswered: false,
	say: "assistant",
})

describe("default selection behavior", () => {
	describe("slash command suggestions", () => {
		it("should set selectedIndex to 0 when command suggestions are set", () => {
			const store = createStore()

			// Initially, selectedIndex should be 0
			expect(store.get(selectedIndexAtom)).toBe(0)

			// Set some command suggestions
			const suggestions = [createCommandSuggestion("help"), createCommandSuggestion("mode")]

			store.set(setSuggestionsAtom, suggestions)

			// selectedIndex should be 0 (first entry selected)
			expect(store.get(selectedIndexAtom)).toBe(0)
			expect(store.get(suggestionsAtom)).toHaveLength(2)
		})

		it("should reset selectedIndex to -1 when command suggestions are cleared", () => {
			const store = createStore()

			// Set some suggestions first
			store.set(setSuggestionsAtom, [createCommandSuggestion("help")])
			expect(store.get(selectedIndexAtom)).toBe(0)

			// Navigate to a different index
			store.set(selectedIndexAtom, 5)

			// Clear suggestions - should reset selectedIndex to -1 (no selection)
			store.set(setSuggestionsAtom, [])

			// selectedIndex should be reset to -1
			expect(store.get(selectedIndexAtom)).toBe(-1)
		})

		it("should reset selectedIndex to 0 when new suggestions replace old ones", () => {
			const store = createStore()

			// Set initial suggestions
			store.set(setSuggestionsAtom, [createCommandSuggestion("help"), createCommandSuggestion("mode")])

			// Manually change selectedIndex to simulate user navigation
			store.set(selectedIndexAtom, 1)
			expect(store.get(selectedIndexAtom)).toBe(1)

			// Set new suggestions
			store.set(setSuggestionsAtom, [createCommandSuggestion("new"), createCommandSuggestion("task")])

			// selectedIndex should be reset to 0
			expect(store.get(selectedIndexAtom)).toBe(0)
		})
	})

	describe("argument suggestions", () => {
		it("should set selectedIndex to 0 when argument suggestions are set", () => {
			const store = createStore()

			// Set some argument suggestions
			const suggestions = [createArgumentSuggestion("code"), createArgumentSuggestion("architect")]

			store.set(setArgumentSuggestionsAtom, suggestions)

			// selectedIndex should be 0 (first entry selected)
			expect(store.get(selectedIndexAtom)).toBe(0)
			expect(store.get(argumentSuggestionsAtom)).toHaveLength(2)
		})

		it("should reset selectedIndex to -1 when argument suggestions are cleared", () => {
			const store = createStore()

			// Set some suggestions first
			store.set(setArgumentSuggestionsAtom, [createArgumentSuggestion("code")])
			expect(store.get(selectedIndexAtom)).toBe(0)

			// Navigate to a different index
			store.set(selectedIndexAtom, 5)

			// Clear suggestions - should reset selectedIndex to -1 (no selection)
			store.set(setArgumentSuggestionsAtom, [])

			// selectedIndex should be reset to -1
			expect(store.get(selectedIndexAtom)).toBe(-1)
		})
	})

	describe("file mention suggestions", () => {
		it("should set selectedIndex to 0 when file mention suggestions are set", () => {
			const store = createStore()

			// Set some file mention suggestions
			const suggestions = [createFileMentionSuggestion("src/index.ts"), createFileMentionSuggestion("src/app.ts")]

			store.set(setFileMentionSuggestionsAtom, suggestions)

			// selectedIndex should be 0 (first entry selected)
			expect(store.get(selectedIndexAtom)).toBe(0)
			expect(store.get(fileMentionSuggestionsAtom)).toHaveLength(2)
		})

		it("should reset selectedIndex to -1 when file mention suggestions are cleared", () => {
			const store = createStore()

			// Set some suggestions first
			store.set(setFileMentionSuggestionsAtom, [createFileMentionSuggestion("src/index.ts")])
			expect(store.get(selectedIndexAtom)).toBe(0)

			// Navigate to a different index
			store.set(selectedIndexAtom, 5)

			// Clear suggestions - should reset selectedIndex to -1 (no selection)
			store.set(setFileMentionSuggestionsAtom, [])

			// selectedIndex should be reset to -1
			expect(store.get(selectedIndexAtom)).toBe(-1)
		})
	})

	describe("approval menu", () => {
		it("should set selectedIndex to 0 when approval message is set", () => {
			const store = createStore()

			// Set an approval message
			const message = createApprovalMessage("tool", JSON.stringify({ tool: "readFile" }))
			store.set(setPendingApprovalAtom, message)

			// selectedIndex should be 0 (first entry selected)
			expect(store.get(selectedIndexAtom)).toBe(0)
			expect(store.get(pendingApprovalAtom)).not.toBeNull()
			expect(store.get(approvalOptionsAtom).length).toBeGreaterThan(0)
		})

		it("should reset selectedIndex to 0 when new approval message replaces old one", () => {
			const store = createStore()

			// Set initial approval message with explicit timestamp
			const message1: ExtensionChatMessage = {
				type: "ask",
				ask: "tool",
				text: JSON.stringify({ tool: "readFile" }),
				ts: 1000, // Fixed timestamp
				partial: false,
				isAnswered: false,
				say: "assistant",
			}
			store.set(setPendingApprovalAtom, message1)

			// Manually change selectedIndex to simulate user navigation
			store.set(selectedIndexAtom, 1)
			expect(store.get(selectedIndexAtom)).toBe(1)

			// Set new approval message with different timestamp
			const message2: ExtensionChatMessage = {
				type: "ask",
				ask: "command",
				text: "git status",
				ts: 2000, // Different timestamp
				partial: false,
				isAnswered: false,
				say: "assistant",
			}
			store.set(setPendingApprovalAtom, message2)

			// selectedIndex should be reset to 0
			expect(store.get(selectedIndexAtom)).toBe(0)
		})

		it("should NOT reset selectedIndex for command_output updates (streaming)", () => {
			const store = createStore()

			// Set initial command_output message
			const message1: ExtensionChatMessage = {
				type: "ask",
				ask: "command_output",
				text: "Initial output",
				ts: 12345, // Fixed timestamp
				partial: true,
				isAnswered: false,
				say: "assistant",
			}
			store.set(setPendingApprovalAtom, message1)

			// Manually change selectedIndex to simulate user navigation
			store.set(selectedIndexAtom, 1)
			expect(store.get(selectedIndexAtom)).toBe(1)

			// Update the same message (same timestamp, different content)
			const message2: ExtensionChatMessage = {
				...message1,
				text: "Updated output",
				partial: false,
			}
			store.set(setPendingApprovalAtom, message2)

			// selectedIndex should NOT be reset (same message, just updated)
			expect(store.get(selectedIndexAtom)).toBe(1)
		})
	})

	describe("followup suggestions", () => {
		it("should set selectedIndex to -1 when followup suggestions are set (by design)", () => {
			const store = createStore()

			// Set some followup suggestions
			const suggestions = [{ answer: "Yes, continue" }, { answer: "No, stop" }]

			store.set(setFollowupSuggestionsAtom, suggestions)

			// selectedIndex should be -1 (no selection by design - allows custom typing)
			expect(store.get(selectedIndexAtom)).toBe(-1)
			expect(store.get(followupSuggestionsAtom)).toHaveLength(2)
		})
	})

	describe("cross-menu selection isolation", () => {
		it("should reset selection when switching from commands to arguments", () => {
			const store = createStore()

			// Set command suggestions
			store.set(setSuggestionsAtom, [createCommandSuggestion("help"), createCommandSuggestion("mode")])
			expect(store.get(selectedIndexAtom)).toBe(0)

			// Navigate to second item
			store.set(selectedIndexAtom, 1)
			expect(store.get(selectedIndexAtom)).toBe(1)

			// Clear commands and set arguments
			store.set(setSuggestionsAtom, [])
			store.set(setArgumentSuggestionsAtom, [createArgumentSuggestion("code"), createArgumentSuggestion("ask")])

			// selectedIndex should be 0 for the new argument suggestions
			expect(store.get(selectedIndexAtom)).toBe(0)
		})

		it("should reset selection when switching from arguments to file mentions", () => {
			const store = createStore()

			// Set argument suggestions
			store.set(setArgumentSuggestionsAtom, [createArgumentSuggestion("code"), createArgumentSuggestion("ask")])
			expect(store.get(selectedIndexAtom)).toBe(0)

			// Navigate to second item
			store.set(selectedIndexAtom, 1)
			expect(store.get(selectedIndexAtom)).toBe(1)

			// Clear arguments and set file mentions
			store.set(setArgumentSuggestionsAtom, [])
			store.set(setFileMentionSuggestionsAtom, [
				createFileMentionSuggestion("src/index.ts"),
				createFileMentionSuggestion("src/app.ts"),
			])

			// selectedIndex should be 0 for the new file mention suggestions
			expect(store.get(selectedIndexAtom)).toBe(0)
		})
	})
})
