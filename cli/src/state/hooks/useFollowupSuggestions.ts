/**
 * Hook for managing followup suggestions
 * Provides state and actions for followup question suggestions
 */

import { useAtomValue, useSetAtom } from "jotai"
import { useMemo, useCallback } from "react"
import type { FollowupSuggestion } from "../atoms/ui.js"
import {
	followupSuggestionsAtom,
	followupSuggestionsMenuVisibleAtom,
	selectedIndexAtom,
	setFollowupSuggestionsAtom,
	clearFollowupSuggestionsAtom,
	selectNextFollowupAtom,
	selectPreviousFollowupAtom,
	unselectFollowupAtom,
	getSelectedFollowupAtom,
	hasFollowupSuggestionsAtom,
} from "../atoms/ui.js"

/**
 * Return type for useFollowupSuggestions hook
 */
export interface UseFollowupSuggestionsReturn {
	/** Current followup suggestions */
	suggestions: FollowupSuggestion[]
	/** Whether followup suggestions menu is visible */
	isVisible: boolean
	/** Index of currently selected suggestion (-1 = no selection) */
	selectedIndex: number
	/** Currently selected suggestion (null if no selection) */
	selectedSuggestion: FollowupSuggestion | null
	/** Whether there are any followup suggestions */
	hasSuggestions: boolean
	/** Set followup suggestions */
	setSuggestions: (suggestions: FollowupSuggestion[]) => void
	/** Clear followup suggestions */
	clearSuggestions: () => void
	/** Select next suggestion */
	selectNext: () => void
	/** Select previous suggestion (unselects if at first item) */
	selectPrevious: () => void
	/** Unselect current suggestion */
	unselect: () => void
}

/**
 * Hook for managing followup suggestions
 *
 * Provides comprehensive management of followup question suggestions including
 * keyboard navigation with special behavior for unselecting when pressing up
 * arrow on the first item.
 *
 * @example
 * ```tsx
 * function FollowupInput() {
 *   const {
 *     suggestions,
 *     isVisible,
 *     selectedIndex,
 *     selectedSuggestion,
 *     selectNext,
 *     selectPrevious,
 *     setSuggestions
 *   } = useFollowupSuggestions()
 *
 *   useEffect(() => {
 *     // Set suggestions when followup message is received
 *     setSuggestions([
 *       { answer: "Option 1" },
 *       { answer: "Option 2", mode: "code" }
 *     ])
 *   }, [])
 *
 *   const handleKeyDown = (e: KeyboardEvent) => {
 *     if (e.key === 'ArrowDown') {
 *       e.preventDefault()
 *       selectNext()
 *     } else if (e.key === 'ArrowUp') {
 *       e.preventDefault()
 *       selectPrevious() // Unselects if at first item
 *     }
 *   }
 *
 *   return (
 *     <div>
 *       {isVisible && (
 *         <ul>
 *           {suggestions.map((suggestion, i) => (
 *             <li key={i} className={i === selectedIndex ? 'selected' : ''}>
 *               {suggestion.answer}
 *             </li>
 *           ))}
 *         </ul>
 *       )}
 *     </div>
 *   )
 * }
 * ```
 */
export function useFollowupSuggestions(): UseFollowupSuggestionsReturn {
	// Read atoms
	const suggestions = useAtomValue(followupSuggestionsAtom)
	const isVisible = useAtomValue(followupSuggestionsMenuVisibleAtom)
	const selectedIndex = useAtomValue(selectedIndexAtom)
	const selectedSuggestion = useAtomValue(getSelectedFollowupAtom)
	const hasSuggestions = useAtomValue(hasFollowupSuggestionsAtom)

	// Write atoms
	const setSuggestionsAction = useSetAtom(setFollowupSuggestionsAtom)
	const clearSuggestionsAction = useSetAtom(clearFollowupSuggestionsAtom)
	const selectNextAction = useSetAtom(selectNextFollowupAtom)
	const selectPreviousAction = useSetAtom(selectPreviousFollowupAtom)
	const unselectAction = useSetAtom(unselectFollowupAtom)

	// Actions
	const setSuggestions = useCallback(
		(newSuggestions: FollowupSuggestion[]) => {
			setSuggestionsAction(newSuggestions)
		},
		[setSuggestionsAction],
	)

	const clearSuggestions = useCallback(() => {
		clearSuggestionsAction()
	}, [clearSuggestionsAction])

	const selectNext = useCallback(() => {
		selectNextAction()
	}, [selectNextAction])

	const selectPrevious = useCallback(() => {
		selectPreviousAction()
	}, [selectPreviousAction])

	const unselect = useCallback(() => {
		unselectAction()
	}, [unselectAction])

	// Memoize return value
	return useMemo(
		() => ({
			suggestions,
			isVisible,
			selectedIndex,
			selectedSuggestion,
			hasSuggestions,
			setSuggestions,
			clearSuggestions,
			selectNext,
			selectPrevious,
			unselect,
		}),
		[
			suggestions,
			isVisible,
			selectedIndex,
			selectedSuggestion,
			hasSuggestions,
			setSuggestions,
			clearSuggestions,
			selectNext,
			selectPrevious,
			unselect,
		],
	)
}
