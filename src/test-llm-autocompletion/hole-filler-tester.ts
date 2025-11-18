import { LLMClient } from "./llm-client.js"
import { HoleFiller, parseGhostResponse } from "../services/ghost/classic-auto-complete/HoleFiller.js"
import { AutocompleteInput } from "../services/ghost/types.js"
import * as vscode from "vscode"
import crypto from "crypto"
import { createContext } from "./utils.js"

export class HoleFillerTester {
	private llmClient: LLMClient
	private holeFiller: HoleFiller

	constructor(llmClient: LLMClient) {
		this.llmClient = llmClient
		this.holeFiller = new HoleFiller()
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

		const autocompleteInput: AutocompleteInput = {
			isUntitledFile: false,
			completionId: crypto.randomUUID(),
			filepath: context.document.uri.fsPath,
			pos: { line: position.line, character: position.character },
			recentlyVisitedRanges: [],
			recentlyEditedRanges: [],
		}

		const { systemPrompt, userPrompt } = await this.holeFiller.getPrompts(
			autocompleteInput,
			prefix,
			suffix,
			languageId,
		)

		const response = await this.llmClient.sendPrompt(systemPrompt, userPrompt)

		const parseResult = parseGhostResponse(response.content, prefix, suffix)

		const completion = parseResult.text

		return {
			prefix,
			completion,
			suffix,
		}
	}

	getName(): string {
		return "hole-filler"
	}
}
