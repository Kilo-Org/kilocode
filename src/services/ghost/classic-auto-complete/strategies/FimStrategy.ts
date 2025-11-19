import { AutocompleteInput } from "../../types"
import { FillInAtCursorSuggestion } from "../HoleFiller"
import { GhostContextProvider } from "../GhostContextProvider"
import { ICompletionStrategy, CompletionPrompts, UsageInfo } from "./ICompletionStrategy"
import { GhostModel } from "../../GhostModel"
import { getTemplateForModel } from "../../../continuedev/core/autocomplete/templating/AutocompleteTemplate"

/**
 * FIM (Fill-In-the-Middle) strategy - uses model-specific template formatting
 */
export class FimStrategy implements ICompletionStrategy {
	constructor(private contextProvider: GhostContextProvider) {}

	async getPrompts(
		autocompleteInput: AutocompleteInput,
		prefix: string,
		suffix: string,
		_languageId: string,
		modelName?: string,
	): Promise<CompletionPrompts> {
		const { filepathUri, snippetsWithUris, workspaceDirs } = await this.contextProvider.getProcessedSnippets(
			autocompleteInput,
			autocompleteInput.filepath,
		)

		const template = getTemplateForModel(modelName ?? "codestral")

		let formattedPrefix = prefix
		let formattedSuffix = suffix

		if (template.compilePrefixSuffix) {
			;[formattedPrefix, formattedSuffix] = template.compilePrefixSuffix(
				prefix,
				suffix,
				filepathUri,
				"", // reponame not used in our context
				snippetsWithUris,
				workspaceDirs,
			)
		}

		console.log("[FIM] formattedPrefix:", formattedPrefix)

		return {
			formattedPrefix,
			formattedSuffix,
			// No system/user prompts for FIM - it uses the formatted prefix/suffix directly
		}
	}

	parseResponse(response: string, prefix: string, suffix: string): FillInAtCursorSuggestion {
		// FIM responses are direct - no XML parsing needed
		return { text: response, prefix, suffix }
	}

	async generateResponse(
		model: GhostModel,
		prompts: CompletionPrompts,
		onChunk: (chunk: string) => void,
		taskId?: string,
	): Promise<UsageInfo> {
		// FIM uses string format for chunks
		const chunkHandler = (text: string) => {
			onChunk(text)
		}

		return model.generateFimResponse(prompts.formattedPrefix, prompts.formattedSuffix, chunkHandler, taskId)
	}
}
