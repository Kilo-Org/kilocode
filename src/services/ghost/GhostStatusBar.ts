import * as vscode from "vscode"
import { t } from "../../i18n"

interface GhostStatusBarStateProps {
	enabled?: boolean
	model?: string
	provider?: string
	profileName?: string | null
	hasValidToken: boolean
	totalSessionCost: number
	completionCount: number
	sessionStartTime: number
}

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

	public update(params: Partial<GhostStatusBarStateProps>) {
		this.props = { ...this.props, ...params }

		const enabled = this.props.enabled ?? false
		this.updateVisible(enabled)
		if (enabled) this.render()
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
		const model = this.props.model ?? "default"
		const provider = this.props.provider ?? "default"
		const totalCostFormatted = this.humanFormatCost(this.props.totalSessionCost)
		const sessionStartTime = this.formatTime(this.props.sessionStartTime)
		const now = this.formatTime(Date.now())

		this.statusBar.text = `${t("kilocode:ghost.statusBar.enabled")} (${this.props.completionCount})`
		this.statusBar.tooltip = `Performed ${this.props.completionCount} completions between ${sessionStartTime} and ${now}, for a total cost of ${totalCostFormatted}.\n\nAutocompletions provided by ${model} via ${provider}.`
	}

	public render() {
		if (!this.props.hasValidToken) {
			return this.renderTokenError()
		}
		return this.renderDefault()
	}
}
