import * as vscode from "vscode"
import { t } from "../../i18n"

interface GhostStatusBarStateProps {
	enabled?: boolean
	model?: string
	provider?: string
	hasValidToken?: boolean
	totalSessionCost?: number
	completionCount?: number
	sessionStartTime?: number
}

export class GhostStatusBar {
	statusBar: vscode.StatusBarItem
	enabled: boolean
	model: string
	provider: string
	hasValidToken: boolean
	totalSessionCost?: number
	completionCount?: number
	sessionStartTime?: number

	constructor(params: GhostStatusBarStateProps) {
		this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		this.enabled = params.enabled || false
		this.model = params.model || "default"
		this.provider = params.provider || "default"
		this.hasValidToken = params.hasValidToken || false
		this.totalSessionCost = params.totalSessionCost
		this.completionCount = params.completionCount
		this.sessionStartTime = params.sessionStartTime

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
		this.hasValidToken = params.hasValidToken !== undefined ? params.hasValidToken : this.hasValidToken
		this.totalSessionCost = params.totalSessionCost !== undefined ? params.totalSessionCost : this.totalSessionCost
		this.completionCount = params.completionCount !== undefined ? params.completionCount : this.completionCount
		this.sessionStartTime = params.sessionStartTime !== undefined ? params.sessionStartTime : this.sessionStartTime

		this.updateVisible(this.enabled)
		if (this.enabled) this.render()
	}

	private renderTokenError() {
		this.statusBar.text = t("kilocode:ghost.statusBar.warning")
		this.statusBar.tooltip = t("kilocode:ghost.statusBar.tooltip.tokenError")
	}

	private formatSessionDuration(): string {
		if (!this.sessionStartTime) return "N/A"
		const durationMs = Date.now() - this.sessionStartTime
		const durationMinutes = Math.floor(durationMs / 60000)
		const durationSeconds = Math.floor((durationMs % 60000) / 1000)

		if (durationMinutes > 0) {
			return `${durationMinutes}m ${durationSeconds}s`
		}
		return `${durationSeconds}s`
	}

	private formatSessionStartTime(): string {
		if (!this.sessionStartTime) return "N/A"
		const date = new Date(this.sessionStartTime)
		return date.toLocaleTimeString()
	}

	private renderDefault() {
		const totalCostFormatted = this.humanFormatCost(this.totalSessionCost || 0)
		const completionCount = this.completionCount || 0
		const sessionDuration = this.formatSessionDuration()
		const sessionStartTime = this.formatSessionStartTime()

		this.statusBar.text = `${t("kilocode:ghost.statusBar.enabled")} (${completionCount})`
		this.statusBar.tooltip = `\
${t("kilocode:ghost.statusBar.tooltip.basic")}
• ${t("kilocode:ghost.statusBar.tooltip.completionCount")} ${completionCount}
• ${t("kilocode:ghost.statusBar.tooltip.sessionStartTime")} ${sessionStartTime}
• ${t("kilocode:ghost.statusBar.tooltip.sessionDuration")} ${sessionDuration}
• ${t("kilocode:ghost.statusBar.tooltip.sessionTotal")} ${totalCostFormatted}
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
