/**
 * UI-specific state atoms
 * These atoms manage the command-based UI state including messages, input, and autocomplete
 */

import { atom } from "jotai"
import type { CliMessage } from "../../types/cli.js"
import type { ExtensionChatMessage } from "../../types/messages.js"
import type { CommandSuggestion, ArgumentSuggestion } from "../../services/autocomplete.js"
import { chatMessagesAtom } from "./extension.js"
import { logs } from "../../services/logs.js"
import { splitMessages } from "../../ui/messages/utils/messageCompletion.js"

/**
 * Unified message type that can represent both CLI and extension messages
 */
export type UnifiedMessage =
	| { source: "cli"; message: CliMessage }
	| { source: "extension"; message: ExtensionChatMessage }

// ============================================================================
// Core UI State Atoms
// ============================================================================

/**
 * Atom to hold the message history displayed in the UI
 */
export const messagesAtom = atom<CliMessage[]>([])

/**
 * Atom to track when messages have been reset/replaced
 * Increments each time replaceMessages is called to force Static component re-render
 */
export const messageResetCounterAtom = atom<number>(0)

/**
 * Atom to hold the current input value
 */
export const inputValueAtom = atom<string>("")

/**
 * Atom to track if the UI is processing a command or request
 */
export const isProcessingAtom = atom<boolean>(false)

/**
 * Atom to hold UI error messages
 */
export const errorAtom = atom<string | null>(null)

// ============================================================================
// Autocomplete State Atoms
// ============================================================================

/**
 * Atom to control autocomplete menu visibility
 */
export const showAutocompleteAtom = atom<boolean>(false)

/**
 * Atom to hold command suggestions for autocomplete
 */
export const suggestionsAtom = atom<CommandSuggestion[]>([])

/**
 * Atom to hold argument suggestions for autocomplete
 */
export const argumentSuggestionsAtom = atom<ArgumentSuggestion[]>([])

/**
 * Atom to track the currently selected suggestion index
 */
export const selectedSuggestionIndexAtom = atom<number>(0)

// ============================================================================
// Followup Suggestions State Atoms
// ============================================================================

/**
 * Followup suggestion structure
 */
export interface FollowupSuggestion {
	answer: string
	mode?: string
}

/**
 * Atom to hold followup suggestions
 */
export const followupSuggestionsAtom = atom<FollowupSuggestion[]>([])

/**
 * Atom to control followup suggestions menu visibility
 */
export const showFollowupSuggestionsAtom = atom<boolean>(false)

/**
 * Atom to track the currently selected followup suggestion index
 * -1 means no selection (user can type custom response)
 */
export const selectedFollowupIndexAtom = atom<number>(-1)

// ============================================================================
// Derived Atoms
// ============================================================================

/**
 * Derived atom to get the total count of suggestions (command or argument)
 */
export const suggestionCountAtom = atom<number>((get) => {
	const commandSuggestions = get(suggestionsAtom)
	const argumentSuggestions = get(argumentSuggestionsAtom)
	return commandSuggestions.length > 0 ? commandSuggestions.length : argumentSuggestions.length
})

/**
 * Derived atom to check if input is a command (starts with /)
 */
export const isCommandInputAtom = atom<boolean>((get) => {
	const input = get(inputValueAtom)
	return input.startsWith("/")
})

/**
 * Derived atom to get the command query (input without the leading /)
 */
export const commandQueryAtom = atom<string>((get) => {
	const input = get(inputValueAtom)
	return get(isCommandInputAtom) ? input.slice(1) : ""
})

/**
 * Derived atom to check if there are any messages
 */
export const hasMessagesAtom = atom<boolean>((get) => {
	const messages = get(messagesAtom)
	return messages.length > 0
})

/**
 * Derived atom to get the last message
 */
export const lastMessageAtom = atom<CliMessage | null>((get) => {
	const messages = get(messagesAtom)
	return messages.length > 0 ? (messages[messages.length - 1] ?? null) : null
})

/**
 * Derived atom to check if there's an active error
 */
export const hasErrorAtom = atom<boolean>((get) => {
	return get(errorAtom) !== null
})

// ============================================================================
// Action Atoms
// ============================================================================

/**
 * Action atom to add a message to the history
 */
export const addMessageAtom = atom(null, (get, set, message: CliMessage) => {
	const messages = get(messagesAtom)
	set(messagesAtom, [...messages, message])
})

/**
 * Action atom to clear all messages
 */
export const clearMessagesAtom = atom(null, (get, set) => {
	set(messagesAtom, [])
})

/**
 * Action atom to replace the entire message history
 * Increments the reset counter to force Static component re-render
 */
