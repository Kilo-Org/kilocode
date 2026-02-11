import { LLMClient } from "./llm-client.js"
import { extractPrefixSuffix } from "../services/autocomplete/types.js"
import { createContext } from "./utils.js"
import {
	createTestAutocompleteModel,
	createMockContextProvider,
	modelSupportsFim,
	createProviderForTesting,
} from "./mock-context-provider.js"
import {
	AutocompleteInlineCompletionProvider,
	findMatchingSuggestion,
} from "../services/autocomplete/classic-auto-complete/AutocompleteInlineCompletionProvider.js"
import { AutocompleteModel } from "../services/autocomplete/AutocompleteModel.js"
import type { ContextFile } from "./test-cases.js"

export class AutocompleteProviderTester {
	private llmClient: LLMClient
	private modelId: string
	private autocompleteModel: AutocompleteModel

	constructor() {
		this.modelId = process.env.LLM_MODEL || "mistralai/codestral-2508"
		this.llmClient = new LLMClient()
		this.autocompleteModel = createTestAutocompleteModel(this.llmClient, this.modelId)
	}

	async getCompletion(
		code: string,
		testCaseName: string = "test",
		contextFiles: ContextFile[] = [],
	): Promise<{ prefix: string; completion: string; suffix: string }> {
		const context = createContext(code, testCaseName)
		const position = context.range?.start ?? context.document.positionAt(0)
		const { prefix, suffix } = extractPrefixSuffix(context.document, position)
		const languageId = context.document.languageId || "javascript"

		// Create context provider with the actual content for prompt building
		const contextProvider = createMockContextProvider(
			prefix,
			suffix,
			context.document.fileName,
			this.autocompleteModel,
			contextFiles,
		)

		// Create a fresh provider instance for this completion
		const provider = createProviderForTesting(contextProvider)

		// Use the provider's getPrompt method to build the prompt
		const {
			prompt,
			prefix: promptPrefix,
			suffix: promptSuffix,
		} = await provider.getPrompt(context.document, position)

		// Use the provider's fetchAndCacheSuggestion method directly
		await provider.fetchAndCacheSuggestion(prompt, promptPrefix, promptSuffix, languageId)

		// Retrieve the cached suggestion using findMatchingSuggestion
		const result = findMatchingSuggestion(promptPrefix, promptSuffix, provider.suggestionsHistory)

		// Clean up
		provider.dispose()

		return { prefix: promptPrefix, completion: result?.text ?? "", suffix: promptSuffix }
	}

	getName(): string {
		const supportsFim = modelSupportsFim(this.modelId)
		return supportsFim ? "autocomplete-provider-fim" : "autocomplete-provider-holefiller"
	}

	dispose(): void {
		// No longer needed since we dispose the provider in getCompletion
	}
}
