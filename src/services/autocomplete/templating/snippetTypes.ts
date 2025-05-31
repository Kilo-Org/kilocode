// AIDIFF: Added to define snippet types used by continue/ templating logic
// PLANREF: continue/core/autocomplete/snippets/types.js

// PLANREF: continue/core/autocomplete/snippets/types.ts
export enum AutocompleteSnippetType {
	Code = "code",
	Diff = "diff",
	Context = "context", // Kept for our existing logic, maps to general context
	Clipboard = "clipboard", // AIDIFF: Added from continue/
}

export interface AutocompleteBaseSnippet {
	type: AutocompleteSnippetType
	content: string
}

export interface AutocompleteCodeSnippet extends AutocompleteBaseSnippet {
	type: AutocompleteSnippetType.Code
	filepath: string
	language?: string // Optional, as our definitions might not always have it
}

export interface AutocompleteDiffSnippet extends AutocompleteBaseSnippet {
	type: AutocompleteSnippetType.Diff
	// Diff specific properties can be added if needed
}

// AIDIFF: Kept for now as PromptRenderer uses it for imports/definitions.
// Continue/ seems to use AutocompleteCodeSnippet more broadly for context.
export interface AutocompleteContextSnippet extends AutocompleteBaseSnippet {
	type: AutocompleteSnippetType.Context
	filepath: string // Or some identifier for the context source
}

// PLANREF: continue/core/autocomplete/snippets/types.ts (AutocompleteClipboardSnippet)
export interface AutocompleteClipboardSnippet extends AutocompleteBaseSnippet {
	type: AutocompleteSnippetType.Clipboard
	copiedAt: string // AIDIFF: Added from continue/
}

export type AutocompleteSnippet =
	| AutocompleteCodeSnippet
	| AutocompleteDiffSnippet
	| AutocompleteContextSnippet
	| AutocompleteClipboardSnippet // AIDIFF: Added from continue/
