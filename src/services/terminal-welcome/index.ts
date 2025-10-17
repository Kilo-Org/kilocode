// kilocode_change - new file
import * as vscode from "vscode"
import { TerminalWelcomeService } from "./TerminalWelcomeService"

export const registerWelcomeService = (context: vscode.ExtensionContext): void => {
	TerminalWelcomeService.register(context)
}
