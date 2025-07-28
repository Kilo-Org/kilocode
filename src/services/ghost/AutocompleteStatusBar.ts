import * as vscode from "vscode"
import { t } from "../../i18n"

interface AutocompleteStatusBarStateParams {
	enabled?: boolean
	model?: string
	hasValidToken?: boolean
	totalSessionCost?: number
	lastCompletionCost?: number
}

export class AutocompleteStatusBar {
	statusBar: vscode.StatusBarItem
	enabled: boolean
	model: string
	hasValidToken: boolean
	totalSessionCost?: number
	lastCompletionCost?: number

	constructor(params: AutocompleteStatusBarStateParams) {
		this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		this.enabled = params.enabled || false
		this.model = params.model || "default"
		this.hasValidToken = params.hasValidToken || false
		this.totalSessionCost = params.totalSessionCost
		this.lastCompletionCost = params.lastCompletionCost

		this.init()
	}

	private init() {
		this.statusBar.text = t("kilocode:autocomplete.statusBar.enabled")
		this.statusBar.tooltip = t("kilocode:autocomplete.statusBar.tooltip.basic")
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
		if (cost === 0) return t("kilocode:autocomplete.statusBar.cost.zero")
		if (cost > 0 && cost < 0.01) return t("kilocode:autocomplete.statusBar.cost.lessThanCent") // Less than one cent
		return `$${cost.toFixed(2)}`
	}

	public update(params: AutocompleteStatusBarStateParams) {
		this.enabled = params.enabled !== undefined ? params.enabled : this.enabled
		this.model = params.model !== undefined ? params.model : this.model
		this.hasValidToken = params.hasValidToken !== undefined ? params.hasValidToken : this.hasValidToken
		this.totalSessionCost = params.totalSessionCost !== undefined ? params.totalSessionCost : this.totalSessionCost
		this.lastCompletionCost =
			params.lastCompletionCost !== undefined ? params.lastCompletionCost : this.lastCompletionCost
		this.render()
	}

	private renderDisabled() {
		this.statusBar.text = t("kilocode:autocomplete.statusBar.disabled")
		this.statusBar.tooltip = t("kilocode:autocomplete.statusBar.tooltip.disabled")
	}

	private renderTokenError() {
		this.statusBar.text = t("kilocode:autocomplete.statusBar.warning")
		this.statusBar.tooltip = t("kilocode:autocomplete.statusBar.tooltip.tokenError")
	}

	private renderDefault() {
		const totalCostFormatted = this.humanFormatCost(this.totalSessionCost || 0)
		const lastCompletionCostFormatted = this.lastCompletionCost?.toFixed(5) || 0
		this.statusBar.text = `${t("kilocode:autocomplete.statusBar.enabled")} (${totalCostFormatted})`
		this.statusBar.tooltip = `\
${t("kilocode:autocomplete.statusBar.tooltip.basic")}
• ${t("kilocode:autocomplete.statusBar.tooltip.lastCompletion")} $${lastCompletionCostFormatted}
• ${t("kilocode:autocomplete.statusBar.tooltip.sessionTotal")} ${totalCostFormatted}
• ${t("kilocode:autocomplete.statusBar.tooltip.model")} ${this.model}\
`
	}

	public render() {
		if (!this.enabled) {
			return this.renderDisabled()
		}
		if (!this.hasValidToken) {
			return this.renderTokenError()
		}
		return this.renderDefault()
	}
}
