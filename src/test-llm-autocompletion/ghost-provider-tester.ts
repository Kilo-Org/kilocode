import { HoleFiller, FillInAtCursorSuggestion } from "../services/ghost/classic-auto-complete/HoleFiller.js"
import { FimPromptBuilder } from "../services/ghost/classic-auto-complete/FillInTheMiddle.js"
import { AutocompleteInput } from "../services/ghost/types.js"
import * as vscode from "vscode"
import crypto from "crypto"
import { createContext } from "./utils.js"
import { TestGhostModel } from "./test-ghost-model.js"
import { createMockContextProvider } from "./mock-context-provider.js"

export class GhostProviderTester {
	private model: TestGhostModel

	constructor() {
		this.model = new TestGhostModel()
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

		// Common setup
		const mockContextProvider = createMockContextProvider(prefix, suffix, filepath)
		const autocompleteInput: AutocompleteInput = {
			isUntitledFile: false,
			completionId: crypto.randomUUID(),
			filepath,
			pos: { line: position.line, character: position.character },
			recentlyVisitedRanges: [],
			recentlyEditedRanges: [],
		}

		// Create prompt builders using production code
		const holeFiller = new HoleFiller(mockContextProvider)
		const fimPromptBuilder = new FimPromptBuilder(mockContextProvider)

		// Simple processSuggestion that just wraps the text
		const processSuggestion = (text: string): FillInAtCursorSuggestion => ({
			text,
			prefix,
			suffix,
		})

		// Use production code to determine strategy and get completion
		let completion: string
		if (this.model.supportsFim()) {
			const prompt = await fimPromptBuilder.getFimPrompts(autocompleteInput, this.model.getModelName() ?? "")
			const result = await fimPromptBuilder.getFromFIM(this.model, prompt, processSuggestion)
			completion = result.suggestion.text
		} else {
			const prompt = await holeFiller.getPrompts(autocompleteInput, languageId)
			const result = await holeFiller.getFromChat(this.model, prompt, processSuggestion)
			completion = result.suggestion.text
		}

		return { prefix, completion, suffix }
	}

	getName(): string {
		return this.model.supportsFim() ? "ghost-provider-fim" : "ghost-provider-holefiller"
	}

	dispose(): void {
		// No resources to dispose
	}
}
