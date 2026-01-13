import * as vscode from "vscode"
import { AUTOCOMPLETE_PROVIDER_MODELS, ProviderName } from "@roo-code/types"
import { t } from "../../i18n"
import { PROVIDERS } from "../../../webview-ui/src/components/settings/constants"
import type { GhostStatusBarStateProps } from "./types"

// Convert PROVIDERS array to a lookup map for display names
const PROVIDER_DISPLAY_NAMES = Object.fromEntries(PROVIDERS.map(({ value, label }) => [value, label])) as Record<
	ProviderName,
	string
>

/**
 * Get the display names of all supported autocomplete providers
 */
function getSupportedProviderDisplayNames(): string[] {
	const providerKeys = Array.from(AUTOCOMPLETE_PROVIDER_MODELS.keys())
	return providerKeys.map((key) => PROVIDER_DISPLAY_NAMES[key as ProviderName] || key)
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
		this.statusBar.tooltip = this.createMarkdownTooltip(t("kilocode:ghost.statusBar.tooltip.basic"))
		this.statusBar.show()
	}

	private createMarkdownTooltip(text: string): vscode.MarkdownString {
		const markdown = new vscode.MarkdownString(text)
		markdown.isTrusted = true
		return markdown
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

	private formatTime(timestamp: number): string {
		const date = new Date(timestamp)
		return date.toLocaleTimeString()
	}

	private renderDefault() {
		const sessionStartTime = this.formatTime(this.props.sessionStartTime)
		const now = this.formatTime(Date.now())

		const snoozedSuffix = this.props.snoozed ? ` (${t("kilocode:ghost.statusBar.snoozed")})` : ""
		this.statusBar.text = `${t("kilocode:ghost.statusBar.enabled")} (${this.props.completionCount})${snoozedSuffix}`

		this.statusBar.tooltip = this.createMarkdownTooltip(
			[
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
				.join("\n\n"),
		)
	}

	public render() {
		if (this.props.hasKilocodeProfileWithNoBalance) {
			return this.renderNoCreditsError()
		}
		if (this.props.hasNoUsableProvider) {
			return this.renderNoUsableProviderError()
		}
		return this.renderDefault()
	}

	private renderNoCreditsError() {
		this.statusBar.text = t("kilocode:ghost.statusBar.warning")
		this.statusBar.tooltip = this.createMarkdownTooltip(t("kilocode:ghost.statusBar.tooltip.noCredits"))
	}

	private renderNoUsableProviderError() {
		this.statusBar.text = t("kilocode:ghost.statusBar.warning")
		const providers = getSupportedProviderDisplayNames()
		const providerList = providers.join(", ")
		this.statusBar.tooltip = this.createMarkdownTooltip(
			t("kilocode:ghost.statusBar.tooltip.noUsableProvider", { providers: providerList }),
		)
	}
}
