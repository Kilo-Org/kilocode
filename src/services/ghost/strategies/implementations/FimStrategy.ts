import { ICompletionStrategy } from "../interfaces/ICompletionStrategy"
import { CompletionRequest } from "../interfaces/CompletionRequest"
import { CompletionResult } from "../interfaces/CompletionResult"
import { GhostModel } from "../../GhostModel"
import { GhostContextProvider } from "../../classic-auto-complete/GhostContextProvider"
import { getTemplateForModel } from "../../../continuedev/core/autocomplete/templating/AutocompleteTemplate"
import { postprocessGhostSuggestion } from "../../classic-auto-complete/uselessSuggestionFilter"

/**
 * FIM (Fill-In-Middle) strategy implementation
 * Uses native FIM API endpoints for completion
 */
export class FimStrategy implements ICompletionStrategy {
	readonly name = "fim"
	readonly description = "Uses native Fill-In-Middle API for code completion"

	supportsModel(model: GhostModel): boolean {
		return model.supportsFim()
	}

	getPriority(): number {
		return 10 // High priority, preferred when available
	}

	async generateCompletion(
		request: CompletionRequest,
		model: GhostModel,
		contextProvider: GhostContextProvider,
	): Promise<CompletionResult> {
		const startTime = Date.now()

		// Get processed snippets for context
		const promptGenerationStart = Date.now()
		const { filepathUri, snippetsWithUris, workspaceDirs } = await contextProvider.getProcessedSnippets(
			request.autocompleteInput,
			request.autocompleteInput.filepath,
		)

		// Get template for model
		const modelName = model.getModelName() ?? "codestral"
		const template = getTemplateForModel(modelName)

		// Format prefix using template
		let formattedPrefix = request.prefix
		if (template.compilePrefixSuffix) {
			const [compiledPrefix] = template.compilePrefixSuffix(
				request.prefix,
				request.suffix,
				filepathUri,
				"", // reponame not used in our context
				snippetsWithUris,
				workspaceDirs,
			)
			formattedPrefix = compiledPrefix
		}
		const promptGenerationTime = Date.now() - promptGenerationStart

		console.log("[FIM] formattedPrefix:", formattedPrefix)

		let response = ""
		const onChunk = (text: string) => {
			response += text
		}

		const serverCallStart = Date.now()
		const usageInfo = await model.generateFimResponse(
			formattedPrefix,
			request.suffix,
			onChunk,
			request.autocompleteInput.completionId,
		)
		const serverCallTime = Date.now() - serverCallStart

		console.log("[FIM] response:", response)

		// Apply postprocessing
		const processedText = postprocessGhostSuggestion({
			suggestion: response,
			prefix: request.prefix,
			suffix: request.suffix,
			model: modelName,
		})

		const finalSuggestion = {
			text: processedText || "",
			prefix: request.prefix,
			suffix: request.suffix,
		}

		if (finalSuggestion.text) {
			console.info("[FIM] Final suggestion:", finalSuggestion)
		}

		const totalDuration = Date.now() - startTime

		return {
			suggestion: finalSuggestion,
			cost: usageInfo.cost,
			inputTokens: usageInfo.inputTokens,
			outputTokens: usageInfo.outputTokens,
			cacheWriteTokens: usageInfo.cacheWriteTokens,
			cacheReadTokens: usageInfo.cacheReadTokens,
			strategyUsed: this.name,
			metrics: {
				duration: totalDuration,
				promptGenerationTime,
				serverCallTime,
			},
			strategyMetadata: {
				templateUsed: modelName,
				formattedPrefix: formattedPrefix !== request.prefix,
			},
		}
	}
}
