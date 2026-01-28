import { useState, useCallback, useRef, useEffect } from "react"

import type {
	AutocompleteItem,
	AutocompleteTrigger,
	AutocompletePickerState,
	AutocompletePickerActions,
	TriggerDetectionResult,
} from "./types.js"

const DEFAULT_DEBOUNCE_MS = 150

/**
 * Hook that manages autocomplete picker state and logic.
 *
 * This hook supports two types of triggers:
 * 1. **Sync triggers** (e.g., slash commands, modes): `search()` returns results directly
 * 2. **Async triggers** (e.g., file search): `search()` triggers an API call and returns `[]`,
 *    then `forceRefresh()` is called when external data arrives
 *
 * For async triggers (those with `refreshResults` defined), the hook preserves existing
 * results during the loading state to prevent UI flickering.
 *
 * @template T - The type of autocomplete items
 * @param triggers - Array of autocomplete triggers to check
 * @returns Picker state and actions
 */
export function useAutocompletePicker<T extends AutocompleteItem>(
	triggers: AutocompleteTrigger<T>[],
): [AutocompletePickerState<T>, AutocompletePickerActions<T>] {
	const [state, setState] = useState<AutocompletePickerState<T>>({
		activeTrigger: null,
		results: [],
		selectedIndex: 0,
		isOpen: false,
		isLoading: false,
		triggerInfo: null,
	})

	// Debounce timer refs for each trigger
	const debounceTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
	const lastQueriesRef = useRef<Map<string, string>>(new Map())

	// Cleanup debounce timers on unmount
	useEffect(() => {
		return () => {
			debounceTimersRef.current.forEach((timer) => clearTimeout(timer))
		}
	}, [])

	/**
	 * Get the last line from the input value
	 */
	const getLastLine = useCallback((value: string): string => {
		const lines = value.split("\n")
		return lines[lines.length - 1] || ""
	}, [])

	/**
	 * Get the input value with the trigger character removed.
	 * Used when a trigger has consumeTrigger: true.
	 */
	const getConsumedValue = useCallback((value: string, lastLine: string, triggerIndex: number): string => {
		const lines = value.split("\n")
		const lastLineIndex = lines.length - 1
		// Remove the trigger character from the last line
		const newLastLine = lastLine.slice(0, triggerIndex) + lastLine.slice(triggerIndex + 1)
		lines[lastLineIndex] = newLastLine
		return lines.join("\n")
	}, [])

	/**
	 * Handle input value changes - detects triggers and initiates search.
	 * Returns an object indicating if the input should be modified (for consumeTrigger).
	 */
	const handleInputChange = useCallback(
		(value: string, lineText?: string): { consumedValue?: string } => {
			const lastLine = lineText ?? getLastLine(value)

			// Check each trigger for activation
			let foundTrigger: AutocompleteTrigger<T> | null = null
			let foundTriggerInfo: TriggerDetectionResult | null = null

			for (const trigger of triggers) {
				const detection = trigger.detectTrigger(lastLine)
				if (detection) {
					foundTrigger = trigger
					foundTriggerInfo = detection
					break
				}
			}

			// No trigger found - close picker
			if (!foundTrigger || !foundTriggerInfo) {
				if (state.isOpen) {
					setState((prev) => ({
						...prev,
						activeTrigger: null,
						results: [],
						selectedIndex: 0,
						isOpen: false,
						isLoading: false,
						triggerInfo: null,
					}))
				}
				return {}
			}

			const { query } = foundTriggerInfo
			const debounceMs = foundTrigger.debounceMs ?? DEFAULT_DEBOUNCE_MS

			// Clear existing debounce timer for this trigger
			const existingTimer = debounceTimersRef.current.get(foundTrigger.id)
			if (existingTimer) {
				clearTimeout(existingTimer)
			}

			// Check if query has changed
			const lastQuery = lastQueriesRef.current.get(foundTrigger.id)

			if (query === lastQuery && state.isOpen && state.activeTrigger?.id === foundTrigger.id) {
				// Same query, same trigger - no need to search again
				// Still return consumed value if trigger consumes input
				if (foundTrigger.consumeTrigger) {
					return { consumedValue: getConsumedValue(value, lastLine, foundTriggerInfo.triggerIndex) }
				}
				return {}
			}

			// Determine if this is an async trigger (has refreshResults for external data)
			const isAsyncTrigger = !!foundTrigger.refreshResults

			// For async triggers, immediately get cached results filtered by new query
			// This prevents the "empty state flash" when reopening picker with different query
			let initialResults: T[] = []

			if (isAsyncTrigger && foundTrigger.refreshResults) {
				try {
					const cached = foundTrigger.refreshResults(query)
					if (!(cached instanceof Promise)) {
						initialResults = cached
					}
				} catch {
					// Ignore errors, will use empty array
				}
			}

			// Set loading state immediately and open picker
			// For async triggers with cached results, show them immediately to prevent flickering
			// Only set isLoading if we have no cached results to show
			const hasResults = initialResults.length > 0

			setState((prev) => {
				return {
					...prev,
					activeTrigger: foundTrigger,
					// Only show loading state if we have no results to display
					isLoading: !hasResults,
					isOpen: true,
					triggerInfo: foundTriggerInfo,
					// Use initial cached results if available, otherwise preserve previous
					results: initialResults.length > 0 ? initialResults : prev.results,
					selectedIndex: initialResults.length > 0 ? 0 : prev.selectedIndex,
				}
			})

			// Debounce the search
			const timer = setTimeout(async () => {
				lastQueriesRef.current.set(foundTrigger.id, query)

				try {
					const results = await foundTrigger.search(query)

					setState((prev) => {
						// Only update if this is still the active trigger
						if (prev.activeTrigger?.id !== foundTrigger.id) {
							return prev
						}

						// For async triggers (those with refreshResults like file search):
						// - NEVER update results from search() - it always returns []
						// - Keep existing results and stay in loading state
						// - Results will be updated via forceRefresh() when async data arrives
						if (isAsyncTrigger && results.length === 0) {
							// Don't change results or loading state - forceRefresh will handle it
							return prev
						}

						return {
							...prev,
							results,
							selectedIndex: 0,
							isOpen: true,
							isLoading: false,
						}
					})
				} catch (_error) {
					// On error, close picker
					setState((prev) => ({
						...prev,
						results: [],
						isOpen: false,
						isLoading: false,
					}))
				}
			}, debounceMs)

			debounceTimersRef.current.set(foundTrigger.id, timer)

			// Return consumed value if trigger consumes input
			if (foundTrigger.consumeTrigger) {
				return { consumedValue: getConsumedValue(value, lastLine, foundTriggerInfo.triggerIndex) }
			}

			return {}
		},
		[triggers, state.isOpen, state.activeTrigger?.id, getLastLine, getConsumedValue],
	)

	/**
	 * Handle item selection - returns the new input value with the selection inserted
	 */
	const handleSelect = useCallback(
		(item: T, fullValue: string, lineText?: string): string => {
			const { activeTrigger, triggerInfo } = state

			if (!activeTrigger || !triggerInfo) {
				return fullValue
			}

			// Get the lines
			const lines = fullValue.split("\n")
			const lastLineIndex = lines.length - 1
			const lastLine = lineText ?? lines[lastLineIndex] ?? ""

			// Get replacement text from trigger
			const newLastLine = activeTrigger.getReplacementText(item, lastLine, triggerInfo.triggerIndex)

			// Replace the last line
			lines[lastLineIndex] = newLastLine
			const newValue = lines.join("\n")

			// Reset state
			setState({
				activeTrigger: null,
				results: [],
				selectedIndex: 0,
				isOpen: false,
				isLoading: false,
				triggerInfo: null,
			})

			// Clear last query for this trigger
			lastQueriesRef.current.delete(activeTrigger.id)

			return newValue
		},
		[state],
	)

	/**
	 * Close the picker
	 */
	const handleClose = useCallback(() => {
		// Clear any pending debounce timers
		debounceTimersRef.current.forEach((timer) => clearTimeout(timer))
		debounceTimersRef.current.clear()

		setState({
			activeTrigger: null,
			results: [],
			selectedIndex: 0,
			isOpen: false,
			isLoading: false,
			triggerInfo: null,
		})
	}, [])

	/**
	 * Update selected index
	 */
	const handleIndexChange = useCallback((index: number) => {
		setState((prev) => ({
			...prev,
			selectedIndex: index,
		}))
	}, [])

	/**
	 * Navigate selection up (with wrap-around)
	 */
	const navigateUp = useCallback(() => {
		setState((prev) => {
			if (prev.results.length === 0) return prev
			const newIndex = prev.selectedIndex > 0 ? prev.selectedIndex - 1 : prev.results.length - 1
			return { ...prev, selectedIndex: newIndex }
		})
	}, [])

	/**
	 * Navigate selection down (with wrap-around)
	 */
	const navigateDown = useCallback(() => {
		setState((prev) => {
			if (prev.results.length === 0) return prev
			const newIndex = prev.selectedIndex < prev.results.length - 1 ? prev.selectedIndex + 1 : 0
			return { ...prev, selectedIndex: newIndex }
		})
	}, [])

	/**
	 * Force refresh the current search results.
	 * This is used when external async data (like file search results) arrives
	 * after the initial search returned empty.
	 * Uses refreshResults if available to avoid triggering new API calls.
	 *
	 * IMPORTANT: We must find the current trigger from the `triggers` array,
	 * not use `state.activeTrigger`, because the triggers array is recreated
	 * with fresh closures when external data changes.
	 */
	const forceRefresh = useCallback(() => {
		const { activeTrigger, triggerInfo } = state

		// Only refresh if picker is open and we have an active trigger
		if (!activeTrigger || !triggerInfo) {
			return
		}

		// CRITICAL: Find the CURRENT trigger from the triggers array
		// The state.activeTrigger holds a stale closure, but triggers array has fresh closures
		const currentTrigger = triggers.find((t) => t.id === activeTrigger.id)
		if (!currentTrigger) {
			return
		}

		const { query } = triggerInfo

		// Use refreshResults if available (doesn't trigger new API call)
		// Fall back to search() if refreshResults is not implemented
		const refreshFn = currentTrigger.refreshResults ?? currentTrigger.search

		try {
			const results = refreshFn(query)

			// Handle both sync and async search results
			if (results instanceof Promise) {
				results.then((asyncResults) => {
					setState((prev) => {
						// Only update if still the same trigger
						if (prev.activeTrigger?.id !== activeTrigger.id) {
							return prev
						}

						// Only update if results actually changed to avoid unnecessary re-renders
						if (
							prev.results.length === asyncResults.length &&
							prev.results.every((r, i) => r.key === asyncResults[i]?.key)
						) {
							return { ...prev, isLoading: false }
						}

						return {
							...prev,
							results: asyncResults,
							// Preserve selectedIndex if within bounds, otherwise reset to 0
							selectedIndex: prev.selectedIndex < asyncResults.length ? prev.selectedIndex : 0,
							isLoading: false,
						}
					})
				})
			} else {
				setState((prev) => {
					// Only update if still the same trigger
					if (prev.activeTrigger?.id !== activeTrigger.id) {
						return prev
					}

					// Only update if results actually changed to avoid unnecessary re-renders
					if (
						prev.results.length === results.length &&
						prev.results.every((r, i) => r.key === results[i]?.key)
					) {
						return { ...prev, isLoading: false }
					}

					return {
						...prev,
						results,
						// Preserve selectedIndex if within bounds, otherwise reset to 0
						selectedIndex: prev.selectedIndex < results.length ? prev.selectedIndex : 0,
						isLoading: false,
					}
				})
			}
		} catch (_error) {
			// Silently fail on refresh errors.
		}
	}, [state, triggers])

	const actions: AutocompletePickerActions<T> = {
		handleInputChange,
		handleSelect,
		handleClose,
		handleIndexChange,
		navigateUp,
		navigateDown,
		forceRefresh,
	}

	return [state, actions]
}
