import { expect } from "vitest"
import { MockLLM } from "../../../llm/llms/Mock"
import { testIde } from "../../../test/fixtures"
import { joinPathsToUri } from "../../../util/uri"
import { CompletionProvider } from "../../CompletionProvider"
import { MinimalConfigProvider } from "../../MinimalConfig"
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
	const { prefix } = parseFimExample(test.input)

	// Setup necessary objects
	const llm = new MockLLM({
		model: "mock",
	})
	llm.completion = test.llmOutput
	const ide = testIde
	const configHandler = new MinimalConfigProvider({
		tabAutocompleteOptions: {
			disable: false,
			maxPromptTokens: 1024,
			debounceDelay: 0,
			// Avoid flakiness under load from timeout-based partial completions.
			modelTimeout: 20_000,
			maxSuffixPercentage: 0.15,
			prefixPercentage: 0.75,
			maxSnippetPercentage: 0.1,
			multilineCompletions: "auto",
			slidingWindowPrefixPercentage: 0.75,
			slidingWindowSize: 50,
			// Avoid cross-test interference via the shared autocomplete cache.
			useCache: false,
			onlyMyCode: false,
			useRecentlyEdited: false,
			useRecentlyOpened: false,
			useImports: false,
			experimental_includeClipboard: false,
			experimental_includeRecentlyVisitedRanges: false,
			experimental_includeRecentlyEditedRanges: false,
			experimental_includeDiff: false,
			experimental_enableStaticContextualization: false,
		},
	})

	// Create a real file
	const [workspaceDir] = await ide.getWorkspaceDirs()
	const fileUri = joinPathsToUri(workspaceDir, test.filename)
	await ide.writeFile(fileUri, test.input.replace(FIM_DELIMITER, ""))

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
