import { AutocompleteInput } from "../types"
import { GhostContextProvider } from "./GhostContextProvider"
import { getTemplateForModel } from "../../continuedev/core/autocomplete/templating/AutocompleteTemplate"
import { GhostModel } from "../GhostModel"
import { FillInAtCursorSuggestion, UsageInfo } from "./HoleFiller"

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
	constructor(private contextProvider: GhostContextProvider) {}

	/**
	 * Build complete FIM prompt with all necessary data
	 */
	async getFimPrompts(autocompleteInput: AutocompleteInput, modelName: string): Promise<FimGhostPrompt> {
		const { filepathUri, helper, snippetsWithUris, workspaceDirs } =
			await this.contextProvider.getProcessedSnippets(autocompleteInput, autocompleteInput.filepath)

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
		model: GhostModel,
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

	/**
	 * Create a streaming generator for FIM-based completion.
	 * Yields raw text chunks as they arrive.
	 *
	 * @param model - The GhostModel to use for generation
	 * @param prompt - The FIM prompt configuration
	 * @param abortSignal - Optional signal to abort the generation
	 * @returns AsyncGenerator that yields text chunks and returns usage info
	 */
	createStreamingGenerator(
		model: GhostModel,
		prompt: FimGhostPrompt,
		abortSignal?: AbortSignal,
	): AsyncGenerator<string, UsageInfo> {
		const { formattedPrefix, prunedSuffix, autocompleteInput } = prompt
		console.log("[FIM] formattedPrefix (streaming):", formattedPrefix)
		return model.streamFimResponse(formattedPrefix, prunedSuffix, abortSignal, autocompleteInput.completionId)
	}
}
