import { ICompletionStrategy } from "../interfaces/ICompletionStrategy"
import { CompletionRequest } from "../interfaces/CompletionRequest"
import { CompletionResult } from "../interfaces/CompletionResult"
import { GhostModel } from "../../GhostModel"
import { GhostContextProvider } from "../../classic-auto-complete/GhostContextProvider"
import { HoleFiller, parseGhostResponse } from "../../classic-auto-complete/HoleFiller"
import { ApiStreamChunk } from "../../../../api/transform/stream"
import { postprocessGhostSuggestion } from "../../classic-auto-complete/uselessSuggestionFilter"

/**
 * HoleFiller strategy implementation
 * Uses {{FILL_HERE}} placeholder approach for completion
 */
export class HoleFillerStrategy implements ICompletionStrategy {
	readonly name = "holefiller"
	readonly description = "Uses {{FILL_HERE}} placeholder approach for code completion"

	private holeFiller: HoleFiller

	constructor(contextProvider?: GhostContextProvider) {
		this.holeFiller = new HoleFiller(contextProvider)
	}

	supportsModel(model: GhostModel): boolean {
		// HoleFiller works with any model that supports regular chat completion
		return model.hasValidCredentials()
	}

	getPriority(): number {
		return 1 // Lowest priority, used as fallback
	}

	async generateCompletion(
		request: CompletionRequest,
		model: GhostModel,
		contextProvider: GhostContextProvider,
	): Promise<CompletionResult> {
		const startTime = Date.now()

		// Generate prompts using existing HoleFiller logic
		const promptGenerationStart = Date.now()
		const { systemPrompt, userPrompt } = await this.holeFiller.getPrompts(
			request.autocompleteInput,
			request.prefix,
			request.suffix,
			request.languageId,
		)
		const promptGenerationTime = Date.now() - promptGenerationStart

		console.log("[HoleFiller] userPrompt:", userPrompt)

		let response = ""
		const onChunk = (chunk: ApiStreamChunk) => {
			if (chunk.type === "text") {
				response += chunk.text
			}
		}

		const serverCallStart = Date.now()
		const usageInfo = await model.generateResponse(systemPrompt, userPrompt, onChunk)
		const serverCallTime = Date.now() - serverCallStart

		console.log("[HoleFiller] response:", response)

		// Parse response using existing HoleFiller logic
		const parsedSuggestion = parseGhostResponse(response, request.prefix, request.suffix)

		// Apply postprocessing
		const processedText = postprocessGhostSuggestion({
			suggestion: parsedSuggestion.text,
			prefix: request.prefix,
			suffix: request.suffix,
			model: model.getModelName() || "",
		})

		const finalSuggestion = {
			text: processedText || "",
			prefix: request.prefix,
			suffix: request.suffix,
		}

		if (finalSuggestion.text) {
			console.info("[HoleFiller] Final suggestion:", finalSuggestion)
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
		}
	}
}
