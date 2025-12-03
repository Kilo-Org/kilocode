import { IContextProvider } from "./IContextProvider"
import { HoleFiller, FillInAtCursorSuggestion } from "./HoleFiller"
import { FimPromptBuilder } from "./FillInTheMiddle"
import { GhostModel } from "../GhostModel"
import { AutocompleteInput } from "../types"
import { postprocessGhostSuggestion } from "./uselessSuggestionFilter"

export interface CompletionResult {
	suggestion: FillInAtCursorSuggestion
	cost: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	strategy: "fim" | "hole_filler"
}

/**
 * Core completion engine that orchestrates autocompletion without VSCode dependencies.
 * This class can be used both in the VSCode extension and in standalone testing environments.
 */
export class CompletionEngine {
	private holeFiller: HoleFiller
	private fimPromptBuilder: FimPromptBuilder

	constructor(contextProvider: IContextProvider) {
		this.holeFiller = new HoleFiller(contextProvider)
		this.fimPromptBuilder = new FimPromptBuilder(contextProvider)
	}

	/**
	 * Get a completion suggestion using either FIM or HoleFiller strategy
	 * @param model - The GhostModel to use for generation
	 * @param autocompleteInput - The autocomplete request input
	 * @param languageId - The language ID of the file being edited
	 * @param prefix - The text before the cursor
	 * @param suffix - The text after the cursor
	 * @returns Completion result with suggestion and usage information
	 */
	async getCompletion(
		model: GhostModel,
		autocompleteInput: AutocompleteInput,
		languageId: string,
		prefix: string,
		suffix: string,
	): Promise<CompletionResult> {
		// Determine strategy based on model capabilities
		const useFim = model.supportsFim()
		const strategy = useFim ? "fim" : "hole_filler"

		// Create processor function that applies postprocessing
		const processSuggestion = (text: string): FillInAtCursorSuggestion => {
			if (!text) {
				return { text: "", prefix, suffix }
			}

			const processedText = postprocessGhostSuggestion({
				suggestion: text,
				prefix,
				suffix,
				model: model.getModelName() || "",
			})

			return {
				text: processedText || "",
				prefix,
				suffix,
			}
		}

		// Get completion using appropriate strategy
		if (useFim) {
			const prompt = await this.fimPromptBuilder.getFimPrompts(
				autocompleteInput,
				model.getModelName() ?? "codestral",
			)
			const result = await this.fimPromptBuilder.getFromFIM(model, prompt, processSuggestion)
			return {
				...result,
				strategy: "fim",
			}
		} else {
			const prompt = await this.holeFiller.getPrompts(autocompleteInput, languageId)
			const result = await this.holeFiller.getFromChat(model, prompt, processSuggestion)
			return {
				...result,
				strategy: "hole_filler",
			}
		}
	}
}
