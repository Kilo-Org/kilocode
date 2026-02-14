// kilocode_change - new file
import * as vscode from "vscode"
import { z } from "zod"
import { AutocompleteServiceManager } from "./AutocompleteServiceManager"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { getKiloCodeWrapperProperties } from "../../core/kilocode/wrapper"
import { languageForFilepath } from "./continuedev/core/autocomplete/constants/AutocompleteLanguageInfo"
import { AutocompleteContextProvider } from "./types"
import { FimPromptBuilder } from "./classic-auto-complete/FillInTheMiddle"
import { HoleFiller } from "./classic-auto-complete/HoleFiller"
import { MockTextDocument } from "../mocking/MockTextDocument"

const GET_INLINE_COMPLETIONS_COMMAND = "kilo-code.jetbrains.getInlineCompletions"

// Zod schemas for validation
const PositionSchema = z.object({
	line: z.number().int().nonnegative(),
	character: z.number().int().nonnegative(),
})

const InlineCompletionArgsSchema = z.tuple([
	z.union([z.string(), z.any()]).transform((val) => String(val)), // documentUri - coerce to string
	z.union([PositionSchema, z.any()]), // position (can be object or any)
	z.union([z.string(), z.any()]).transform((val) => String(val)), // fileContent - coerce to string
	z.union([z.string(), z.any()]).transform((val) => String(val)), // languageId - coerce to string
	z.union([z.string(), z.any()]).transform((val) => String(val)), // requestId - coerce to string
])

type InlineCompletionArgs = z.infer<typeof InlineCompletionArgsSchema>

interface DocumentParams {
	uri: string
	position: { line: number; character: number }
	content: string
	languageId: string
	requestId: string
}

interface NormalizedContent {
	normalizedContent: string
	lines: string[]
}

interface CompletionResult {
	requestId: string
	items: Array<{
		insertText: string
		range: {
			start: { line: number; character: number }
			end: { line: number; character: number }
		} | null
	}>
	error: string | null
}

export class AutocompleteJetbrainsBridge {
	private autocomplete: AutocompleteServiceManager

	constructor(autocomplete: AutocompleteServiceManager) {
		this.autocomplete = autocomplete
	}

	private determineLanguage(langId: string, uri: string): string {
		// If we have a valid language ID that's not generic, use it
		if (langId && langId !== "text" && langId !== "textmate") {
			return langId
		}

		// Use the languageForFilepath function to get language info from file extension
		const languageInfo = languageForFilepath(uri)
		const languageName = languageInfo.name.toLowerCase()

		// Map language names to VSCode language IDs
		const languageIdMap: { [key: string]: string } = {
			typescript: "typescript",
			javascript: "javascript",
			python: "python",
			java: "java",
			"c++": "cpp",
			"c#": "csharp",
			c: "c",
			scala: "scala",
			go: "go",
			rust: "rust",
			haskell: "haskell",
			php: "php",
			ruby: "ruby",
			"ruby on rails": "ruby",
			swift: "swift",
			kotlin: "kotlin",
			clojure: "clojure",
			julia: "julia",
			"f#": "fsharp",
			r: "r",
			dart: "dart",
			solidity: "solidity",
			yaml: "yaml",
			json: "json",
			markdown: "markdown",
			lua: "lua",
		}

		return languageIdMap[languageName] || languageName
	}

	/**
	 * Parse and validate the RPC arguments using Zod schemas
	 */
	private parseAndValidateArgs(...args: any[]): DocumentParams {
		// RPC passes all arguments as a single array in args[0]
		const argsArray = Array.isArray(args[0]) ? args[0] : args

		// Parse with Zod schema
		const parsed = InlineCompletionArgsSchema.parse(argsArray)
		const [documentUri, position, fileContent, languageId, requestId] = parsed

		// Safely extract and normalize parameters
		const uri = typeof documentUri === "string" ? documentUri : String(documentUri)
		const pos =
			typeof position === "object" && position !== null && "line" in position && "character" in position
				? { line: position.line, character: position.character }
				: { line: 0, character: 0 }
		const content = typeof fileContent === "string" ? fileContent : String(fileContent)
		const langId = typeof languageId === "string" ? languageId : String(languageId || "")
		const reqId = typeof requestId === "string" ? requestId : String(requestId || "")

		return {
			uri,
			position: pos,
			content,
			languageId: langId,
			requestId: reqId,
		}
	}

	/**
	 * Normalize content line endings to LF for consistent processing
	 * JetBrains may send content with different line endings
	 */
	private normalizeContent(content: string): NormalizedContent {
		const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
		const lines = normalizedContent.split("\n")

		return {
			normalizedContent,
			lines,
		}
	}

