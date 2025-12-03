import { CompletionEngine } from "../services/ghost/classic-auto-complete/CompletionEngine.js"
import { GhostModel } from "../services/ghost/GhostModel.js"
import { MockContextProvider } from "./mock-context-provider.js"
import { AutocompleteInput } from "../services/ghost/types.js"
import * as vscode from "vscode"
import crypto from "crypto"
import { createContext } from "./utils.js"
import { KilocodeOpenrouterHandler } from "../api/providers/kilocode-openrouter.js"

/**
 * Tester that uses CompletionEngine to test autocompletion through the same code path
 * as the real GhostInlineCompletionProvider, but without VSCode dependencies.
 */
export class CompletionEngineTester {
	private model: GhostModel

	constructor() {
		// Create GhostModel with KilocodeOpenrouterHandler
		const apiHandler = new KilocodeOpenrouterHandler({
			kilocodeToken: process.env.KILOCODE_API_KEY,
			kilocodeModel: process.env.LLM_MODEL || "mistralai/codestral-2508",
		})
		this.model = new GhostModel(apiHandler)
	}

	async getCompletion(
		code: string,
		testCaseName: string = "test",
	): Promise<{ prefix: string; completion: string; suffix: string }> {
		const context = createContext(code, testCaseName)

		const position = context.range?.start ?? new vscode.Position(0, 0)
		const offset = context.document.offsetAt(position)
		const text = context.document.getText()
		const prefix = text.substring(0, offset)
		const suffix = text.substring(offset)
		const languageId = context.document.languageId || "javascript"
		const filepath = context.document.uri.fsPath

		// Create mock context provider
		const mockContextProvider = new MockContextProvider(prefix, suffix, filepath, languageId)

		// Create completion engine
		const engine = new CompletionEngine(mockContextProvider)

		// Create autocomplete input
		const autocompleteInput: AutocompleteInput = {
			isUntitledFile: false,
			completionId: crypto.randomUUID(),
			filepath,
			pos: { line: position.line, character: position.character },
			recentlyVisitedRanges: [],
			recentlyEditedRanges: [],
		}

		// Get completion
		const result = await engine.getCompletion(this.model, autocompleteInput, languageId, prefix, suffix)

		return {
			prefix,
			completion: result.suggestion.text,
			suffix,
		}
	}

	getName(): string {
		return "completion-engine"
	}
}
