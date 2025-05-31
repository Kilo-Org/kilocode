//PLANREF: continue/core/autocomplete/util/types.ts
//PLANREF: continue/core/autocomplete/types.ts
import { Position } from "vscode"
import { RangeInFile, Range, RangeInFileWithContents } from "./ide-types"

export interface BaseCompletionOptions {
	temperature?: number
	topP?: number
	topK?: number
	minP?: number
	presencePenalty?: number
	frequencyPenalty?: number
	mirostat?: number
	stop?: string[]
	maxTokens?: number
	numThreads?: number
	useMmap?: boolean
	keepAlive?: number
	numGpu?: number
	raw?: boolean
	stream?: boolean
	prediction?: Prediction
	// tools?: Tool[]
	// toolChoice?: ToolChoice
	reasoning?: boolean
	reasoningBudgetTokens?: number
	promptCaching?: boolean
}

export interface CompletionOptions extends BaseCompletionOptions {
	model: string
}

export type RecentlyEditedRange = RangeInFile & {
	timestamp: number
	lines: string[]
	symbols: Set<string>
}

export interface AutocompleteInput {
	isUntitledFile: boolean
	completionId: string
	filepath: string
	pos: Position
	recentlyVisitedRanges: unknown[]
	recentlyEditedRanges: RecentlyEditedRange[]
	// Used for notebook files
	manuallyPassFileContents?: string
	// Used for VS Code git commit input box
	manuallyPassPrefix?: string
	selectedCompletionInfo?: {
		text: string
		range: Range
	}
	injectDetails?: string
}

export interface Prediction {
	type: "content"
	content:
		| string
		| {
				type: "text"
				text: string
		  }[]
}

/**
 * @deprecated This type should be removed in the future or renamed.
 * We have a new interface called AutocompleteSnippet which is more
 * general.
 */
export type AutocompleteSnippetDeprecated = RangeInFileWithContents & {
	score?: number
}
