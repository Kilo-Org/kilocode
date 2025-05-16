/**
 * Type definitions for continue-wrapper
 * These types are re-exported from @continuedev/core or defined here if not available
 */

import { RangeInFile } from "@continuedev/core"

/**
 * Represents a code snippet used for autocomplete suggestions
 */
export interface AutocompleteCodeSnippet {
	filepath: string
	range: {
		start: { line: number; character: number }
		end: { line: number; character: number }
	}
	content: string
}

/**
 * Represents a range that was recently edited
 */
export interface RecentlyEditedRange extends RangeInFile {
	timestamp: number
	content: string
}
