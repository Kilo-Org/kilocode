import { expect } from "vitest"
import { MockLLM } from "../../../llm/llms/Mock"
import { testMinimalConfigProvider, testIde } from "../../../test/fixtures"
import { joinPathsToUri } from "../../../util/uri"
import { CompletionProvider } from "../../CompletionProvider"
import { AutocompleteInput } from "../../util/types"

const FIM_DELIMITER = "<|fim|>"

function parseFimExample(text: string): { prefix: string; suffix: string } {
	const [prefix, suffix] = text.split(FIM_DELIMITER)
	return { prefix, suffix }
}

export interface AutocompleteFileringTestInput {
	description: string
	filename: string
	input: string
	llmOutput: string
	expectedCompletion: string | null | undefined
	options?: {
		only?: boolean
	}
}

export async function testAutocompleteFiltering(test: AutocompleteFileringTestInput) {
	// Normalize line endings to LF for cross-platform compatibility (Windows Git may check out CRLF)
	const normalizedInput = test.input.replace(/\r\n/g, "\n")
	const normalizedLlmOutput = test.llmOutput.replace(/\r\n/g, "\n")

	const { prefix } = parseFimExample(normalizedInput)

	// Setup necessary objects
	const llm = new MockLLM({
		model: "mock",
	})
	llm.completion = normalizedLlmOutput
	const ide = testIde
	const configHandler = testMinimalConfigProvider

	// Create a real file
	const [workspaceDir] = await ide.getWorkspaceDirs()
	const fileUri = joinPathsToUri(workspaceDir, test.filename)
	await ide.writeFile(fileUri, normalizedInput.replace(FIM_DELIMITER, ""))

	// Prepare completion input and provider
	const completionProvider = new CompletionProvider(
		configHandler,
		ide,
		async () => llm,
		() => {},
		async () => [],
	)

	const line = prefix.split("\n").length - 1
	const character = prefix.split("\n")[line].length
	const autocompleteInput: AutocompleteInput = {
		isUntitledFile: false,
		completionId: "test-completion-id",
		filepath: fileUri,
		pos: {
			line,
			character,
		},
		recentlyEditedRanges: [],
		recentlyVisitedRanges: [],
	}

	// Generate a completion
	const result = await completionProvider.provideInlineCompletionItems(
		autocompleteInput,
		undefined,
		true, // force=true to skip debounce in tests
	)

	// Ensure that we return the text that is wanted to be displayed
	// Normalize line endings for cross-platform compatibility
	const normalizeLineEndings = (str: string | null | undefined) => str?.replace(/\r\n/g, "\n")

	expect(normalizeLineEndings(result?.completion)).toEqual(normalizeLineEndings(test.expectedCompletion))
}
