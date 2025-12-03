// kilocode_change - new file
import { useCallback, useEffect, useRef, useState } from "react"
import { ExtensionMessage } from "@roo/ExtensionMessage"
import { vscode } from "@/utils/vscode"
import { generateRequestId } from "@roo/id"

interface UseChatGhostTextOptions {
	inputValue: string
	setInputValue: (value: string) => void
	textAreaRef: React.RefObject<HTMLTextAreaElement>
}

interface UseChatGhostTextReturn {
	ghostText: string
	handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean // Returns true if event was handled
	handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
	clearGhostText: () => void
}

/**
 * Hook for managing FIM autocomplete ghost text in the chat text area.
 * Handles completion requests, ghost text display, and Tab/Escape interactions.
 */
export function useChatGhostText({
	inputValue,
	setInputValue,
	textAreaRef,
}: UseChatGhostTextOptions): UseChatGhostTextReturn {
	const [ghostText, setGhostText] = useState<string>("")
	const completionDebounceRef = useRef<NodeJS.Timeout | null>(null)
	const completionRequestIdRef = useRef<string>("")
	const skipNextCompletionRef = useRef<boolean>(false) // Skip completion after accepting suggestion

	// Handle chat completion result messages
	useEffect(() => {
		const messageHandler = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data
			if (message.type === "chatCompletionResult") {
				// Only update if this is the response to our latest request
				if (message.requestId === completionRequestIdRef.current) {
					setGhostText(message.text || "")
				}
			}
		}

		window.addEventListener("message", messageHandler)
		return () => window.removeEventListener("message", messageHandler)
	}, [])

	const clearGhostText = useCallback(() => {
		setGhostText("")
	}, [])

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
			// Tab to accept ghost text
			if (event.key === "Tab" && ghostText && !event.shiftKey) {
				event.preventDefault()
				// Skip the next completion request since we just accepted a suggestion
				skipNextCompletionRef.current = true
				try {
					// Use execCommand to insert text while preserving undo history
					if (document.execCommand && textAreaRef.current) {
						const textarea = textAreaRef.current
						// Move cursor to end and insert the ghost text
						textarea.setSelectionRange(textarea.value.length, textarea.value.length)
						document.execCommand("insertText", false, ghostText)
					} else {
						setInputValue(inputValue + ghostText)
					}
				} catch {
					setInputValue(inputValue + ghostText)
				}
				setGhostText("")
				return true // Event was handled, stop propagation
			}
			// Clear ghost text on Escape
			if (event.key === "Escape" && ghostText) {
				setGhostText("")
				// Don't return true - let other handlers process Escape too
			}
			return false // Event was not handled by this hook
		},
		[ghostText, inputValue, setInputValue, textAreaRef],
	)

	const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const newValue = e.target.value

		// Clear any existing ghost text when typing
		setGhostText("")

		// Clear any pending completion request
		if (completionDebounceRef.current) {
			clearTimeout(completionDebounceRef.current)
		}

		// Skip completion request if we just accepted a suggestion (Tab) or undid
		if (skipNextCompletionRef.current) {
			skipNextCompletionRef.current = false
			// Don't request a new completion - wait for user to type more
		} else if (newValue.length >= 5 && !newValue.startsWith("/") && !newValue.includes("@")) {
			// Request new completion after debounce
			completionDebounceRef.current = setTimeout(() => {
				const requestId = generateRequestId()
				completionRequestIdRef.current = requestId
				vscode.postMessage({
					type: "requestChatCompletion",
					text: newValue,
					requestId,
				})
			}, 300) // 300ms debounce
		}
	}, [])

	// Cleanup on unmount
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
		clearGhostText,
	}
}
