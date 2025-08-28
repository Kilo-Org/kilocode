// kilocode_change - new file
import * as vscode from "vscode"
import { t } from "../../i18n"
import { getCurrentKeybindingLabel } from "../../utils/keybindings"

/**
 * Service that displays welcome messages in newly opened terminals
 */
export class TerminalWelcomeService {
	private disposables: vscode.Disposable[] = []
	private tipShownThisSession = false

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
		if (this.tipShownThisSession) {
			return
		}

		this.tipShownThisSession = true
		setTimeout(() => this.showWelcomeMessage(terminal), 500)
	}

	private async showWelcomeMessage(terminal: vscode.Terminal): Promise<void> {
		const shortcut = await getCurrentKeybindingLabel("kilo-code.generateTerminalCommand")
		const message = t("kilocode:terminalCommandGenerator.tipMessage", { shortcut })
		vscode.window.showInformationMessage(message)
	}

	public dispose(): void {
		this.disposables.forEach((disposable) => disposable.dispose())
		this.disposables = []
	}
}