export const replaceMessagesAtom = atom(null, (get, set, messages: CliMessage[]) => {
	set(messagesAtom, messages)
	set(messageResetCounterAtom, (prev) => prev + 1)
})

/**
 * Action atom to update the last message
 * Useful for streaming or partial updates
 */
export const updateLastMessageAtom = atom(null, (get, set, content: string) => {
	const messages = get(messagesAtom)
	if (messages.length === 0) return

	const lastMessage = messages[messages.length - 1]
	if (!lastMessage) return

	const updatedMessage: CliMessage = {
		id: lastMessage.id,
		type: lastMessage.type,
		ts: lastMessage.ts,
		content,
		partial: false,
	}
	const updatedMessages = [...messages.slice(0, -1), updatedMessage]
	set(messagesAtom, updatedMessages)
})

/**
 * Action atom to set the input value
 * Also handles autocomplete visibility
 */
export const setInputValueAtom = atom(null, (get, set, value: string) => {
	set(inputValueAtom, value)

	// Update autocomplete visibility based on input
	// Keep showing suggestions even for exact matches (e.g., "/mode")
	// This provides visual confirmation that the user has typed a valid command
	const isCommand = value.startsWith("/")
	set(showAutocompleteAtom, isCommand)

	// Reset selected index when input changes
	if (isCommand) {
		set(selectedSuggestionIndexAtom, 0)
	}
})

/**
 * Action atom to clear the input
 */
export const clearInputAtom = atom(null, (get, set) => {
	set(inputValueAtom, "")
	set(showAutocompleteAtom, false)
	set(selectedSuggestionIndexAtom, 0)
})

/**
 * Action atom to set command suggestions
 */
export const setSuggestionsAtom = atom(null, (get, set, suggestions: CommandSuggestion[]) => {
	set(suggestionsAtom, suggestions)
	set(selectedSuggestionIndexAtom, 0)
})

/**
 * Action atom to set argument suggestions
 */
export const setArgumentSuggestionsAtom = atom(null, (get, set, suggestions: ArgumentSuggestion[]) => {
	set(argumentSuggestionsAtom, suggestions)
	set(selectedSuggestionIndexAtom, 0)
})

/**
 * Action atom to select the next suggestion
 */
export const selectNextSuggestionAtom = atom(null, (get, set) => {
	const count = get(suggestionCountAtom)
	if (count === 0) return

	const currentIndex = get(selectedSuggestionIndexAtom)
	const nextIndex = (currentIndex + 1) % count
	set(selectedSuggestionIndexAtom, nextIndex)
})

/**
 * Action atom to select the previous suggestion
 */
export const selectPreviousSuggestionAtom = atom(null, (get, set) => {
	const count = get(suggestionCountAtom)
	if (count === 0) return

	const currentIndex = get(selectedSuggestionIndexAtom)
	const prevIndex = currentIndex === 0 ? count - 1 : currentIndex - 1
	set(selectedSuggestionIndexAtom, prevIndex)
})

/**
 * Action atom to set an error message
 * Auto-clears after 5 seconds
 */
export const setErrorAtom = atom(null, (get, set, error: string | null) => {
	set(errorAtom, error)

	// Auto-clear error after 5 seconds
	if (error) {
		setTimeout(() => {
			set(errorAtom, null)
		}, 5000)
	}
})

/**
 * Action atom to hide autocomplete
 */
export const hideAutocompleteAtom = atom(null, (get, set) => {
	set(showAutocompleteAtom, false)
	set(selectedSuggestionIndexAtom, 0)
})

/**
 * Action atom to show autocomplete
 */
export const showAutocompleteMenuAtom = atom(null, (get, set) => {
	const isCommand = get(isCommandInputAtom)
	if (isCommand) {
		set(showAutocompleteAtom, true)
	}
})

/**
 * Action atom to get the currently selected suggestion
 */
export const getSelectedSuggestionAtom = atom<CommandSuggestion | ArgumentSuggestion | null>((get) => {
	const commandSuggestions = get(suggestionsAtom)
	const argumentSuggestions = get(argumentSuggestionsAtom)
	const selectedIndex = get(selectedSuggestionIndexAtom)

	if (commandSuggestions.length > 0) {
		return commandSuggestions[selectedIndex] ?? null
	}

	if (argumentSuggestions.length > 0) {
		return argumentSuggestions[selectedIndex] ?? null
	}

	return null
})

/**
 * Derived atom that merges CLI messages and extension messages chronologically
 * This provides a unified view of all messages for display
 */
