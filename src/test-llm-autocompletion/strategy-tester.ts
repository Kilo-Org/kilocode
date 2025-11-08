import { LLMClient } from "./llm-client.js"
import { HoleFiller, parseGhostResponse } from "../services/ghost/classic-auto-complete/HoleFiller.js"
import { GhostSuggestionContext, AutocompleteInput } from "../services/ghost/types.js"
import { MockTextDocument } from "../services/mocking/MockTextDocument.js"
import * as vscode from "vscode"
import crypto from "crypto"
import { CURSOR_MARKER } from "./test-cases.js"

export class StrategyTester {
	private llmClient: LLMClient
	private holeFiller: HoleFiller

	constructor(llmClient: LLMClient) {
		this.llmClient = llmClient
		this.holeFiller = new HoleFiller()
	}

	/**
	 * Converts test input to GhostSuggestionContext
	 * Extracts cursor position from CURSOR_MARKER in the code
	 */
	private createContext(code: string, testCaseName: string): GhostSuggestionContext {
		const lines = code.split("\n")
		let cursorLine = 0
		let cursorCharacter = 0

		// Find the cursor marker
		for (let i = 0; i < lines.length; i++) {
			const markerIndex = lines[i].indexOf(CURSOR_MARKER)
			if (markerIndex !== -1) {
				cursorLine = i
				cursorCharacter = markerIndex
				break
			}
		}

		// Remove the cursor marker from the code before creating the document
		// the code will add it back at the correct position
		const codeWithoutMarker = code.replace(CURSOR_MARKER, "")

		// Extract language from test case name (e.g., "class-constructor.rb" -> ".rb")
		const fileExtension = this.getFileExtensionFromTestName(testCaseName)
		const languageId = this.getLanguageIdFromExtension(fileExtension)

		const uri = vscode.Uri.parse(`file:///test${fileExtension}`)
		const document = new MockTextDocument(uri, codeWithoutMarker)
		document.languageId = languageId
		const position = new vscode.Position(cursorLine, cursorCharacter)
		const range = new vscode.Range(position, position)

		return {
			document: document as any,
			range: range as any,
			recentOperations: [],
			diagnostics: [],
			openFiles: [],
			userInput: undefined,
		}
	}

	/**
	 * Extract file extension from test case name
	 * e.g., "class-constructor.rb" -> ".rb"
	 * e.g., "class-constructor" -> ".js"
	 */
	private getFileExtensionFromTestName(testCaseName: string): string {
		const match = testCaseName.match(/\.([a-z]+)$/i)
		return match ? `.${match[1]}` : ".js"
	}

	/**
	 * Map file extension to VSCode languageId
	 */
	private getLanguageIdFromExtension(extension: string): string {
		const languageMap: Record<string, string> = {
			".js": "javascript",
			".ts": "typescript",
			".jsx": "javascriptreact",
			".tsx": "typescriptreact",
			".py": "python",
			".rb": "ruby",
			".java": "java",
			".go": "go",
			".rs": "rust",
			".cpp": "cpp",
			".c": "c",
			".cs": "csharp",
			".php": "php",
			".swift": "swift",
			".kt": "kotlin",
			".scala": "scala",
			".html": "html",
			".css": "css",
			".json": "json",
			".xml": "xml",
			".yaml": "yaml",
			".yml": "yaml",
			".md": "markdown",
			".sh": "shellscript",
		}
		return languageMap[extension] || "javascript"
	}

	async getCompletion(
		code: string,
		testCaseName: string = "test",
	): Promise<{ prefix: string; completion: string; suffix: string }> {
		const context = this.createContext(code, testCaseName)

		// Extract prefix, suffix, and languageId
		const position = context.range?.start ?? new vscode.Position(0, 0)
		const offset = context.document.offsetAt(position)
		const text = context.document.getText()
		const prefix = text.substring(0, offset)
		const suffix = text.substring(offset)
		const languageId = context.document.languageId || "javascript"

		// Create AutocompleteInput
		const autocompleteInput: AutocompleteInput = {
			isUntitledFile: false,
			completionId: crypto.randomUUID(),
			filepath: context.document.uri.fsPath,
			pos: { line: position.line, character: position.character },
			recentlyVisitedRanges: [],
			recentlyEditedRanges: [],
		}

		const { systemPrompt, userPrompt } = this.holeFiller.getPrompts(autocompleteInput, prefix, suffix, languageId)

		const response = await this.llmClient.sendPrompt(systemPrompt, userPrompt)

		// Parse the response to extract the completion from XML tags
		const parseResult = parseGhostResponse(response.content, prefix, suffix)

		// Use parsed completion text directly
		const completion = parseResult.text

		return {
			prefix,
			completion,
			suffix,
		}
	}

	/**
	 * Get the type of the strategy (always auto-trigger now)
	 */
	getSelectedStrategyName(): string {
		return "auto-trigger"
	}
}
