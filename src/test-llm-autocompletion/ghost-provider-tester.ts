import { LLMClient } from "./llm-client.js"
import { extractPrefixSuffix } from "../services/ghost/types.js"
import { createContext } from "./utils.js"
import {
	createTestGhostModel,
	createMockContextProvider,
	modelSupportsFim,
	createProviderForTesting,
} from "./mock-context-provider.js"
import {
	GhostInlineCompletionProvider,
	findMatchingSuggestion,
} from "../services/ghost/classic-auto-complete/GhostInlineCompletionProvider.js"
import { GhostModel } from "../services/ghost/GhostModel.js"
import type { ContextFile } from "./test-cases.js"

export class GhostProviderTester {
	private llmClient: LLMClient
	private modelId: string
	private ghostModel: GhostModel

	constructor() {
		this.modelId = process.env.LLM_MODEL || "mistralai/codestral-2508"
		this.llmClient = new LLMClient()
		this.ghostModel = createTestGhostModel(this.llmClient, this.modelId)
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
			this.ghostModel,
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
		return supportsFim ? "ghost-provider-fim" : "ghost-provider-holefiller"
	}

	dispose(): void {
		// No longer needed since we dispose the provider in getCompletion
	}
}
