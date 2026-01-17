/**
 * Hook for managing command input and autocomplete
 * Provides input state, autocomplete suggestions, and command execution
 */

import { useAtomValue, useSetAtom } from "jotai"
import { useMemo, useCallback, useEffect } from "react"
import type {
	CommandSuggestion,
	ArgumentSuggestion,
	FileMentionSuggestion,
	FileMentionContext,
} from "../../services/autocomplete.js"
import type { ExtensionMessage } from "../../types/messages.js"
import {
	getSuggestions,
	getArgumentSuggestions,
	detectInputState,
	isCommandInput as checkIsCommandInput,
	detectFileMentionContext,
	getFileMentionSuggestions,
} from "../../services/autocomplete.js"
import {
	showAutocompleteAtom,
	suggestionsAtom,
	argumentSuggestionsAtom,
	fileMentionSuggestionsAtom,
	fileMentionContextAtom,
	selectedIndexAtom,
	suggestionCountAtom,
	isCommandInputAtom,
	commandQueryAtom,
	updateTextBufferAtom,
	clearTextBufferAtom,
	clearFileMentionAtom,
	updateAllSuggestionsAtom,
	selectNextSuggestionAtom,
	selectPreviousSuggestionAtom,
	hideAutocompleteAtom,
	showAutocompleteMenuAtom,
	getSelectedSuggestionAtom,
} from "../atoms/ui.js"
import { shellModeActiveAtom } from "../atoms/shell.js"
import { textBufferStringAtom, textBufferCursorAtom } from "../atoms/textBuffer.js"
import { routerModelsAtom, extensionStateAtom } from "../atoms/extension.js"
import { configAtom, providerAtom, updateProviderAtom } from "../atoms/config.js"
import { requestRouterModelsAtom } from "../atoms/actions.js"
import { profileDataAtom, profileLoadingAtom } from "../atoms/profile.js"
import { taskHistoryDataAtom } from "../atoms/taskHistory.js"
import { getModelIdKey } from "../../constants/providers/models.js"

/**
 * Return type for useCommandInput hook
 */
export interface UseCommandInputReturn {
	/** Current input value */
	inputValue: string
	/** Whether autocomplete menu is visible */
	isAutocompleteVisible: boolean
	/** Command suggestions (empty if showing argument suggestions) */
	commandSuggestions: CommandSuggestion[]
	/** Argument suggestions (empty if showing command suggestions) */
	argumentSuggestions: ArgumentSuggestion[]
	/** File mention suggestions (empty if not in file mention context) */
	fileMentionSuggestions: FileMentionSuggestion[]
	/** File mention context (null if not in file mention) */
	fileMentionContext: FileMentionContext | null
	/** Index of currently selected suggestion */
	selectedIndex: number
	/** Total count of suggestions */
	suggestionCount: number
	/** Whether input is a command (starts with /) */
	isCommand: boolean
	/** Command query (input without leading /) */
	commandQuery: string
	/** Currently selected suggestion */
	selectedSuggestion: CommandSuggestion | ArgumentSuggestion | FileMentionSuggestion | null
	/** Set input value and update suggestions */
	setInput: (value: string) => void
	/** Clear input and hide autocomplete */
	clearInput: () => void
	/** Select next suggestion */
	selectNext: () => void
	/** Select previous suggestion */
	selectPrevious: () => void
	/** Hide autocomplete menu */
	hideAutocomplete: () => void
	/** Show autocomplete menu */
	showAutocompleteMenu: () => void
	/** Update suggestions based on current input */
	updateSuggestions: () => Promise<void>
	/** Get the input state (command, argument, or none) */
	getInputState: () => ReturnType<typeof detectInputState>
}

/**
 * Hook for managing command input and autocomplete
 *
 * Provides comprehensive input management including autocomplete suggestions,
 * keyboard navigation, and command execution helpers. Automatically updates
 * suggestions as the user types.
 *
 * @example
 * ```tsx
 * function CommandInput() {
 *   const {
 *     inputValue,
 *     setInput,
 *     commandSuggestions,
 *     isAutocompleteVisible,
 *     selectNext,
 *     selectPrevious,
 *     selectedIndex
 *   } = useCommandInput()
 *
 *   const handleKeyDown = (e: KeyboardEvent) => {
 *     if (e.key === 'ArrowDown') {
 *       e.preventDefault()
 *       selectNext()
 *     } else if (e.key === 'ArrowUp') {
 *       e.preventDefault()
 *       selectPrevious()
 *     }
 *   }
 *
 *   return (
 *     <div>
 *       <input
 *         value={inputValue}
 *         onChange={e => setInput(e.target.value)}
 *         onKeyDown={handleKeyDown}
 *       />
 *       {isAutocompleteVisible && (
 *         <ul>
 *           {commandSuggestions.map((suggestion, i) => (
 *             <li key={i} className={i === selectedIndex ? 'selected' : ''}>
 *               {suggestion.command.name}
 *             </li>
 *           ))}
 *         </ul>
 *       )}
 *     </div>
 *   )
 * }
 * ```
 */
