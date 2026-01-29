import { TabAutocompleteOptions } from "../index.js"

export const DEFAULT_AUTOCOMPLETE_OPTS: TabAutocompleteOptions = {
	disable: false,
	maxPromptTokens: 2048,
	prefixPercentage: 0.3,
	maxSuffixPercentage: 0.2,
	maxSnippetPercentage: 0.6,
	debounceDelay: 350,
	modelTimeout: 150,
	multilineCompletions: "auto",
	// @deprecated TO BE REMOVED
	slidingWindowPrefixPercentage: 0.75,
	// @deprecated TO BE REMOVED
	slidingWindowSize: 500,
	useCache: true,
	onlyMyCode: true,
	useRecentlyEdited: true,
	useRecentlyOpened: true,
	disableInFiles: undefined,
	useImports: true,
	transform: true,
	showWhateverWeHaveAtXMs: 300,
	// Experimental options: true = enabled, false = disabled, number = enabled w priority
	experimental_includeClipboard: false,
	experimental_includeRecentlyVisitedRanges: true,
	experimental_includeRecentlyEditedRanges: true,
	experimental_includeDiff: true,
	experimental_enableStaticContextualization: false,
}

export const COUNT_COMPLETION_REJECTED_AFTER = 10_000
