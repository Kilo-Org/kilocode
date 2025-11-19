import { AutocompleteInput } from "../../types"
import { FillInAtCursorSuggestion } from "../HoleFiller"
import { GhostModel } from "../../GhostModel"
import { ApiStreamChunk } from "../../../../api/transform/stream"

export interface CompletionPrompts {
	systemPrompt?: string
	userPrompt?: string
	formattedPrefix: string
	formattedSuffix: string
}

export interface UsageInfo {
	cost: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
}

/**
 * Strategy interface for different autocomplete approaches (HoleFiller, FIM, etc.)
 */
export interface ICompletionStrategy {
	/**
	 * Generate prompts for the completion request
	 */
	getPrompts(
		autocompleteInput: AutocompleteInput,
		prefix: string,
		suffix: string,
		languageId: string,
		modelName?: string,
	): Promise<CompletionPrompts>

	/**
	 * Parse the raw response from the model into a suggestion
	 */
	parseResponse(response: string, prefix: string, suffix: string): FillInAtCursorSuggestion

	/**
	 * Generate response using the model
	 */
	generateResponse(
		model: GhostModel,
		prompts: CompletionPrompts,
		onChunk: (chunk: ApiStreamChunk | string) => void,
		taskId?: string,
	): Promise<UsageInfo>
}
