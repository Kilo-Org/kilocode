import { AutocompleteInput } from "../../types"
import { FillInAtCursorSuggestion, parseGhostResponse, getBaseSystemInstructions } from "../HoleFiller"
import { GhostContextProvider } from "../GhostContextProvider"
import { ICompletionStrategy, CompletionPrompts, UsageInfo } from "./ICompletionStrategy"
import { GhostModel } from "../../GhostModel"
import { ApiStreamChunk } from "../../../../api/transform/stream"
import { formatSnippets } from "../../../continuedev/core/autocomplete/templating/formatting"

/**
 * HoleFiller strategy - uses XML-based prompts with {{FILL_HERE}} placeholder
 */
export class HoleFillerStrategy implements ICompletionStrategy {
	constructor(private contextProvider?: GhostContextProvider) {}

	async getPrompts(
		autocompleteInput: AutocompleteInput,
		prefix: string,
		suffix: string,
		languageId: string,
		_modelName?: string,
	): Promise<CompletionPrompts> {
		const userPrompt = await this.getUserPrompt(autocompleteInput, prefix, suffix, languageId)
		return {
			systemPrompt: this.getSystemInstructions(),
			userPrompt,
			formattedPrefix: prefix,
			formattedSuffix: suffix,
		}
	}

	parseResponse(response: string, prefix: string, suffix: string): FillInAtCursorSuggestion {
		return parseGhostResponse(response, prefix, suffix)
	}

	async generateResponse(
		model: GhostModel,
		prompts: CompletionPrompts,
		onChunk: (chunk: ApiStreamChunk | string) => void,
	): Promise<UsageInfo> {
		// HoleFiller uses ApiStreamChunk format
		const chunkHandler = (chunk: ApiStreamChunk) => {
			onChunk(chunk)
		}

		return model.generateResponse(prompts.systemPrompt!, prompts.userPrompt!, chunkHandler)
	}

	private getSystemInstructions(): string {
		return (
			getBaseSystemInstructions() +
			`Task: Auto-Completion
Provide a subtle, non-intrusive completion after a typing pause.

`
		)
	}

	/**
	 * Build minimal prompt for auto-trigger with optional context
	 */
	private async getUserPrompt(
		autocompleteInput: AutocompleteInput,
		prefix: string,
		suffix: string,
		languageId: string,
	): Promise<string> {
		let prompt = `<LANGUAGE>${languageId}</LANGUAGE>\n\n`

		let formattedContext = ""
		if (this.contextProvider && autocompleteInput.filepath) {
			try {
				const { helper, snippetsWithUris, workspaceDirs } = await this.contextProvider.getProcessedSnippets(
					autocompleteInput,
					autocompleteInput.filepath,
				)
				formattedContext = formatSnippets(helper, snippetsWithUris, workspaceDirs)
			} catch (error) {
				console.warn("Failed to get formatted context:", error)
			}
		}

		prompt += `<QUERY>
${formattedContext}${formattedContext ? "\n" : ""}${prefix}{{FILL_HERE}}${suffix}
</QUERY>

TASK: Fill the {{FILL_HERE}} hole. Answer only with the CORRECT completion, and NOTHING ELSE. Do it now.
Return the COMPLETION tags`

		return prompt
	}
}
