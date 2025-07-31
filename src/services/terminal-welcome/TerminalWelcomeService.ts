// kilocode_change - new file
import * as vscode from "vscode"
import { t } from "../../i18n"

/**
 * Service that displays welcome messages in newly opened terminals
 */
export class TerminalWelcomeService {
	private disposables: vscode.Disposable[] = []
	private shownTerminals = new Set<vscode.Terminal>()

	constructor(private context: vscode.ExtensionContext) {}

	public static register(context: vscode.ExtensionContext): void {
		const terminalWelcomeService = new TerminalWelcomeService(context)
		terminalWelcomeService.initialize()
		context.subscriptions.push(terminalWelcomeService)
	}

	public initialize(): void {
		const onDidOpenTerminal = vscode.window.onDidOpenTerminal((terminal) => {
			this.handleTerminalOpened(terminal)
		})
		this.disposables.push(onDidOpenTerminal)

		vscode.window.terminals.forEach((terminal) => {
			this.handleTerminalOpened(terminal)
		})
	}

	private handleTerminalOpened(terminal: vscode.Terminal): void {
		// Don't show the tip if it's a Kilo terminal or they've seen it before
		if (this.shownTerminals.has(terminal) || terminal.name !== "Kilo Code") {
			return
		}
		this.shownTerminals.add(terminal)
		setTimeout(() => this.showWelcomeMessage(terminal), 500)

		const onDidCloseTerminal = vscode.window.onDidCloseTerminal((closedTerminal) => {
			this.shownTerminals.delete(terminal)
			onDidCloseTerminal.dispose()
		})
		this.disposables.push(onDidCloseTerminal)
	}

	private showWelcomeMessage(terminal: vscode.Terminal): void {
		const shortcut = this.getKeyboardShortcut()
		const message = t("kilocode:terminalCommandGenerator.tipMessage", { shortcut })
		vscode.window.showInformationMessage(message)
	}

	private getKeyboardShortcut(): string {
		const isMac = process.platform === "darwin"
		const modifier = isMac ? "Cmd" : "Ctrl"
		return `${modifier}+Shift+G`
	}

	public dispose(): void {
		this.disposables.forEach((disposable) => disposable.dispose())
		this.disposables = []
		this.shownTerminals.clear()
	}
}
