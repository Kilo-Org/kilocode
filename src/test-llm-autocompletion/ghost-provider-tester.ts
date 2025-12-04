import { FillInAtCursorSuggestion, HoleFiller } from "../services/ghost/classic-auto-complete/HoleFiller.js"
import { FimPromptBuilder } from "../services/ghost/classic-auto-complete/FillInTheMiddle.js"
import { AutocompleteInput } from "../services/ghost/types.js"
import * as vscode from "vscode"
import crypto from "crypto"
import { createContext } from "./utils.js"
import { TestGhostModel } from "./test-ghost-model.js"
import { buildTestPrompts } from "./prompt-builder.js"

export class GhostProviderTester {
	private model: TestGhostModel
	private holeFiller: HoleFiller
	private fimPromptBuilder: FimPromptBuilder

	constructor() {
		this.model = new TestGhostModel()
		this.holeFiller = new HoleFiller()
		this.fimPromptBuilder = new FimPromptBuilder()
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

		const autocompleteInput: AutocompleteInput = {
			isUntitledFile: false,
			completionId: crypto.randomUUID(),
			filepath,
			pos: { line: position.line, character: position.character },
			recentlyVisitedRanges: [],
			recentlyEditedRanges: [],
		}

		// Simple processSuggestion that just wraps the text
		const processSuggestion = (text: string): FillInAtCursorSuggestion => ({
			text,
			prefix,
			suffix,
		})

		// Build prompts using test-specific prompt builder (avoids needing real VS Code services)
		const prompts = buildTestPrompts(prefix, suffix, languageId, autocompleteInput, this.model.getModelName() ?? "")

		// Use production code for LLM interaction
		let completion: string
		if (this.model.supportsFim()) {
			const result = await this.fimPromptBuilder.getFromFIM(this.model, prompts.fim, processSuggestion)
			completion = result.suggestion.text
		} else {
			const result = await this.holeFiller.getFromChat(this.model, prompts.holeFiller, processSuggestion)
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
