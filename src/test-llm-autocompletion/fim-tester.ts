import { LLMClient } from "./llm-client.js"
import * as vscode from "vscode"
import { createContext } from "./utils.js"

export class FimTester {
	private llmClient: LLMClient

	constructor(llmClient: LLMClient) {
		this.llmClient = llmClient
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

		const fimResponse = await this.llmClient.sendFimCompletion(prefix, suffix)
		const completion = fimResponse.completion

		return {
			prefix,
			completion,
			suffix,
		}
	}

	getName(): string {
		return "fim"
	}
}
