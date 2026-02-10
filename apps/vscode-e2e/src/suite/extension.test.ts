import * as assert from "assert"
import * as vscode from "vscode"

import { setDefaultSuiteTimeout } from "./test-utils"

suite("Kilo Code Extension", function () {
	setDefaultSuiteTimeout(this)

	test("Commands should be registered", async () => {
		const expectedCommands = [
			"activationCompleted",
			"plusButtonClicked",
			"popoutButtonClicked",
			"openInNewTab",
			"settingsButtonClicked",
			"historyButtonClicked",
			"showHumanRelayDialog",
			"registerHumanRelayCallback",
			"unregisterHumanRelayCallback",
			"handleHumanRelayResponse",
			"newTask",
			"setCustomStoragePath",
			"acceptInput",
			"explainCode",
			"fixCode",
			"improveCode",
			"addToContext",
			"terminalAddToContext",
			"terminalFixCommand",
			"terminalExplainCommand",
		]

		const commands = new Set((await vscode.commands.getCommands(true)).filter((cmd) => cmd.startsWith("kilo-code")))

		for (const command of expectedCommands) {
			assert.ok(commands.has(`kilo-code.${command}`), `Command ${command} should be registered`)
		}
	})
})
