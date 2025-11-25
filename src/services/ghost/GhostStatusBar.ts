import * as vscode from "vscode"
import { t } from "../../i18n"

interface GhostStatusBarStateProps {
	enabled?: boolean
	model?: string
	provider?: string
	profileName?: string | null
	hasValidToken?: boolean
	totalSessionCost?: number
	lastCompletionCost?: number
}

export class GhostStatusBar {
	statusBar: vscode.StatusBarItem
	enabled: boolean
	model: string
	provider: string
	profileName: string | null
	hasValidToken: boolean
	totalSessionCost?: number
	lastCompletionCost?: number

	constructor(params: GhostStatusBarStateProps) {
		this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		this.enabled = params.enabled || false
		this.model = params.model || "default"
		this.provider = params.provider || "default"
		this.profileName = params.profileName || null
		this.hasValidToken = params.hasValidToken || false
		this.totalSessionCost = params.totalSessionCost
		this.lastCompletionCost = params.lastCompletionCost

		this.init()
	}

	private init() {
		this.statusBar.text = t("kilocode:ghost.statusBar.enabled")
		this.statusBar.tooltip = t("kilocode:ghost.statusBar.tooltip.basic")
		this.statusBar.show()
	}

	public updateVisible(enabled: boolean) {
		if (enabled) {
			this.statusBar.show()
		} else {
			this.statusBar.hide()
		}
	}

	public dispose() {
		this.statusBar.dispose()
	}

	private humanFormatCost(cost: number): string {
		if (cost === 0) return t("kilocode:ghost.statusBar.cost.zero")
		if (cost > 0 && cost < 0.01) return t("kilocode:ghost.statusBar.cost.lessThanCent") // Less than one cent
		return `$${cost.toFixed(2)}`
	}

	public update(params: GhostStatusBarStateProps) {
		this.enabled = params.enabled !== undefined ? params.enabled : this.enabled
		this.model = params.model !== undefined ? params.model : this.model
		this.provider = params.provider !== undefined ? params.provider : this.provider
		this.profileName = params.profileName !== undefined ? params.profileName : this.profileName
		this.hasValidToken = params.hasValidToken !== undefined ? params.hasValidToken : this.hasValidToken
		this.totalSessionCost = params.totalSessionCost !== undefined ? params.totalSessionCost : this.totalSessionCost
		this.lastCompletionCost =
			params.lastCompletionCost !== undefined ? params.lastCompletionCost : this.lastCompletionCost

		this.updateVisible(this.enabled)
		if (this.enabled) this.render()
	}

	private renderTokenError() {
		this.statusBar.text = t("kilocode:ghost.statusBar.warning")
		this.statusBar.tooltip = t("kilocode:ghost.statusBar.tooltip.tokenError")
	}

	private renderDefault() {
		const totalCostFormatted = this.humanFormatCost(this.totalSessionCost || 0)
		const lastCompletionCostFormatted = this.lastCompletionCost?.toFixed(5) || 0
		this.statusBar.text = `${t("kilocode:ghost.statusBar.enabled")} (${totalCostFormatted})`
		this.statusBar.tooltip = `\
${t("kilocode:ghost.statusBar.tooltip.basic")}
• ${t("kilocode:ghost.statusBar.tooltip.lastCompletion")} $${lastCompletionCostFormatted}
• ${t("kilocode:ghost.statusBar.tooltip.sessionTotal")} ${totalCostFormatted}
• ${t("kilocode:ghost.statusBar.tooltip.profile")}${this.profileName}
• ${t("kilocode:ghost.statusBar.tooltip.provider")} ${this.provider}
• ${t("kilocode:ghost.statusBar.tooltip.model")} ${this.model}\
`
	}

	public render() {
		if (!this.hasValidToken) {
			return this.renderTokenError()
		}
		return this.renderDefault()
	}
}