export const mergedMessagesAtom = atom<UnifiedMessage[]>((get) => {
	const cliMessages = get(messagesAtom)
	const extensionMessages = get(chatMessagesAtom)

	// Convert to unified format
	const unified: UnifiedMessage[] = [
		...cliMessages.map((msg) => ({ source: "cli" as const, message: msg })),
		...extensionMessages.map((msg) => ({ source: "extension" as const, message: msg })),
	]

	// Sort chronologically by timestamp
	const sorted = unified.sort((a, b) => {
		return a.message.ts - b.message.ts
	})

	return sorted
})

// ============================================================================
// Followup Suggestions Action Atoms
// ============================================================================

/**
 * Action atom to set followup suggestions
 */
export const setFollowupSuggestionsAtom = atom(null, (get, set, suggestions: FollowupSuggestion[]) => {
	set(followupSuggestionsAtom, suggestions)
	set(showFollowupSuggestionsAtom, suggestions.length > 0)
	// Start with no selection (-1) so user can type custom response
	set(selectedFollowupIndexAtom, -1)
})

/**
 * Action atom to clear followup suggestions
 */
export const clearFollowupSuggestionsAtom = atom(null, (get, set) => {
	set(followupSuggestionsAtom, [])
	set(showFollowupSuggestionsAtom, false)
	set(selectedFollowupIndexAtom, -1)
})

/**
 * Action atom to select the next followup suggestion
 * Special behavior: if at last item, unselect (set to -1)
 */
export const selectNextFollowupAtom = atom(null, (get, set) => {
	const suggestions = get(followupSuggestionsAtom)
	if (suggestions.length === 0) return

	const currentIndex = get(selectedFollowupIndexAtom)

	// If no selection (-1), start at 0
	if (currentIndex === -1) {
		set(selectedFollowupIndexAtom, 0)
		return
	}

	// If at last item, unselect
	if (currentIndex === suggestions.length - 1) {
		set(selectedFollowupIndexAtom, -1)
		return
	}

	// Otherwise, move to next
	set(selectedFollowupIndexAtom, currentIndex + 1)
})

/**
 * Action atom to select the previous followup suggestion
 * Special behavior: if at index 0, unselect (set to -1)
 */
export const selectPreviousFollowupAtom = atom(null, (get, set) => {
	const suggestions = get(followupSuggestionsAtom)
	if (suggestions.length === 0) return

	const currentIndex = get(selectedFollowupIndexAtom)

	// If at first item (0), unselect
	if (currentIndex === 0) {
		set(selectedFollowupIndexAtom, -1)
		return
	}

	// If no selection (-1), go to last item
	if (currentIndex === -1) {
		set(selectedFollowupIndexAtom, suggestions.length - 1)
		return
	}

	// Otherwise, move to previous
	set(selectedFollowupIndexAtom, currentIndex - 1)
})

/**
 * Action atom to unselect followup suggestion
 */
export const unselectFollowupAtom = atom(null, (get, set) => {
	set(selectedFollowupIndexAtom, -1)
})

/**
 * Derived atom to get the currently selected followup suggestion
 */
export const getSelectedFollowupAtom = atom<FollowupSuggestion | null>((get) => {
	const suggestions = get(followupSuggestionsAtom)
	const selectedIndex = get(selectedFollowupIndexAtom)

	if (selectedIndex === -1 || selectedIndex >= suggestions.length) {
		return null
	}

	return suggestions[selectedIndex] ?? null
})

/**
 * Derived atom to check if followup suggestions are active
 */
export const hasFollowupSuggestionsAtom = atom<boolean>((get) => {
	return get(followupSuggestionsAtom).length > 0
})

// ============================================================================
// Message Splitting Atoms (for Ink Static optimization)
// ============================================================================

/**
 * Derived atom that splits messages into static (complete) and dynamic (incomplete)
 * This enables Ink Static optimization by separating messages that won't change
 * from those that are still being updated
 */
export const splitMessagesAtom = atom((get) => {
	const allMessages = get(mergedMessagesAtom)
	return splitMessages(allMessages)
})

/**
 * Derived atom for static messages (complete, ready for static rendering)
 * These messages won't change and can be rendered once without re-rendering
 */
export const staticMessagesAtom = atom<UnifiedMessage[]>((get) => {
	const { staticMessages } = get(splitMessagesAtom)
	return staticMessages
})

/**
 * Derived atom for dynamic messages (incomplete, need active rendering)
 * These messages may still be updating and need to be re-rendered
 */
export const dynamicMessagesAtom = atom<UnifiedMessage[]>((get) => {
	const { dynamicMessages } = get(splitMessagesAtom)
	return dynamicMessages
})
