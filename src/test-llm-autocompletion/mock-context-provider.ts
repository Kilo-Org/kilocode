import { GhostContextProvider } from "../services/ghost/types.js"

/**
 * Creates a mock context provider for standalone testing.
 * This provides minimal context without requiring a full VS Code environment.
 *
 * Note: This mock bypasses the real context retrieval and returns pre-computed
 * prefix/suffix values. The contextService, ide, and model are mocked to provide
 * the expected data structure.
 */
export function createMockContextProvider(
	prefix: string,
	suffix: string,
	filepath: string,
): { contextProvider: GhostContextProvider; mockHelper: any } {
	// Create a mock helper that will be returned by getProcessedSnippets
	const mockHelper = {
		filepath: `file://${filepath}`,
		lang: { name: "typescript", singleLineComment: "//" },
		prunedPrefix: prefix,
		prunedSuffix: suffix,
	}

	// Create mock services that satisfy the GhostContextProvider interface
	const mockContextService = {
		initializeForFile: async () => {},
	} as any

	const mockIde = {
		getWorkspaceDirs: async () => [],
	} as any

	const mockModel = {
		getModelName: () => "test-model",
		supportsFim: () => false,
	} as any

	const contextProvider: GhostContextProvider = {
		contextService: mockContextService,
		ide: mockIde,
		model: mockModel,
		ignoreController: undefined,
	}

	return { contextProvider, mockHelper }
}
