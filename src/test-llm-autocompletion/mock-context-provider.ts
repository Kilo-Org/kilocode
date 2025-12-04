import { GhostContextProvider } from "../services/ghost/classic-auto-complete/GhostContextProvider.js"

/**
 * Creates a mock context provider for standalone testing.
 * This provides minimal context without requiring a full VS Code environment.
 */
export function createMockContextProvider(prefix: string, suffix: string, filepath: string): GhostContextProvider {
	return {
		getProcessedSnippets: async () => ({
			filepathUri: `file://${filepath}`,
			helper: {
				filepath: `file://${filepath}`,
				lang: { name: "typescript", singleLineComment: "//" },
				prunedPrefix: prefix,
				prunedSuffix: suffix,
			},
			snippetsWithUris: [],
			workspaceDirs: [],
		}),
	} as unknown as GhostContextProvider
}
