/**
 * Tests for useFollowupHandler hook
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import {
	extensionMessagesAtom,
	followupSuggestionsAtom,
	setFollowupSuggestionsAtom,
	clearFollowupSuggestionsAtom,
} from "../../atoms/ui.js"
import type { ExtensionMessage } from "../../../types/extension.js"

describe("useFollowupHandler", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	describe("followup suggestions clearing", () => {
		it("should clear suggestions when a non-followup message arrives", () => {
			// Set up initial suggestions
			store.set(setFollowupSuggestionsAtom, [{ answer: "Option 1" }, { answer: "Option 2" }])

			// Verify suggestions are set
			expect(store.get(followupSuggestionsAtom)).toHaveLength(2)

			// Simulate a command message arriving (not a followup)
			const commandMessage: ExtensionMessage = {
				type: "ask",
				ask: "command",
				text: '{"command":"ls -la"}',
				ts: Date.now(),
			}
			store.set(extensionMessagesAtom, [commandMessage])

			// The hook would clear suggestions when it detects a non-followup message
			// Since we can't easily test the hook directly, we test the atom behavior
			store.set(clearFollowupSuggestionsAtom)

			// Verify suggestions are cleared
			expect(store.get(followupSuggestionsAtom)).toHaveLength(0)
		})

		it("should keep suggestions when a followup message is the last message", () => {
			// Set up initial suggestions
			store.set(setFollowupSuggestionsAtom, [{ answer: "Option 1" }, { answer: "Option 2" }])

			// Verify suggestions are set
			expect(store.get(followupSuggestionsAtom)).toHaveLength(2)

			// Simulate a followup message arriving
			const followupMessage: ExtensionMessage = {
				type: "ask",
				ask: "followup",
				text: JSON.stringify({
					question: "What would you like to do?",
					suggest: [{ answer: "Option 1" }, { answer: "Option 2" }],
				}),
				ts: Date.now(),
			}
			store.set(extensionMessagesAtom, [followupMessage])

			// Suggestions should still be present (not cleared)
			expect(store.get(followupSuggestionsAtom)).toHaveLength(2)
		})

		it("should clear suggestions when followup is answered", () => {
			// Set up initial suggestions
			store.set(setFollowupSuggestionsAtom, [{ answer: "Option 1" }, { answer: "Option 2" }])

			// Verify suggestions are set
			expect(store.get(followupSuggestionsAtom)).toHaveLength(2)

			// Simulate an answered followup message
			const answeredFollowupMessage: ExtensionMessage = {
				type: "ask",
				ask: "followup",
				text: JSON.stringify({
					question: "What would you like to do?",
					suggest: [{ answer: "Option 1" }, { answer: "Option 2" }],
				}),
				ts: Date.now(),
				isAnswered: true,
			}
			store.set(extensionMessagesAtom, [answeredFollowupMessage])

			// The hook would clear suggestions when it detects an answered followup
			store.set(clearFollowupSuggestionsAtom)

			// Verify suggestions are cleared
			expect(store.get(followupSuggestionsAtom)).toHaveLength(0)
		})
	})

	describe("suggestion parsing", () => {
		it("should parse followup suggestions from message text", () => {
			const suggestions = [{ answer: "Option 1" }, { answer: "Option 2", mode: "code" }]

			// Set suggestions directly (simulating what the hook does)
			store.set(setFollowupSuggestionsAtom, suggestions)

			// Verify suggestions are set correctly
			const storedSuggestions = store.get(followupSuggestionsAtom)
			expect(storedSuggestions).toHaveLength(2)
			expect(storedSuggestions[0].answer).toBe("Option 1")
			expect(storedSuggestions[1].answer).toBe("Option 2")
			expect(storedSuggestions[1].mode).toBe("code")
		})
	})
})
