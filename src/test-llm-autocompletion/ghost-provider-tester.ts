import { LLMClient } from "./llm-client.js"
import { HoleFiller, parseGhostResponse } from "../services/ghost/classic-auto-complete/HoleFiller.js"
import { FimPromptBuilder } from "../services/ghost/classic-auto-complete/FillInTheMiddle.js"
import { extractPrefixSuffix, contextToAutocompleteInput, GhostContextProvider } from "../services/ghost/types.js"
import { createContext } from "./utils.js"
import { createMockContextProvider, modelSupportsFim } from "./mock-context-provider.js"

export class GhostProviderTester {
	private llmClient: LLMClient
	private model: string

	constructor() {
		this.model = process.env.LLM_MODEL || "mistralai/codestral-2508"
		this.llmClient = new LLMClient()
	}

	async getCompletion(
		code: string,
		testCaseName: string = "test",
	): Promise<{ prefix: string; completion: string; suffix: string }> {
		const context = createContext(code, testCaseName)
		const { prefix, suffix } = extractPrefixSuffix(
			context.document,
			context.range?.start ?? context.document.positionAt(0),
		)
		const autocompleteInput = contextToAutocompleteInput(context)
		const languageId = context.document.languageId || "javascript"

		// Create mock context provider
		const mockContextProvider = createMockContextProvider(prefix, suffix, autocompleteInput.filepath)

		// Auto-detect strategy based on model capabilities
		const supportsFim = modelSupportsFim(this.model)
		const completion = supportsFim
			? await this.getFimCompletion(mockContextProvider, autocompleteInput)
			: await this.getHoleFillerCompletion(mockContextProvider, autocompleteInput, languageId, prefix, suffix)

		return { prefix, completion, suffix }
	}

	private async getFimCompletion(
		contextProvider: GhostContextProvider,
		autocompleteInput: ReturnType<typeof contextToAutocompleteInput>,
	): Promise<string> {
		const fimPromptBuilder = new FimPromptBuilder(contextProvider)
		const prompt = await fimPromptBuilder.getFimPrompts(autocompleteInput, this.model)
		const fimResponse = await this.llmClient.sendFimCompletion(prompt.formattedPrefix, prompt.prunedSuffix)
		return fimResponse.completion
	}

	private async getHoleFillerCompletion(
		contextProvider: GhostContextProvider,
		autocompleteInput: ReturnType<typeof contextToAutocompleteInput>,
		languageId: string,
		prefix: string,
		suffix: string,
	): Promise<string> {
		const holeFiller = new HoleFiller(contextProvider)
		const { systemPrompt, userPrompt } = await holeFiller.getPrompts(autocompleteInput, languageId)
		const response = await this.llmClient.sendPrompt(systemPrompt, userPrompt)
		const parseResult = parseGhostResponse(response.content, prefix, suffix)
		return parseResult.text
	}

	getName(): string {
		const supportsFim = modelSupportsFim(this.model)
		return supportsFim ? "ghost-provider-fim" : "ghost-provider-holefiller"
	}

	dispose(): void {
		// No resources to dispose
	}
}
