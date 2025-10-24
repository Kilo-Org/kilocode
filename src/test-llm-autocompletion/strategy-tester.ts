import { LLMClient } from "./llm-client.js"
import { AutoTriggerStrategy } from "../services/ghost/strategies/AutoTriggerStrategy.js"
import { GhostSuggestionContext, AutocompleteInput, GhostSuggestionEditOperation } from "../services/ghost/types.js"
import { MockTextDocument } from "../services/mocking/MockTextDocument.js"
import { CURSOR_MARKER } from "../services/ghost/ghostConstants.js"
import { GhostStreamingParser } from "../services/ghost/GhostStreamingParser.js"
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
			const parser = new GhostStreamingParser()
			const uri = vscode.Uri.parse("file:///test.js")

			const dummyContext: GhostSuggestionContext = {
				document: new MockTextDocument(uri, originalContent) as any,
				range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)) as any,
			}

			parser.initialize(dummyContext)
			const result = parser.parseResponse(xmlResponse, "", "")

			// Check if we have any suggestions
			if (!result.suggestions.hasSuggestions()) {
				return null
			}

			// Get the file operations
			const file = result.suggestions.getFile(uri)
			if (!file) {
				return null
			}

			// Get all operations and apply them
			const operations = file.getAllOperations()
			if (operations.length === 0) {
				return null
			}

			// Apply operations to reconstruct the modified code
			return this.applyOperations(originalContent, operations)
		} catch (error) {
			console.warn("Failed to parse completion:", error)
			return null
		}
	}

	/**
	 * Apply diff operations to reconstruct the modified code
	 * Operations use 0-based line numbers from the parser
	 */
	private applyOperations(originalContent: string, operations: GhostSuggestionEditOperation[]): string {
		const originalLines = originalContent.split("\n")

		// Sort operations by oldLine to process them in order
		const sortedOps = [...operations].sort((a, b) => {
			if (a.oldLine !== b.oldLine) {
				return a.oldLine - b.oldLine
			}
			// Deletions before additions on same line
			if (a.type === "-" && b.type === "+") return -1
			if (a.type === "+" && b.type === "-") return 1
			return 0
		})

		const finalLines: string[] = []
		let currentOriginalLine = 0

		for (const op of sortedOps) {
			// Add any unmodified lines before this operation
			while (currentOriginalLine < op.oldLine) {
				finalLines.push(originalLines[currentOriginalLine])
				currentOriginalLine++
			}

			if (op.type === "+") {
				// Addition: add the new content
				// Strip leading newlines to prevent extra blank lines
				const content = op.content.replace(/^\n+/, "")
				finalLines.push(content)
			} else if (op.type === "-") {
				// Deletion: skip the original line
				currentOriginalLine++
			}
		}

		// Add remaining original lines
		while (currentOriginalLine < originalLines.length) {
			finalLines.push(originalLines[currentOriginalLine])
			currentOriginalLine++
		}

		// Filter out undefined values that may occur from line number mismatches
		const validLines = finalLines.filter((line) => line !== undefined)
		const resultText = validLines.join("\n")

		// Remove leading/trailing newlines that may come from diff generation
		return resultText.replace(/^\n+/, "").replace(/\n+$/, "")
	}

	/**
	 * Get the type of the strategy (always auto-trigger now)
	 */
	getSelectedStrategyName(code: string): string {
		return "auto-trigger"
	}
}
