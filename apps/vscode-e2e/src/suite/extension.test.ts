import * as assert from "assert"
import * as vscode from "vscode"

suite("Kilo Code Extension", () => {
	test("Commands should be registered", async () => {
		const expectedCommands = [
			"kilo-code.plusButtonClicked",
			"kilo-code.historyButtonClicked",
			"kilo-code.popoutButtonClicked",
			"kilo-code.settingsButtonClicked",
			"kilo-code.openInNewTab",
			"kilo-code.explainCode",
			"kilo-code.fixCode",
			"kilo-code.improveCode",
			"SidebarProvider.open",
			"SidebarProvider.focus",
			"SidebarProvider.resetViewLocation",
			"SidebarProvider.toggleVisibility",
			"SidebarProvider.removeView",
			"activationCompleted",
			"plusButtonClicked",
			"mcpButtonClicked",
			"promptsButtonClicked",
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
			"focusInput",
			"acceptInput",
			"explainCode",
			"fixCode",
			"improveCode",
			"addToContext",
			"terminalAddToContext",
			"terminalFixCommand",
			"terminalExplainCommand",
		]

		const commands = new Set((await vscode.commands.getCommands(true)).filter((cmd) => cmd.startsWith("roo-cline")))

		for (const command of expectedCommands) {
			assert.ok(commands.has(`roo-cline.${command}`), `Command ${command} should be registered`)
		}
	})
})
