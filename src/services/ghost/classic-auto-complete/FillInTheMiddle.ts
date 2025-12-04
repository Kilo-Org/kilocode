import { AutocompleteInput } from "../types"
import { getTemplateForModel } from "../../continuedev/core/autocomplete/templating/AutocompleteTemplate"
import { FillInAtCursorSuggestion, ProcessedSnippetsResult } from "./HoleFiller"

/**
 * Interface for models that can generate FIM (Fill-In-Middle) completions.
 * This allows both GhostModel and test implementations to be used.
 */
export interface FimCompletionModel {
	generateFimResponse(
		prefix: string,
		suffix: string,
		onChunk: (text: string) => void,
		taskId?: string,
	): Promise<{
		cost: number
		inputTokens: number
		outputTokens: number
		cacheWriteTokens: number
		cacheReadTokens: number
	}>
}

export interface FimGhostPrompt {
	strategy: "fim"
	autocompleteInput: AutocompleteInput
	formattedPrefix: string
	prunedSuffix: string
}

export interface FimCompletionResult {
	suggestion: FillInAtCursorSuggestion
	cost: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
}

export class FimPromptBuilder {
	/**
	 * Build complete FIM prompt with all necessary data
	 * @param snippetsResult - Pre-computed snippets from getProcessedSnippets
	 * @param autocompleteInput - The autocomplete input context
	 * @param modelName - The model name for template selection
	 */
	getFimPrompts(
		snippetsResult: ProcessedSnippetsResult,
		autocompleteInput: AutocompleteInput,
		modelName: string,
	): FimGhostPrompt {
		const { filepathUri, helper, snippetsWithUris, workspaceDirs } = snippetsResult

		// Use pruned prefix/suffix from HelperVars (token-limited based on DEFAULT_AUTOCOMPLETE_OPTS)
		const prunedPrefixRaw = helper.prunedPrefix
		const prunedSuffix = helper.prunedSuffix

		const template = getTemplateForModel(modelName)

		let formattedPrefix = prunedPrefixRaw
		if (template.compilePrefixSuffix && prunedSuffix) {
			const [compiledPrefix] = template.compilePrefixSuffix(
				prunedPrefixRaw,
				prunedSuffix,
				filepathUri,
				"", // reponame not used in our context
				snippetsWithUris,
				workspaceDirs,
			)
			formattedPrefix = compiledPrefix
		}

		return {
			strategy: "fim",
			formattedPrefix,
			prunedSuffix,
			autocompleteInput,
		}
	}

	/**
	 * Execute FIM-based completion using the model
	 */
	async getFromFIM(
		model: FimCompletionModel,
		prompt: FimGhostPrompt,
		processSuggestion: (text: string) => FillInAtCursorSuggestion,
	): Promise<FimCompletionResult> {
		const { formattedPrefix, prunedSuffix, autocompleteInput } = prompt
		let perflog = ""
		const logtime = (() => {
			let timestamp = performance.now()
			return (msg: string) => {
				const baseline = timestamp
				timestamp = performance.now()
				perflog += `${msg}: ${timestamp - baseline}\n`
			}
		})()

		logtime("snippets")

		console.log("[FIM] formattedPrefix:", formattedPrefix)

		let response = ""
		const onChunk = (text: string) => {
			response += text
		}
		logtime("prep fim")
		const usageInfo = await model.generateFimResponse(
			formattedPrefix,
			prunedSuffix,
			onChunk,
			autocompleteInput.completionId, // Pass completionId as taskId for tracking
		)
		logtime("fim network")
		console.log("[FIM] response:", response)

		const fillInAtCursorSuggestion = processSuggestion(response)

		if (fillInAtCursorSuggestion.text) {
			console.info("Final FIM suggestion:", fillInAtCursorSuggestion)
		}
		logtime("processSuggestion")
		console.log(perflog + `lengths: ${formattedPrefix.length + prunedSuffix.length}\n`)
		return {
			suggestion: fillInAtCursorSuggestion,
			cost: usageInfo.cost,
			inputTokens: usageInfo.inputTokens,
			outputTokens: usageInfo.outputTokens,
			cacheWriteTokens: usageInfo.cacheWriteTokens,
			cacheReadTokens: usageInfo.cacheReadTokens,
		}
	}
}
