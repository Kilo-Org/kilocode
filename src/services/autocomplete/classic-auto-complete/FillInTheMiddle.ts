import {
	AutocompleteInput,
	AutocompleteContextProvider,
	FimAutocompletePrompt,
	FimCompletionResult,
	FillInAtCursorSuggestion,
} from "../types"
import { getProcessedSnippets } from "./getProcessedSnippets"
import { getTemplateForModel } from "../continuedev/core/autocomplete/templating/AutocompleteTemplate"
import { AutocompleteModel } from "../AutocompleteModel"

export type { FimAutocompletePrompt, FimCompletionResult }

export class FimPromptBuilder {
	constructor(private contextProvider: AutocompleteContextProvider) {}

	/**
	 * Build complete FIM prompt with all necessary data
	 */
	async getFimPrompts(autocompleteInput: AutocompleteInput, modelName: string): Promise<FimAutocompletePrompt> {
		const { filepathUri, helper, snippetsWithUris, workspaceDirs } = await getProcessedSnippets(
			autocompleteInput,
			autocompleteInput.filepath,
			this.contextProvider.contextService,
			this.contextProvider.model,
			this.contextProvider.ide,
			this.contextProvider.ignoreController,
		)

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
		model: AutocompleteModel,
		prompt: FimAutocompletePrompt,
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
