import { useState, useEffect, useCallback, useRef } from "react"

import { loadHistory, addToHistory } from "../../lib/storage/history.js"

export interface UseInputHistoryOptions {
	isActive?: boolean
	getCurrentInput?: () => string
}

export interface UseInputHistoryReturn {
	addEntry: (entry: string) => Promise<void>
	historyValue: string | null
	isBrowsing: boolean
	resetBrowsing: (currentInput?: string) => void
	history: string[]
	draft: string
	setDraft: (value: string) => void
	navigateUp: () => void
	navigateDown: () => void
}

export function useInputHistory(options: UseInputHistoryOptions = {}): UseInputHistoryReturn {
	const { isActive = true, getCurrentInput } = options

	// All history entries (oldest first, newest at end)
	const [history, setHistory] = useState<string[]>([])

	// Current position in history (-1 = not browsing, 0 = oldest, history.length-1 = newest)
	const [historyIndex, setHistoryIndex] = useState(-1)

	// The user's typed text before they started navigating history
	const [draft, setDraft] = useState("")

	// Flag to track if history has been loaded
	const historyLoaded = useRef(false)

	// Load history on mount
	useEffect(() => {
		if (!historyLoaded.current) {
			historyLoaded.current = true
			loadHistory()
				.then(setHistory)
				.catch(() => {
					// Ignore load errors - history is not critical
				})
		}
	}, [])

	// Navigate to older history entry
	const navigateUp = useCallback(() => {
		if (!isActive) return
		if (history.length === 0) return

		if (historyIndex === -1) {
			// Starting to browse - save current input as draft
			if (getCurrentInput) {
				setDraft(getCurrentInput())
			}
			// Go to newest entry
			setHistoryIndex(history.length - 1)
		} else if (historyIndex > 0) {
			// Go to older entry
			setHistoryIndex(historyIndex - 1)
		}
		// At oldest entry - stay there
	}, [isActive, history, historyIndex, getCurrentInput])

	// Navigate to newer history entry
	const navigateDown = useCallback(() => {
		if (!isActive) return
		if (historyIndex === -1) return // Not browsing

		if (historyIndex < history.length - 1) {
			// Go to newer entry
			setHistoryIndex(historyIndex + 1)
		} else {
			// At newest entry - return to draft
			setHistoryIndex(-1)
		}
	}, [isActive, historyIndex, history.length])

	// Add new entry to history
	const addEntry = useCallback(async (entry: string) => {
		const trimmed = entry.trim()
		if (!trimmed) return

		try {
			const updated = await addToHistory(trimmed)
			setHistory(updated)
		} catch {
			// Ignore save errors - history is not critical
		}

		// Reset navigation state
		setHistoryIndex(-1)
		setDraft("")
	}, [])

	// Reset browsing state
	const resetBrowsing = useCallback((currentInput?: string) => {
		setHistoryIndex(-1)
		if (currentInput !== undefined) {
			setDraft(currentInput)
		}
	}, [])

	// Calculate the current history value to display
	// When browsing, show history entry; when returning from browsing, show draft
	let historyValue: string | null = null
	if (historyIndex >= 0 && historyIndex < history.length) {
		historyValue = history[historyIndex] ?? null
	}

	const isBrowsing = historyIndex !== -1

	return {
		addEntry,
		historyValue,
		isBrowsing,
		resetBrowsing,
		history,
		draft,
		setDraft,
		navigateUp,
		navigateDown,
	}
}
