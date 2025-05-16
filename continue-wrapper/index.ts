/**
 * Wrapper for @continuedev/core to ensure TypeScript compatibility with KiloCode
 */

// Import type declarations to fix TypeScript errors
import "./types"

// Re-export types from @continuedev/core
export type {
	Position,
	Range,
	RangeInFile,
	ChatMessage,
	ILLM,
	CompletionOptions,
	TabAutocompleteOptions,
} from "@continuedev/core"

// Re-export from @continuedev/core
export * from "@continuedev/core"

// Re-export our custom types
export type { AutocompleteCodeSnippet, RecentlyEditedRange } from "./types"

// Export any additional types or classes needed by KiloCode
