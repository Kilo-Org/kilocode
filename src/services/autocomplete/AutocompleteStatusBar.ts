import * as vscode from "vscode"

interface AutocompleteStatusBarStateParams {
	enabled?: boolean
	model?: string
	kilocodeToken?: string
	totalSessionCost?: number
	lastCompletionCost?: number
}

export class AutocompleteStatusBar {
	statusBar: vscode.StatusBarItem
	enabled: boolean
	model: string
	kilocodeToken?: string
	totalSessionCost?: number
	lastCompletionCost?: number

	constructor(params: AutocompleteStatusBarStateParams) {
		this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		this.enabled = params.enabled || false
		this.model = params.model || "default"
		this.kilocodeToken = params.kilocodeToken
		this.totalSessionCost = params.totalSessionCost
		this.lastCompletionCost = params.lastCompletionCost

		this.init()
	}

	private init() {
		this.statusBar.text = "$(sparkle) Kilo Complete"
		this.statusBar.tooltip = "Kilo Code Autocomplete"
		this.statusBar.command = "kilo-code.toggleAutocomplete"
		this.show()
	}

	public show() {
		this.statusBar.show()
	}

	public hide() {
		this.statusBar.hide()
	}

	public dispose() {
		this.statusBar.dispose()
	}

	private humanFormatCost(cost: number): string {
		if (cost === 0) return "$0.00"
		if (cost > 0 && cost < 0.01) return "<$0.01" // Less than one cent
		return `$${cost.toFixed(2)}`
	}

	public update(params: AutocompleteStatusBarStateParams) {
		this.enabled = params.enabled !== undefined ? params.enabled : this.enabled
		this.kilocodeToken = params.kilocodeToken !== undefined ? params.kilocodeToken : this.kilocodeToken
		this.totalSessionCost = params.totalSessionCost !== undefined ? params.totalSessionCost : this.totalSessionCost
		this.lastCompletionCost =
			params.lastCompletionCost !== undefined ? params.lastCompletionCost : this.lastCompletionCost
		this.render()
	}

	private renderDisabled() {
		this.statusBar.text = "$(circle-slash) Kilo Complete"
		this.statusBar.tooltip = "Kilo Code Autocomplete (disabled)"
	}

	private renderTokenError() {
		this.statusBar.text = "$(warning) Kilo Complete"
		this.statusBar.tooltip = "A valid Kilocode token must be set to use autocomplete"
	}

	private renderDefault() {
		const totalCostFormatted = this.humanFormatCost(this.totalSessionCost || 0)
		const lastCompletionCostFormatted = this.lastCompletionCost?.toFixed(5) || 0
		this.statusBar.text = `$(sparkle) Kilo Complete (${totalCostFormatted})`
		this.statusBar.tooltip = `\
Kilo Code Autocomplete
• Last completion: $${lastCompletionCostFormatted}
• Session total cost: ${totalCostFormatted}
• Model: ${this.model}\
`
	}

	public render() {
		if (!this.enabled) {
			return this.renderDisabled()
		}
		if (!this.kilocodeToken) {
			return this.renderTokenError()
		}
		return this.renderDefault()
	}
}
