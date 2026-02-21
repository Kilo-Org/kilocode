// kilocode_change - new file
import { useCallback, useEffect, useRef, useState } from "react"
import { ExtensionMessage } from "@roo/ExtensionMessage"
import { vscode } from "@/utils/vscode"
import { generateRequestId } from "@roo/id"

interface UseChatAutocompleteTextOptions {
	textAreaRef: React.RefObject<HTMLTextAreaElement>
	enableChatAutocomplete?: boolean
}

interface UseChatAutocompleteTextReturn {
	autocompleteText: string
	handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean // Returns true if event was handled
	handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
	handleFocus: () => void
	handleBlur: () => void
	handleSelect: () => void
	clearAutocompleteText: () => void
}

/**
 * Hook for managing FIM autocomplete autocomplete text in the chat text area.
 * Handles completion requests, autocomplete text display, and Tab/Escape/ArrowRight interactions.
 */
export function useChatAutocompleteText({
	textAreaRef,
	enableChatAutocomplete = true,
}: UseChatAutocompleteTextOptions): UseChatAutocompleteTextReturn {
	const [autocompleteText, setAutocompleteText] = useState<string>("")
	const isFocusedRef = useRef<boolean>(false)
	const completionDebounceRef = useRef<NodeJS.Timeout | null>(null)
	const completionRequestIdRef = useRef<string>("")
	const completionPrefixRef = useRef<string>("") // Track the prefix used for the current request
	const skipNextCompletionRef = useRef<boolean>(false) // Skip completion after accepting suggestion
	const savedAutocompleteTextRef = useRef<string>("") // Store autocomplete text when blurring to restore on focus
	const savedPrefixRef = useRef<string>("") // Store the prefix associated with saved autocomplete text

	/**
	 * Idempotent function to synchronize autocomplete text visibility based on current state.
	 * This is the single source of truth for whether autocomplete text should be shown.
	 */
	const syncAutocompleteTextVisibility = useCallback(() => {
		const textArea = textAreaRef.current
		if (!textArea) return

		const currentText = textArea.value
		const isCursorAtEnd =
			textArea.selectionStart === currentText.length && textArea.selectionEnd === currentText.length

		// Autocomplete text should only be visible when:
		// 1. The textarea is focused
		// 2. The cursor is at the end of the text
		// 3. We have saved autocomplete text that matches the current prefix
		const shouldShowAutocompleteText =
			isFocusedRef.current &&
			isCursorAtEnd &&
			savedAutocompleteTextRef.current &&
			currentText === savedPrefixRef.current

		if (shouldShowAutocompleteText) {
			setAutocompleteText(savedAutocompleteTextRef.current)
		} else {
			setAutocompleteText("")
		}
	}, [textAreaRef])

	// Handle chat completion result messages
	useEffect(() => {
		const messageHandler = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data
			if (message.type === "chatCompletionResult") {
				// Only update if this is the response to our latest request
				// and the textarea is still focused
				if (message.requestId === completionRequestIdRef.current && isFocusedRef.current) {
					const textArea = textAreaRef.current
					if (!textArea) return

					// Verify the current text still matches the prefix used for this request
					const currentText = textArea.value
					const expectedPrefix = completionPrefixRef.current

					// Also verify cursor is at the end (since we only show suggestions at the end)
					const isCursorAtEnd = textArea.selectionStart === currentText.length

					if (currentText === expectedPrefix && isCursorAtEnd) {
						// Store the new autocomplete text and sync visibility
						savedAutocompleteTextRef.current = message.text || ""
						savedPrefixRef.current = currentText
						syncAutocompleteTextVisibility()
					}
					// If prefix doesn't match or cursor not at end, discard the suggestion silently
				}
			}
		}

		window.addEventListener("message", messageHandler)
		return () => window.removeEventListener("message", messageHandler)
	}, [textAreaRef, syncAutocompleteTextVisibility])

	const clearAutocompleteText = useCallback(() => {
		savedAutocompleteTextRef.current = ""
		savedPrefixRef.current = ""
		setAutocompleteText("")
	}, [])

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
			const textArea = textAreaRef.current
			if (!textArea) {
				return false
			}

			const hasSelection = textArea.selectionStart !== textArea.selectionEnd
			const isCursorAtEnd = textArea.selectionStart === textArea.value.length
			const canAcceptCompletion = autocompleteText && !hasSelection && isCursorAtEnd

			// Tab: Accept full autocomplete text
			if (event.key === "Tab" && !event.shiftKey && canAcceptCompletion) {
				event.preventDefault()
				skipNextCompletionRef.current = true
				insertTextAtCursor(textArea, autocompleteText)
				// Send telemetry event for accepted suggestion
				vscode.postMessage({
					type: "chatCompletionAccepted",
					suggestionLength: autocompleteText.length,
				})
				clearAutocompleteText()
				return true
			}

			// ArrowRight: Accept next word only
			if (
				event.key === "ArrowRight" &&
				!event.shiftKey &&
				!event.ctrlKey &&
				!event.metaKey &&
				canAcceptCompletion
			) {
				event.preventDefault()
				skipNextCompletionRef.current = true
				const { word, remainder } = extractNextWord(autocompleteText)
				insertTextAtCursor(textArea, word)
				// Send telemetry event for accepted word
				vscode.postMessage({
					type: "chatCompletionAccepted",
					suggestionLength: word.length,
				})
				// Update saved autocomplete text with remainder and sync
				savedAutocompleteTextRef.current = remainder
				savedPrefixRef.current = textArea.value
				syncAutocompleteTextVisibility()
				return true
			}

			// Escape: Clear autocomplete text
			if (event.key === "Escape" && autocompleteText) {
				clearAutocompleteText()
			}
			return false
		},
		[autocompleteText, textAreaRef, clearAutocompleteText, syncAutocompleteTextVisibility],
	)

	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const newValue = e.target.value

			// Clear saved autocomplete text since the text has changed
			clearAutocompleteText()

			// Clear any pending completion request
			if (completionDebounceRef.current) {
				clearTimeout(completionDebounceRef.current)
			}

			// Skip completion request if we just accepted a suggestion (Tab) or undid
			if (skipNextCompletionRef.current) {
				skipNextCompletionRef.current = false
				// Don't request a new completion - wait for user to type more
			} else if (
				enableChatAutocomplete &&
				isFocusedRef.current &&
				newValue.length >= 5 &&
				!newValue.startsWith("/") &&
				!newValue.includes("@")
			) {
				// Request new completion after debounce (only if feature is enabled and textarea is focused)
				const requestId = generateRequestId()
				completionRequestIdRef.current = requestId
				completionPrefixRef.current = newValue // Store the prefix used for this request
				completionDebounceRef.current = setTimeout(() => {
					vscode.postMessage({
						type: "requestChatCompletion",
						text: newValue,
						requestId,
					})
				}, 300) // 300ms debounce
			}
		},
		[enableChatAutocomplete, clearAutocompleteText],
	)

	const handleFocus = useCallback(() => {
		isFocusedRef.current = true
		syncAutocompleteTextVisibility()
	}, [syncAutocompleteTextVisibility])

	const handleBlur = useCallback(() => {
		isFocusedRef.current = false
		syncAutocompleteTextVisibility()

		// Cancel any pending completion requests
		if (completionDebounceRef.current) {
			clearTimeout(completionDebounceRef.current)
			completionDebounceRef.current = null
		}
	}, [syncAutocompleteTextVisibility])

	const handleSelect = useCallback(() => {
		syncAutocompleteTextVisibility()
	}, [syncAutocompleteTextVisibility])

	useEffect(() => {
		return () => {
			if (completionDebounceRef.current) {
				clearTimeout(completionDebounceRef.current)
			}
		}
	}, [])

	return {
		autocompleteText,
		handleKeyDown,
		handleInputChange,
		handleFocus,
		handleBlur,
		handleSelect,
		clearAutocompleteText,
	}
}

/**
 * Extracts the first word from autocomplete text, including surrounding whitespace.
 * Mimics VS Code's word acceptance behavior: accepts leading space + word + trailing space as a unit.
 * Returns the word and the remaining text.
 */
function extractNextWord(text: string): { word: string; remainder: string } {
	if (!text) {
		return { word: "", remainder: "" }
	}

	// Match: optional leading whitespace + non-whitespace characters + optional trailing whitespace
	// This captures " word " or "word " or " word" as complete units
	const match = text.match(/^(\s*\S+\s*)/)
	if (match) {
		return { word: match[1], remainder: text.slice(match[1].length) }
	}

	// If text is only whitespace, return all of it
	return { word: text, remainder: "" }
}

function insertTextAtCursor(textArea: HTMLTextAreaElement, text: string): void {
	textArea.setSelectionRange(textArea.value.length, textArea.value.length)
	document?.execCommand("insertText", false, text)
}
