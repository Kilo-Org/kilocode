import { useTaskHistory } from "@/kilocode/hooks/useTaskHistory"
import { ClineMessage } from "@roo-code/types"
import { useCallback, useEffect, useMemo, useState } from "react"

interface UsePromptHistoryProps {
	clineMessages: ClineMessage[] | undefined
	taskHistoryVersion: number // kilocode_change
	cwd: string | undefined
	inputValue: string
	setInputValue: (value: string) => void
	cursorPosition: number
	applyCursorPosition: (position: number) => void
}

export interface UsePromptHistoryReturn {
	historyIndex: number
	setHistoryIndex: (index: number) => void
	tempInput: string
	setTempInput: (input: string) => void
	promptHistory: string[]
	handleHistoryNavigation: (
		event: React.KeyboardEvent<HTMLElement>,
		showContextMenu: boolean,
		isComposing: boolean,
	) => boolean
	resetHistoryNavigation: () => void
	resetOnInputChange: () => void
}

export const usePromptHistory = ({
	clineMessages,
	taskHistoryVersion, // kilocode_change
	cwd,
	inputValue,
	setInputValue,
	cursorPosition,
	applyCursorPosition,
}: UsePromptHistoryProps): UsePromptHistoryReturn => {
	// Maximum number of prompts to keep in history for memory management
	const MAX_PROMPT_HISTORY_SIZE = 100

	// Prompt history navigation state
	const [historyIndex, setHistoryIndex] = useState(-1)
	const [tempInput, setTempInput] = useState("")
	const [promptHistory, setPromptHistory] = useState<string[]>([])

	// kilocode_change start
	const { data } = useTaskHistory(
		{
			workspace: "current",
			sort: "newest",
			favoritesOnly: false,
			pageIndex: 0,
		},
		taskHistoryVersion,
	)
	// kilocode_change end

	// Initialize prompt history with hybrid approach: conversation messages if in task, otherwise task history
	const filteredPromptHistory = useMemo(() => {
		// First try to get conversation messages (user_feedback from clineMessages)
		const conversationPrompts = clineMessages
			?.filter((message) => message.type === "say" && message.say === "user_feedback" && message.text?.trim())
			.map((message) => message.text!)

		// If we have conversation messages, use those (newest first when navigating up)
		if (conversationPrompts?.length) {
			return conversationPrompts.slice(-MAX_PROMPT_HISTORY_SIZE).reverse()
		}

		// If we have clineMessages array (meaning we're in an active task), don't fall back to task history
		// Only use task history when starting fresh (no active conversation)
		if (clineMessages?.length) {
			return []
		}

		const taskHistory = data?.historyItems ?? [] // kilocode_change

		// Fall back to task history only when starting fresh (no active conversation)
		if (!taskHistory?.length || !cwd) {
			return []
		}

		// Extract user prompts from task history for the current workspace only
		return taskHistory
			.filter((item) => item.task?.trim() && (!item.workspace || item.workspace === cwd))
			.map((item) => item.task)
			.slice(0, MAX_PROMPT_HISTORY_SIZE)
	}, [
		data, // kilocode_change
		clineMessages,
		cwd,
	])

	// Update prompt history when filtered history changes and reset navigation
	useEffect(() => {
		setPromptHistory(filteredPromptHistory)
		// Reset navigation state when switching between history sources
		setHistoryIndex(-1)
		setTempInput("")
	}, [filteredPromptHistory])

	// Reset history navigation when user types (but not when we're setting it programmatically)
	const resetOnInputChange = useCallback(() => {
		if (historyIndex !== -1) {
			setHistoryIndex(-1)
			setTempInput("")
		}
	}, [historyIndex])

	// Helper to navigate to a specific history entry
	const navigateToHistory = useCallback(
		(newIndex: number, cursorPos: "start" | "end" = "start"): boolean => {
			if (newIndex < 0 || newIndex >= promptHistory.length) return false

			const historicalPrompt = promptHistory[newIndex]
			if (!historicalPrompt) return false

			setHistoryIndex(newIndex)
			setInputValue(historicalPrompt)
			const targetPosition = cursorPos === "start" ? 0 : historicalPrompt.length
			applyCursorPosition(targetPosition)

			return true
		},
		[promptHistory, setInputValue, applyCursorPosition],
	)

	// Helper to return to current input
	const returnToCurrentInput = useCallback(
		(cursorPos: "start" | "end" = "end") => {
			setHistoryIndex(-1)
			setInputValue(tempInput)
			const targetPosition = cursorPos === "start" ? 0 : tempInput.length
			applyCursorPosition(targetPosition)
		},
		[tempInput, setInputValue, applyCursorPosition],
	)

	const handleHistoryNavigation = useCallback(
		(event: React.KeyboardEvent<HTMLElement>, showContextMenu: boolean, isComposing: boolean): boolean => {
			if (!showContextMenu && promptHistory.length > 0 && !isComposing) {
				const selectionStart = cursorPosition
				const selectionEnd = cursorPosition
				const isAtBeginning = selectionStart === 0 && selectionEnd === 0
				const isAtEnd = selectionStart === inputValue.length && selectionEnd === inputValue.length

				if (event.key === "ArrowUp" && isAtBeginning) {
					event.preventDefault()
					if (historyIndex === -1) {
						setTempInput(inputValue)
					}
					return navigateToHistory(historyIndex + 1, "start")
				}

				if (event.key === "ArrowDown" && historyIndex >= 0 && (isAtBeginning || isAtEnd)) {
					event.preventDefault()

					if (historyIndex > 0) {
						return navigateToHistory(historyIndex - 1, isAtBeginning ? "start" : "end")
					} else if (historyIndex === 0) {
						returnToCurrentInput(isAtBeginning ? "start" : "end")
						return true
					}
				}
			}
			return false
		},
		[promptHistory, historyIndex, inputValue, navigateToHistory, returnToCurrentInput, cursorPosition],
	)

	const resetHistoryNavigation = useCallback(() => {
		setHistoryIndex(-1)
		setTempInput("")
	}, [])

	return {
		historyIndex,
		setHistoryIndex,
		tempInput,
		setTempInput,
		promptHistory,
		handleHistoryNavigation,
		resetHistoryNavigation,
		resetOnInputChange,
	}
}
