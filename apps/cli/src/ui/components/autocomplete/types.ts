import type { ReactNode } from "react"

/**
 * Represents a single autocomplete result item.
 * All result types must extend this with a unique key.
 */
export interface AutocompleteItem {
	/** Unique identifier for this item */
	key: string
}

/**
 * Result from trigger detection.
 */
export interface TriggerDetectionResult {
	/** The search query extracted from the input */
	query: string
	/** Position of trigger character in the line */
	triggerIndex: number
}

/**
 * Configuration for an autocomplete trigger.
 * Each trigger defines how to detect, search, and render autocomplete options.
 *
 * @template T - The type of items this trigger produces
 */
export interface AutocompleteTrigger<T extends AutocompleteItem = AutocompleteItem> {
	/**
	 * Unique identifier for this trigger.
	 * Used to track which trigger is active.
	 */
	id: string

	/**
	 * The character(s) that activate this trigger.
	 * Examples: "@", "/", "#"
	 */
	triggerChar: string

	/**
	 * Where the trigger must appear to activate.
	 * - 'anywhere': Can appear anywhere in the line (e.g., @ for file mentions)
	 * - 'line-start': Must be at start of line, optionally after whitespace (e.g., / for commands)
	 */
	position: "anywhere" | "line-start"

	/**
	 * Detect if this trigger is active and extract the search query.
	 * @param lineText - The current line of text
	 * @returns Detection result with query and position, or null if trigger not active
	 */
	detectTrigger: (lineText: string) => TriggerDetectionResult | null

	/**
	 * Search/filter results based on query.
	 * Can be synchronous (local filtering) or asynchronous (API call).
	 * @param query - The search query
	 * @returns Array of matching items
	 */
	search: (query: string) => T[] | Promise<T[]>

	/**
	 * Get current results without triggering a new search.
	 * Used for refreshing results when async data arrives.
	 * If not provided, forceRefresh will fall back to search().
	 * @param query - The search query for filtering
	 * @returns Array of matching items from current data
	 */
	refreshResults?: (query: string) => T[] | Promise<T[]>

	/**
	 * Render a single item in the picker dropdown.
	 * @param item - The item to render
	 * @param isSelected - Whether this item is currently selected
	 * @returns React node to render
	 */
	renderItem: (item: T, isSelected: boolean) => ReactNode

	/**
	 * Generate the replacement text when an item is selected.
	 * @param item - The selected item
	 * @param lineText - The current line text
	 * @param triggerIndex - Position of trigger character in line
	 * @returns The new line text with selection inserted
	 */
	getReplacementText: (item: T, lineText: string, triggerIndex: number) => string

	/**
	 * Message to show when no results match.
	 * @default "No results found"
	 */
	emptyMessage?: string

	/**
	 * Debounce delay in milliseconds for search.
	 * @default 150
	 */
	debounceMs?: number

	/**
	 * Whether the trigger character should be consumed (not shown in input).
	 * When true, the trigger character is treated as a control character
	 * that activates the picker but doesn't appear in the text input.
	 * @default false
	 */
	consumeTrigger?: boolean
}

/**
 * State for the active autocomplete picker.
 */
export interface AutocompletePickerState<T extends AutocompleteItem = AutocompleteItem> {
	/** Which trigger is currently active (by id) */
	activeTrigger: AutocompleteTrigger<T> | null
	/** Current search results */
	results: T[]
	/** Currently selected index */
	selectedIndex: number
	/** Whether picker is visible */
	isOpen: boolean
	/** Loading state for async searches */
	isLoading: boolean
	/** The detected trigger info */
	triggerInfo: TriggerDetectionResult | null
}

/**
 * Result from handleInputChange indicating if input should be modified.
 */
export interface InputChangeResult {
	/** If set, the input value should be replaced with this value (trigger char consumed) */
	consumedValue?: string
}

/**
 * Actions returned by the useAutocompletePicker hook.
 */
export interface AutocompletePickerActions<T extends AutocompleteItem> {
	/** Handle input value changes - detects triggers and initiates search */
	handleInputChange: (value: string, lineText: string) => InputChangeResult
	/** Handle item selection - returns the new input value */
	handleSelect: (item: T, fullValue: string, lineText: string) => string
	/** Close the picker */
	handleClose: () => void
	/** Update selected index */
	handleIndexChange: (index: number) => void
	/** Navigate selection up */
	navigateUp: () => void
	/** Navigate selection down */
	navigateDown: () => void
	/** Force refresh the current search results (for async data that arrived after initial search) */
	forceRefresh: () => void
}
