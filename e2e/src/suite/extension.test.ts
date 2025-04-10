import * as assert from "assert"
import * as vscode from "vscode"

suite("Kilo Code Extension", () => {
	test("Commands should be registered", async () => {
		const expectedCommands = [
			"kilo-code.plusButtonClicked",
			"kilo-code.mcpButtonClicked",
			"kilo-code.historyButtonClicked",
			"kilo-code.popoutButtonClicked",
			"kilo-code.settingsButtonClicked",
			"kilo-code.openInNewTab",
			"kilo-code.explainCode",
			"kilo-code.fixCode",
			"kilo-code.improveCode",
		]

		const commands = await vscode.commands.getCommands(true)

		for (const cmd of expectedCommands) {
			assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`)
		}
	})
})
