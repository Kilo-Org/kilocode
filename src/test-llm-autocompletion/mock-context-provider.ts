import { GhostContextProvider } from "../services/ghost/types.js"

/**
 * Check if a model supports FIM (Fill-In-Middle) completions.
 * This mirrors the logic in KilocodeOpenrouterHandler.supportsFim()
 */
export function modelSupportsFim(modelId: string): boolean {
	return modelId.includes("codestral")
}

/**
 * Create a mock GhostContextProvider for standalone testing.
 * This provider simulates the context retrieval without requiring VSCode services.
 */
export function createMockContextProvider(prefix: string, suffix: string, filepath: string): GhostContextProvider {
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
			getStaticContextSnippets: async () => [],
		},
		model: {
			supportsFim: () => modelSupportsFim(process.env.LLM_MODEL || "mistralai/codestral-2508"),
			getModelName: () => process.env.LLM_MODEL || "mistralai/codestral-2508",
		},
	} as unknown as GhostContextProvider
}