export function useCommandInput(): UseCommandInputReturn {
	// Read atoms
	const inputValue = useAtomValue(textBufferStringAtom)
	const cursor = useAtomValue(textBufferCursorAtom)
	const showAutocomplete = useAtomValue(showAutocompleteAtom)
	const isShellMode = useAtomValue(shellModeActiveAtom)
	const commandSuggestions = useAtomValue(suggestionsAtom)
	const argumentSuggestions = useAtomValue(argumentSuggestionsAtom)
	const fileMentionSuggestions = useAtomValue(fileMentionSuggestionsAtom)
	const fileMentionContext = useAtomValue(fileMentionContextAtom)
	const selectedIndex = useAtomValue(selectedIndexAtom)
	const suggestionCount = useAtomValue(suggestionCountAtom)
	const isCommand = useAtomValue(isCommandInputAtom)
	const commandQuery = useAtomValue(commandQueryAtom)
	const selectedSuggestion = useAtomValue(getSelectedSuggestionAtom)

	// Get command context for autocomplete
	const config = useAtomValue(configAtom)
	const routerModels = useAtomValue(routerModelsAtom)
	const currentProvider = useAtomValue(providerAtom)
	const extensionState = useAtomValue(extensionStateAtom)
	const kilocodeDefaultModel = (extensionState?.kilocodeDefaultModel as string | undefined) || ""
	const profileData = useAtomValue(profileDataAtom)
	const profileLoading = useAtomValue(profileLoadingAtom)
	const taskHistoryData = useAtomValue(taskHistoryDataAtom)
	const cwd = extensionState?.cwd || process.cwd()

	// Write atoms
	const setInputAction = useSetAtom(updateTextBufferAtom)
	const clearInputAction = useSetAtom(clearTextBufferAtom)
	const clearFileMentionAction = useSetAtom(clearFileMentionAtom)
	const updateAllSuggestionsAction = useSetAtom(updateAllSuggestionsAtom)
	const selectNextAction = useSetAtom(selectNextSuggestionAtom)
	const selectPreviousAction = useSetAtom(selectPreviousSuggestionAtom)
	const hideAutocompleteAction = useSetAtom(hideAutocompleteAtom)
	const showAutocompleteAction = useSetAtom(showAutocompleteMenuAtom)
	const updateProvider = useSetAtom(updateProviderAtom)
	const refreshRouterModels = useSetAtom(requestRouterModelsAtom)

	// Actions
	const setInput = useCallback(
		(value: string) => {
			setInputAction(value)
		},
		[setInputAction],
	)

	const clearInput = useCallback(() => {
		clearInputAction()
	}, [clearInputAction])

	const selectNext = useCallback(() => {
		selectNextAction()
	}, [selectNextAction])

	const selectPrevious = useCallback(() => {
		selectPreviousAction()
	}, [selectPreviousAction])

	const hideAutocomplete = useCallback(() => {
		hideAutocompleteAction()
	}, [hideAutocompleteAction])

	const showAutocompleteMenu = useCallback(() => {
		showAutocompleteAction()
	}, [showAutocompleteAction])

	const updateSuggestions = useCallback(async () => {
		// In shell mode, disable all autocomplete
		// Shell commands use @ (emails, SSH), / (paths), and other special chars
		// that shouldn't trigger autocomplete suggestions
		if (isShellMode) {
			// Clear all suggestion state
			clearFileMentionAction()
			updateAllSuggestionsAction({
				commandSuggestions: [],
				argumentSuggestions: [],
				fileMentionSuggestions: [],
				fileMentionContext: null,
			})
			return
		}

		// Calculate cursor position in the text (convert row/col to absolute position)
		const lines = inputValue.split("\n")
		let cursorPosition = 0
		for (let i = 0; i < cursor.row && i < lines.length; i++) {
			cursorPosition += (lines[i]?.length || 0) + 1 // +1 for newline
		}
		cursorPosition += cursor.column

		// Check for file mention context first (highest priority)
		const fileMentionCtx = detectFileMentionContext(inputValue, cursorPosition)
		if (fileMentionCtx?.isInMention) {
			// Get file suggestions
			const suggestions = await getFileMentionSuggestions(fileMentionCtx.query, cwd)
			updateAllSuggestionsAction({
				commandSuggestions: [],
				argumentSuggestions: [],
				fileMentionSuggestions: suggestions,
				fileMentionContext: fileMentionCtx,
			})
			return
		}

		clearFileMentionAction()

		// Fall back to command/argument detection
		if (!checkIsCommandInput(inputValue)) {
			updateAllSuggestionsAction({
				commandSuggestions: [],
				argumentSuggestions: [],
				fileMentionSuggestions: [],
				fileMentionContext: null,
			})
			return
		}

		const state = detectInputState(inputValue)

		if (state.type === "command") {
			// Get command suggestions
			const suggestions = getSuggestions(inputValue)
			updateAllSuggestionsAction({
				commandSuggestions: suggestions,
				argumentSuggestions: [],
				fileMentionSuggestions: [],
				fileMentionContext: null,
			})
		} else if (state.type === "argument") {
			// Create command context for argument providers
			const customModes = extensionState?.customModes || []
			const commandContext = {
				config,
				routerModels,
				currentProvider: currentProvider || null,
				kilocodeDefaultModel,
				profileData,
				profileLoading,
				taskHistoryData,
				chatMessages: [] as ExtensionMessage[],
				customModes,
				updateProviderModel: async (modelId: string) => {
					if (!currentProvider) {
						throw new Error("No provider configured")
					}
					const modelIdKey = getModelIdKey(currentProvider.provider)
					await updateProvider(currentProvider.id, {
						[modelIdKey]: modelId,
					})
				},
				refreshRouterModels: async () => {
					await refreshRouterModels()
				},
			}

			// Get argument suggestions with command context
			const suggestions = await getArgumentSuggestions(inputValue, commandContext)
			updateAllSuggestionsAction({
				commandSuggestions: [],
				argumentSuggestions: suggestions,
				fileMentionSuggestions: [],
				fileMentionContext: null,
			})
		} else {
			updateAllSuggestionsAction({
				commandSuggestions: [],
				argumentSuggestions: [],
				fileMentionSuggestions: [],
				fileMentionContext: null,
			})
		}
	}, [
		inputValue,
		cursor,
		cwd,
		isShellMode,
		clearFileMentionAction,
		updateAllSuggestionsAction,
		config,
		routerModels,
		currentProvider,
		kilocodeDefaultModel,
		profileData,
		profileLoading,
		taskHistoryData,
		updateProvider,
		refreshRouterModels,
		extensionState?.customModes,
	])

	const getInputState = useCallback(() => {
		return detectInputState(inputValue)
	}, [inputValue])

	// Auto-update suggestions when input or cursor changes
	useEffect(() => {
		// Always update suggestions to ensure proper cleanup
		// The updateSuggestions function handles clearing state when not in mention/command context
		updateSuggestions()
	}, [inputValue, cursor, updateSuggestions])

	// Memoize return value
	return useMemo(
		() => ({
			inputValue,
			isAutocompleteVisible: showAutocomplete || fileMentionSuggestions.length > 0,
			commandSuggestions,
			argumentSuggestions,
			fileMentionSuggestions,
			fileMentionContext,
			selectedIndex,
			suggestionCount,
			isCommand,
			commandQuery,
			selectedSuggestion,
			setInput,
			clearInput,
			selectNext,
			selectPrevious,
			hideAutocomplete,
			showAutocompleteMenu,
			updateSuggestions,
			getInputState,
		}),
		[
			inputValue,
			showAutocomplete,
			commandSuggestions,
			argumentSuggestions,
			fileMentionSuggestions,
			fileMentionContext,
			selectedIndex,
			suggestionCount,
			isCommand,
			commandQuery,
			selectedSuggestion,
			setInput,
			clearInput,
			selectNext,
			selectPrevious,
			hideAutocomplete,
			showAutocompleteMenu,
			updateSuggestions,
			getInputState,
		],
	)
}
