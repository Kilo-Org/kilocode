import { IContextProvider } from "../services/ghost/classic-auto-complete/IContextProvider.js"
import { AutocompleteInput } from "../services/ghost/types.js"
import { HelperVars } from "../services/continuedev/core/autocomplete/util/HelperVars.js"
import { AutocompleteSnippet } from "../services/continuedev/core/autocomplete/snippets/types.js"

/**
 * Mock context provider for standalone testing without VSCode dependencies.
 * Provides minimal context with just prefix/suffix and no additional snippets.
 */
export class MockContextProvider implements IContextProvider {
	constructor(
		private prefix: string,
		private suffix: string,
		private filepath: string,
		private languageId: string = "typescript",
	) {}

	async getProcessedSnippets(
		autocompleteInput: AutocompleteInput,
		filepath: string,
	): Promise<{
		filepathUri: string
		helper: HelperVars
		snippetsWithUris: AutocompleteSnippet[]
		workspaceDirs: string[]
	}> {
		const filepathUri = filepath.startsWith("file://") ? filepath : `file://${filepath}`

		// Create a minimal HelperVars-like object with the required properties
		const helper = {
			filepath: filepathUri,
			lang: {
				name: this.languageId,
				singleLineComment: this.languageId === "python" ? "#" : "//",
			},
			prunedPrefix: this.prefix,
			prunedSuffix: this.suffix,
		} as any

		return {
			filepathUri,
			helper,
			snippetsWithUris: [],
			workspaceDirs: [],
		}
	}
}