	/**
	 * Create a mock VSCode TextDocument from the provided parameters
	 */
	private createMockDocument(uri: string, normalizedContent: string, language: string): vscode.TextDocument {
		const mockDocument = new MockTextDocument(vscode.Uri.parse(uri), normalizedContent)
		mockDocument.languageId = language
		mockDocument.fileName = uri
		return mockDocument
	}

	/**
	 * Create a mock context provider that prevents workspace file access.
	 * This is used for JetBrains bridge to ensure only the provided document content is used.
	 */
	private createMockContextProvider(normalizedContent: string): AutocompleteContextProvider {
		// Access the model through the inline completion provider which has access to it
		const provider = this.autocomplete.inlineCompletionProvider as any
		const model = provider.model

		return {
			ide: {
				readFile: async () => normalizedContent,
				getWorkspaceDirs: async () => [],
				getClipboardContent: async () => ({ text: "", copiedAt: new Date().toISOString() }),
			},
			contextService: {
				initializeForFile: async () => {},
				getRootPathSnippets: async () => [],
				getSnippetsFromImportDefinitions: async () => [],
				getStaticContextSnippets: async () => [],
			},
			model,
			ignoreController: undefined,
		} as unknown as AutocompleteContextProvider
	}

	/**
	 * Serialize completion results to a format suitable for RPC response
	 */
	private serializeCompletionResult(
		completions: vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined,
		requestId: string,
	): CompletionResult {
		const items = Array.isArray(completions) ? completions : completions?.items || []

		return {
			requestId,
			items: items.map((item) => ({
				insertText: typeof item.insertText === "string" ? item.insertText : item.insertText.value,
				range: item.range
					? {
							start: {
								line: item.range.start.line,
								character: item.range.start.character,
							},
							end: { line: item.range.end.line, character: item.range.end.character },
						}
					: null,
			})),
			error: null,
		}
	}

	public async getInlineCompletions(...args: any[]): Promise<CompletionResult> {
		try {
			// Parse and validate arguments
			const params = this.parseAndValidateArgs(...args)

			// Normalize content
			const { normalizedContent, lines } = this.normalizeContent(params.content)

			// Determine language from languageId or file extension
			const language = this.determineLanguage(params.languageId, params.uri)

			// Create mock document
			const mockDocument = this.createMockDocument(params.uri, normalizedContent, language)

			// Create VSCode position and context
			const vscodePosition = new vscode.Position(params.position.line, params.position.character)
			const context: vscode.InlineCompletionContext = {
				triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
				selectedCompletionInfo: undefined,
			}
			const tokenSource = new vscode.CancellationTokenSource()

			// Create mock context provider to prevent workspace file access
			const mockContextProvider = this.createMockContextProvider(normalizedContent)

			// Save original builders
			const originalFimBuilder = this.autocomplete.inlineCompletionProvider.fimPromptBuilder
			const originalHoleFiller = this.autocomplete.inlineCompletionProvider.holeFiller

			try {
				// Temporarily replace builders with ones using mock context
				this.autocomplete.inlineCompletionProvider.fimPromptBuilder = new FimPromptBuilder(mockContextProvider)
				this.autocomplete.inlineCompletionProvider.holeFiller = new HoleFiller(mockContextProvider)

				// Get completions from the provider (will use mock builders internally)
				const completions = await this.autocomplete.inlineCompletionProvider.provideInlineCompletionItems(
					mockDocument,
					vscodePosition,
					context,
					tokenSource.token,
				)

				// Serialize and return the result
				return this.serializeCompletionResult(completions, params.requestId)
			} finally {
				// Always restore original builders
				this.autocomplete.inlineCompletionProvider.fimPromptBuilder = originalFimBuilder
				this.autocomplete.inlineCompletionProvider.holeFiller = originalHoleFiller
				tokenSource.dispose()
			}
		} catch (error) {
			return {
				requestId: "",
				items: [],
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}
}

export const registerAutocompleteJetbrainsBridge = (
	context: vscode.ExtensionContext,
	_cline: ClineProvider,
	autocomplete: AutocompleteServiceManager,
) => {
	// Check if we are running inside JetBrains IDE
	const { kiloCodeWrapped, kiloCodeWrapperJetbrains } = getKiloCodeWrapperProperties()
	if (!kiloCodeWrapped || !kiloCodeWrapperJetbrains) {
		return
	}

	// Initialize the JetBrains Bridge
	const bridge = new AutocompleteJetbrainsBridge(autocomplete)

	// Register JetBrains inline completion command
	context.subscriptions.push(
		vscode.commands.registerCommand(GET_INLINE_COMPLETIONS_COMMAND, bridge.getInlineCompletions.bind(bridge)),
	)
}
