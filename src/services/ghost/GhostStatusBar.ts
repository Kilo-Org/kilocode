import * as vscode from "vscode"
import { t } from "../../i18n"
import type { GhostStatusBarStateProps } from "./types"

export class GhostStatusBar {
	statusBar: vscode.StatusBarItem
	private props: GhostStatusBarStateProps

	constructor(params: GhostStatusBarStateProps) {
		this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		this.props = params

		this.init()
	}

	private init() {
		this.statusBar.text = t("kilocode:ghost.statusBar.enabled")
		this.statusBar.tooltip = t("kilocode:ghost.statusBar.tooltip.basic")
		this.statusBar.show()
	}

	private updateVisible() {
		if (this.props.enabled) {
			this.statusBar.show()
		} else {
			this.statusBar.hide()
		}
	}

	public dispose() {
		this.statusBar.dispose()
	}

	private humanFormatSessionCost(): string {
		const cost = this.props.totalSessionCost
		if (cost === 0) return t("kilocode:ghost.statusBar.cost.zero")
		if (cost > 0 && cost < 0.01) return t("kilocode:ghost.statusBar.cost.lessThanCent") // Less than one cent
		return `$${cost.toFixed(2)}`
	}

	public update(params: Partial<GhostStatusBarStateProps>) {
		this.props = { ...this.props, ...params }

		this.updateVisible()
		if (this.props.enabled) this.render()
	}

	private renderTokenError() {
		this.statusBar.text = t("kilocode:ghost.statusBar.warning")
		this.statusBar.tooltip = t("kilocode:ghost.statusBar.tooltip.tokenError")
	}

	private formatTime(timestamp: number): string {
		const date = new Date(timestamp)
		return date.toLocaleTimeString()
	}

	private renderDefault() {
		const sessionStartTime = this.formatTime(this.props.sessionStartTime)
		const now = this.formatTime(Date.now())

		const snoozedSuffix = this.props.snoozed ? ` (${t("kilocode:ghost.statusBar.snoozed")})` : ""
		this.statusBar.text = `${t("kilocode:ghost.statusBar.enabled")} (${this.props.completionCount})${snoozedSuffix}`

		this.statusBar.tooltip = [
			t("kilocode:ghost.statusBar.tooltip.completionSummary", {
				count: this.props.completionCount,
				startTime: sessionStartTime,
				endTime: now,
				cost: this.humanFormatSessionCost(),
			}),
			this.props.model && this.props.provider
				? t("kilocode:ghost.statusBar.tooltip.providerInfo", {
						model: this.props.model,
						provider: this.props.provider,
					})
				: undefined,
		]
			.filter(Boolean)
			.join("\n\n")
	}

	public render() {
		if (!this.props.hasValidToken) {
			return this.renderTokenError()
		}
		return this.renderDefault()
	}
}
