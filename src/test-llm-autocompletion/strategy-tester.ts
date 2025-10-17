import { LLMClient } from "./llm-client.js"
import { AutoTriggerStrategy } from "../services/ghost/strategies/AutoTriggerStrategy.js"
import {
	GhostSuggestionContext,
	contextToAutocompleteInput,
	extractPrefixSuffix,
	AutocompleteInput,
} from "../services/ghost/types.js"
import { MockTextDocument } from "../services/mocking/MockTextDocument.js"
import { CURSOR_MARKER } from "../services/ghost/ghostConstants.js"
import { GhostStreamingParser } from "../services/ghost/GhostStreamingParser.js"
import * as vscode from "vscode"

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
		// formatDocumentWithCursor will add it back at the correct position
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
		const input = contextToAutocompleteInput(context)
		const { prefix, suffix } = extractPrefixSuffix(
			context.document,
			context.range?.start ?? context.document.positionAt(0),
		)
		const { systemPrompt, userPrompt } = this.autoTriggerStrategy.getPrompts(
			input,
			prefix,
			suffix,
			context.document.languageId,
		)

		const response = await this.llmClient.sendPrompt(systemPrompt, userPrompt)
		return response.content
	}

	parseCompletion(xmlResponse: string): { search: string; replace: string }[] {
		const parser = new GhostStreamingParser()

		const dummyInput: AutocompleteInput = {
			isUntitledFile: false,
			completionId: "dummy-id",
			filepath: "/test.js",
			pos: { line: 0, character: 0 },
			recentlyVisitedRanges: [],
			recentlyEditedRanges: [],
		}

		parser.initialize(dummyInput, "", "")
		parser.processChunk(xmlResponse)
		parser.finishStream()

		return parser.getCompletedChanges()
	}

	/**
	 * Get the type of the strategy (always auto-trigger now)
	 */
	getSelectedStrategyName(code: string): string {
		return "auto-trigger"
	}
}
