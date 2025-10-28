import { LLMClient } from "./llm-client.js"
import { AutoTriggerStrategy } from "../services/ghost/classic-auto-complete/AutoTriggerStrategy.js"
import { GhostSuggestionContext, AutocompleteInput, extractPrefixSuffix } from "../services/ghost/types.js"
import { MockTextDocument } from "../services/mocking/MockTextDocument.js"
import { CURSOR_MARKER } from "../services/ghost/classic-auto-complete/ghostConstants.js"
import { parseGhostResponse } from "../services/ghost/classic-auto-complete/GhostStreamingParser.js"
import * as vscode from "vscode"
import crypto from "crypto"

export class StrategyTester {
	private llmClient: LLMClient
	private autoTriggerStrategy: AutoTriggerStrategy

	constructor(llmClient: LLMClient) {
		this.llmClient = llmClient
		this.autoTriggerStrategy = new AutoTriggerStrategy()
	}

	/**
	 * Converts test input to GhostSuggestionContext
	 * Extracts cursor position from CURSOR_MARKER in the code
	 */
	private createContext(code: string): GhostSuggestionContext {
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

		const uri = vscode.Uri.parse("file:///test.js")
		const document = new MockTextDocument(uri, codeWithoutMarker)
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

	async getCompletion(code: string): Promise<string> {
		const context = this.createContext(code)

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

		const { systemPrompt, userPrompt } = this.autoTriggerStrategy.getPrompts(
			autocompleteInput,
			prefix,
			suffix,
			languageId,
		)

		const response = await this.llmClient.sendPrompt(systemPrompt, userPrompt)
		return response.content
	}

	parseCompletion(originalContent: string, xmlResponse: string): string | null {
		try {
			const uri = vscode.Uri.parse("file:///test.js")

			const dummyContext: GhostSuggestionContext = {
				document: new MockTextDocument(uri, originalContent) as any,
				range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)) as any,
			}

			const position = dummyContext.range?.start ?? new vscode.Position(0, 0)
			const { prefix, suffix } = extractPrefixSuffix(dummyContext.document, position)
			const result = parseGhostResponse(xmlResponse, prefix, suffix)

			// Check if we have any suggestions
			if (!result.suggestions.hasSuggestions()) {
				return null
			}

			throw new Error("Code needs to be ported to FIM style completion")

			// // Get the file operations
			// const file = result.suggestions.getFile(uri)
			// if (!file) {
			// 	return null
			// }

			// // Get all operations and apply them
			// const operations = file.getAllOperations()
			// if (operations.length === 0) {
			// 	return null
			// }

			// // Apply operations to reconstruct the modified code
			// return this.applyOperations(originalContent, operations)
		} catch (error) {
			console.warn("Failed to parse completion:", error)
			return null
		}
	}

	/**
	 * Get the type of the strategy (always auto-trigger now)
	 */
	getSelectedStrategyName(code: string): string {
		return "auto-trigger"
	}
}
