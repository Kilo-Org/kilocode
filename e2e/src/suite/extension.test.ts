import * as assert from "assert"
import * as vscode from "vscode"

suite("CodeFlux AI Extension", () => {
	test("OPENROUTER_API_KEY environment variable is set", () => {
		if (!process.env.OPENROUTER_API_KEY) {
			assert.fail("OPENROUTER_API_KEY environment variable is not set")
		}
	})

	test("Commands should be registered", async () => {
		const expectedCommands = [
			"codeflux-ai.plusButtonClicked",
			"codeflux-ai.mcpButtonClicked",
			"codeflux-ai.historyButtonClicked",
			"codeflux-ai.popoutButtonClicked",
			"codeflux-ai.settingsButtonClicked",
			"codeflux-ai.openInNewTab",
			"codeflux-ai.explainCode",
			"codeflux-ai.fixCode",
			"codeflux-ai.improveCode",
		]

		const commands = await vscode.commands.getCommands(true)

		for (const cmd of expectedCommands) {
			assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`)
		}
	})
})
