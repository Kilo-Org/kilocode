// kilocode_change - new file
import { useCallback, useEffect, useRef, useState } from "react"
import { ExtensionMessage } from "@roo/ExtensionMessage"
import { vscode } from "@/utils/vscode"
import { generateRequestId } from "@roo/id"

interface UseChatGhostTextOptions {
	textAreaRef: React.RefObject<HTMLTextAreaElement>
	enableChatAutocomplete?: boolean
}

interface UseChatGhostTextReturn {
	ghostText: string
	handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean // Returns true if event was handled
	handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
	handleFocus: () => void
	handleBlur: () => void
	handleSelect: () => void
	clearGhostText: () => void
}

/**
 * Hook for managing FIM autocomplete ghost text in the chat text area.
 * Handles completion requests, ghost text display, and Tab/Escape/ArrowRight interactions.
 */
export function useChatGhostText({
	textAreaRef,
	enableChatAutocomplete = true,
}: UseChatGhostTextOptions): UseChatGhostTextReturn {
	const [ghostText, setGhostText] = useState<string>("")
	const isFocusedRef = useRef<boolean>(false)
	const completionDebounceRef = useRef<NodeJS.Timeout | null>(null)
	const completionRequestIdRef = useRef<string>("")
	const completionPrefixRef = useRef<string>("") // Track the prefix used for the current request
	const skipNextCompletionRef = useRef<boolean>(false) // Skip completion after accepting suggestion
	const savedGhostTextRef = useRef<string>("") // Store ghost text when blurring to restore on focus
	const savedPrefixRef = useRef<string>("") // Store the prefix associated with saved ghost text

	/**
	 * Idempotent function to synchronize ghost text visibility based on current state.
	 * This is the single source of truth for whether ghost text should be shown.
	 */
	const syncGhostTextVisibility = useCallback(() => {
		const textArea = textAreaRef.current
		if (!textArea) return

		const currentText = textArea.value
		const isCursorAtEnd =
			textArea.selectionStart === currentText.length && textArea.selectionEnd === currentText.length

		// Ghost text should only be visible when:
		// 1. The textarea is focused
		// 2. The cursor is at the end of the text
		// 3. We have saved ghost text that matches the current prefix
		const shouldShowGhostText =
			isFocusedRef.current && isCursorAtEnd && savedGhostTextRef.current && currentText === savedPrefixRef.current

		if (shouldShowGhostText) {
			setGhostText(savedGhostTextRef.current)
		} else {
			setGhostText("")
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
						// Store the new ghost text and sync visibility
						savedGhostTextRef.current = message.text || ""
						savedPrefixRef.current = currentText
						syncGhostTextVisibility()
					}
					// If prefix doesn't match or cursor not at end, discard the suggestion silently
				}
			}
		}

		window.addEventListener("message", messageHandler)
		return () => window.removeEventListener("message", messageHandler)
	}, [textAreaRef, syncGhostTextVisibility])

	const clearGhostText = useCallback(() => {
		savedGhostTextRef.current = ""
		savedPrefixRef.current = ""
		setGhostText("")
	}, [])

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
			const textArea = textAreaRef.current
			if (!textArea) {
				return false
			}

			const hasSelection = textArea.selectionStart !== textArea.selectionEnd
			const isCursorAtEnd = textArea.selectionStart === textArea.value.length
			const canAcceptCompletion = ghostText && !hasSelection && isCursorAtEnd

			// Tab: Accept full ghost text
			if (event.key === "Tab" && !event.shiftKey && canAcceptCompletion) {
				event.preventDefault()
				skipNextCompletionRef.current = true
				insertTextAtCursor(textArea, ghostText)
				// Send telemetry event for accepted suggestion
				vscode.postMessage({
					type: "chatCompletionAccepted",
					suggestionLength: ghostText.length,
				})
				clearGhostText()
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
				const { word, remainder } = extractNextWord(ghostText)
				insertTextAtCursor(textArea, word)
				// Send telemetry event for accepted word
				vscode.postMessage({
					type: "chatCompletionAccepted",
					suggestionLength: word.length,
				})
				// Update saved ghost text with remainder and sync
				savedGhostTextRef.current = remainder
				savedPrefixRef.current = textArea.value
				syncGhostTextVisibility()
				return true
			}

			// Escape: Clear ghost text
			if (event.key === "Escape" && ghostText) {
				clearGhostText()
			}
			return false
		},
		[ghostText, textAreaRef, clearGhostText, syncGhostTextVisibility],
	)

	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const newValue = e.target.value

			// Clear saved ghost text since the text has changed
			clearGhostText()

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
		[enableChatAutocomplete, clearGhostText],
	)

	const handleFocus = useCallback(() => {
		isFocusedRef.current = true
		syncGhostTextVisibility()
	}, [syncGhostTextVisibility])

	const handleBlur = useCallback(() => {
		isFocusedRef.current = false
		syncGhostTextVisibility()

		// Cancel any pending completion requests
		if (completionDebounceRef.current) {
			clearTimeout(completionDebounceRef.current)
			completionDebounceRef.current = null
		}
	}, [syncGhostTextVisibility])

	const handleSelect = useCallback(() => {
		syncGhostTextVisibility()
	}, [syncGhostTextVisibility])

	useEffect(() => {
		return () => {
			if (completionDebounceRef.current) {
				clearTimeout(completionDebounceRef.current)
			}
		}
	}, [])

	return {
		ghostText,
		handleKeyDown,
		handleInputChange,
		handleFocus,
		handleBlur,
		handleSelect,
		clearGhostText,
	}
}

/**
 * Extracts the first word from ghost text, including surrounding whitespace.
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
