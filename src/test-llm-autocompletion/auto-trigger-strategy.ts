import { LLMClient } from "./llm-client.js"
import { AutoTriggerStrategy } from "../services/ghost/strategies/AutoTriggerStrategy.js"
import { GhostSuggestionContext } from "../services/ghost/types.js"
import { MockTextDocument } from "../services/mocking/MockTextDocument.js"
import { CURSOR_MARKER } from "../services/ghost/ghostConstants.js"
import { GhostStreamingParser } from "../services/ghost/GhostStreamingParser.js"
import * as vscode from "vscode"

export class AutoTriggerStrategyTester {
	private llmClient: LLMClient
	private strategy: AutoTriggerStrategy

	constructor(llmClient: LLMClient) {
		this.llmClient = llmClient
		this.strategy = new AutoTriggerStrategy()
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
			rangeASTNode: undefined,
		}
	}

	getSystemInstructions(): string {
		return this.strategy.getSystemInstructions()
	}

	buildUserPrompt(code: string): string {
		const context = this.createContext(code)
		return this.strategy.getUserPrompt(context)
	}

	async getCompletion(code: string): Promise<string> {
		const systemPrompt = this.getSystemInstructions()
		const userPrompt = this.buildUserPrompt(code)

		const response = await this.llmClient.sendPrompt(systemPrompt, userPrompt)
		return response.content
	}

	parseCompletion(xmlResponse: string): { search: string; replace: string }[] {
		const parser = new GhostStreamingParser()

		const dummyContext: GhostSuggestionContext = {
			document: new MockTextDocument(vscode.Uri.parse("file:///test.js"), "") as any,
			range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)) as any,
		}

		parser.initialize(dummyContext)
		parser.processChunk(xmlResponse)
		parser.finishStream()

		return parser.getCompletedChanges()
	}
}
