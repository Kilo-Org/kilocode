import { GhostContextProvider } from "../services/ghost/types.js"
import { GhostModel } from "../services/ghost/GhostModel.js"
import { LLMClient } from "./llm-client.js"
import {
	GhostInlineCompletionProvider,
	CostTrackingCallback,
} from "../services/ghost/classic-auto-complete/GhostInlineCompletionProvider.js"
import { HoleFiller } from "../services/ghost/classic-auto-complete/HoleFiller.js"
import { FimPromptBuilder } from "../services/ghost/classic-auto-complete/FillInTheMiddle.js"
import type { GhostServiceSettings } from "@roo-code/types"
import {
	AutocompleteSnippetType,
	type AutocompleteCodeSnippet,
	type AutocompleteStaticSnippet,
} from "../services/ghost/continuedev/core/autocomplete/types.js"
import type { RecentlyEditedRange } from "../services/ghost/continuedev/core/autocomplete/util/types.js"
import type { ContextFile } from "./test-cases.js"

/**
 * Check if a model supports FIM (Fill-In-Middle) completions.
 * This mirrors the logic in KilocodeOpenrouterHandler.supportsFim()
 */
export function modelSupportsFim(modelId: string): boolean {
	return modelId.includes("codestral")
}

export function createTestGhostModel(llmClient: LLMClient, modelId: string): GhostModel {
	const supportsFim = modelSupportsFim(modelId)

	// Create a mock GhostModel that delegates to LLMClient
	const mockModel = {
		loaded: true,
		profileName: "test-profile",
		profileType: "autocomplete",

		supportsFim: () => supportsFim,
		getModelName: () => modelId,
		getProviderDisplayName: () => "kilocode",
		hasValidCredentials: () => true,
		getRolloutHash_IfLoggedInToKilo: () => undefined,

		generateFimResponse: async (
			prefix: string,
			suffix: string,
			onChunk: (text: string) => void,
			_taskId?: string,
		) => {
			const response = await llmClient.sendFimCompletion(prefix, suffix)
			onChunk(response.completion)
			return {
				cost: 0,
				inputTokens: response.tokensUsed ?? 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			}
		},

		generateResponse: async (
			systemPrompt: string,
			userPrompt: string,
			onChunk: (chunk: { type: string; text?: string }) => void,
		) => {
			const response = await llmClient.sendPrompt(systemPrompt, userPrompt)
			onChunk({ type: "text", text: response.content })
			return {
				cost: 0,
				inputTokens: response.tokensUsed ?? 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			}
		},

		reload: async () => true,
		dispose: () => {},
	} as unknown as GhostModel

	return mockModel
}

export function createMockContextProvider(
	prefix: string,
	suffix: string,
	filepath: string,
	ghostModel: GhostModel,
	contextFiles: ContextFile[] = [],
): GhostContextProvider {
	// Convert context files to AutocompleteStaticSnippet format
	const staticSnippets: AutocompleteStaticSnippet[] = contextFiles.map((file) => ({
		type: AutocompleteSnippetType.Static,
		filepath: file.filepath,
		content: file.content,
	}))

	return {
		ide: {
			readFile: async () => prefix + suffix,
			getWorkspaceDirs: async () => [],
			getClipboardContent: async () => ({ text: "", copiedAt: new Date().toISOString() }),
		},
		contextService: {
			initializeForFile: async () => {},
			getRootPathSnippets: async () => [],
			getSnippetsFromImportDefinitions: async () => [],
			getStaticContextSnippets: async () => staticSnippets,
		},
		model: ghostModel,
	} as unknown as GhostContextProvider
}

export class StubRecentlyVisitedRangesService {
	public getSnippets(): AutocompleteCodeSnippet[] {
		return []
	}

	public dispose(): void {}
}

export class StubRecentlyEditedTracker {
	public async getRecentlyEditedRanges(): Promise<RecentlyEditedRange[]> {
		return []
	}

	public dispose(): void {}
}

export function createProviderForTesting(
	contextProvider: GhostContextProvider,
	costTrackingCallback: CostTrackingCallback = () => {},
	getSettings: () => GhostServiceSettings | null = () => null,
): GhostInlineCompletionProvider {
	const instance = Object.create(GhostInlineCompletionProvider.prototype) as GhostInlineCompletionProvider
	// Initialize private fields using Object.assign to bypass TypeScript private access
	Object.assign(instance, {
		suggestionsHistory: [],
		pendingRequests: [],
		model: contextProvider.model,
		costTrackingCallback,
		getSettings,
		holeFiller: new HoleFiller(contextProvider),
		fimPromptBuilder: new FimPromptBuilder(contextProvider),
		recentlyVisitedRangesService: new StubRecentlyVisitedRangesService(),
		recentlyEditedTracker: new StubRecentlyEditedTracker(),
		debounceTimer: null,
		isFirstCall: true,
		ignoreController: contextProvider.ignoreController,
		acceptedCommand: null,
		debounceDelayMs: 300, // INITIAL_DEBOUNCE_DELAY_MS
		latencyHistory: [],
	})
	return instance
}
