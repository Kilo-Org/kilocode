import { AutocompleteInput } from "../types"
import { HelperVars } from "../../continuedev/core/autocomplete/util/HelperVars"
import { AutocompleteSnippet } from "../../continuedev/core/autocomplete/snippets/types"

/**
 * Interface for context providers that supply code context for autocompletion.
 * This abstraction allows both VSCode-based and mock implementations for testing.
 */
export interface IContextProvider {
	/**
	 * Get processed code snippets and context for autocompletion
	 * @param autocompleteInput - The autocomplete request input
	 * @param filepath - The file path being edited
	 * @returns Processed snippets with helper variables and workspace information
	 */
	getProcessedSnippets(
		autocompleteInput: AutocompleteInput,
		filepath: string,
	): Promise<{
		filepathUri: string
		helper: HelperVars
		snippetsWithUris: AutocompleteSnippet[]
		workspaceDirs: string[]
	}>
}
