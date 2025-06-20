import * as vscode from "vscode"
import { formatCost } from "./utils/costFormatting"

export interface AutocompleteState {
	enabled: boolean
	lastCompletionCost: number
	totalSessionCost: number
	lastCompletionTime: number
	model: string
	hasValidToken: boolean
}

export class AutocompleteStatusBar implements vscode.Disposable {
	private statusBarItem: vscode.StatusBarItem

	constructor() {
		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		this.statusBarItem.command = "kilo-code.toggleAutocomplete"
		this.statusBarItem.show()
	}

	updateDisplay(state: AutocompleteState): void {
		if (!state.enabled) {
			this.statusBarItem.text = "$(circle-slash) Kilo Complete"
			this.statusBarItem.tooltip = "Kilo Code Autocomplete (disabled)"
			return
		}

		if (!state.hasValidToken) {
			this.statusBarItem.text = "$(warning) Kilo Complete"
			this.statusBarItem.tooltip = "A valid Kilocode token must be set to use autocomplete"
			return
		}

		const totalCostFormatted = formatCost(state.totalSessionCost)
		const timingText = state.lastCompletionTime > 0 ? ` ${state.lastCompletionTime.toFixed(1)}s` : ""
		this.statusBarItem.text = `$(sparkle) Kilo Complete (${totalCostFormatted}${timingText})`
		this.statusBarItem.tooltip = `\
Kilo Code Autocomplete

Last completion: $${state.lastCompletionCost.toFixed(5)}${state.lastCompletionTime > 0 ? ` (${state.lastCompletionTime.toFixed(1)}s)` : ""}
Session total cost: ${formatCost(state.totalSessionCost)}
Model: ${state.model}\
`
	}

	dispose(): void {
		this.statusBarItem.dispose()
	}
}
