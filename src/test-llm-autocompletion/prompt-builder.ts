import {
	HoleFiller,
	HoleFillerGhostPrompt,
	ProcessedSnippetsResult,
} from "../services/ghost/classic-auto-complete/HoleFiller.js"
import { FimPromptBuilder, FimGhostPrompt } from "../services/ghost/classic-auto-complete/FillInTheMiddle.js"
import { AutocompleteInput } from "../services/ghost/types.js"
import { HelperVars } from "../services/continuedev/core/autocomplete/util/HelperVars.js"
import { Typescript } from "../services/continuedev/core/autocomplete/constants/AutocompleteLanguageInfo.js"
import { DEFAULT_AUTOCOMPLETE_OPTS } from "../services/continuedev/core/util/parameters.js"

/**
 * Creates a mock ProcessedSnippetsResult for testing.
 * This provides minimal context without requiring a full VS Code environment.
 */
export function createMockSnippetsResult(
	prefix: string,
	suffix: string,
	filepath: string,
	autocompleteInput: AutocompleteInput,
): ProcessedSnippetsResult {
	const filepathUri = filepath.startsWith("file://") ? filepath : `file://${filepath}`

	// Create a mock HelperVars that satisfies the interface
	const mockHelper: HelperVars = {
		lang: Typescript, // Use the TypeScript language info which has all required fields
		treePath: undefined,
		workspaceUris: [],
		fileContents: prefix + suffix,
		fileLines: (prefix + suffix).split("\n"),
		fullPrefix: prefix,
		fullSuffix: suffix,
		prunedPrefix: prefix,
		prunedSuffix: suffix,
		input: autocompleteInput,
		options: DEFAULT_AUTOCOMPLETE_OPTS,
		modelName: "test-model",
		filepath: filepathUri,
		pos: autocompleteInput.pos,
		prunedCaretWindow: prefix + suffix,
	}

	return {
		filepathUri,
		helper: mockHelper,
		snippetsWithUris: [],
		workspaceDirs: [],
	}
}

/**
 * Build prompts for both FIM and HoleFiller strategies.
 * Uses the production HoleFiller and FimPromptBuilder classes with mock data.
 */
export function buildTestPrompts(
	prefix: string,
	suffix: string,
	languageId: string,
	autocompleteInput: AutocompleteInput,
	modelName: string,
): { fim: FimGhostPrompt; holeFiller: HoleFillerGhostPrompt } {
	const snippetsResult = createMockSnippetsResult(prefix, suffix, autocompleteInput.filepath, autocompleteInput)

	const holeFiller = new HoleFiller()
	const fimPromptBuilder = new FimPromptBuilder()

	return {
		fim: fimPromptBuilder.getFimPrompts(snippetsResult, autocompleteInput, modelName),
		holeFiller: holeFiller.getPrompts(snippetsResult, autocompleteInput, languageId),
	}
}
