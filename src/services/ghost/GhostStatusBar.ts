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

// kilocode_change - Command ID for showing ghost status tooltip on click
const GHOST_STATUS_COMMAND_ID = "kilocode.ghost.showStatus"

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
	private commandDisposable: vscode.Disposable | undefined // kilocode_change

	constructor(params: GhostStatusBarStateProps) {
		this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		this.props = params

		this.init()
	}

	private init() {
		// kilocode_change start - Register command to show status on click
		this.commandDisposable = vscode.commands.registerCommand(GHOST_STATUS_COMMAND_ID, () => {
			this.showStatusMessage()
		})
		this.statusBar.command = GHOST_STATUS_COMMAND_ID
		// kilocode_change end

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
		this.commandDisposable?.dispose() // kilocode_change
		this.statusBar.dispose()
	}

	// kilocode_change start - Show status message on click
	private showStatusMessage() {
		if (this.props.hasKilocodeProfileWithNoBalance) {
			vscode.window.showWarningMessage(t("kilocode:ghost.statusBar.tooltip.noCredits"))
			return
		}
		if (this.props.hasNoUsableProvider) {
			const providers = getSupportedProviderDisplayNames()
			const providerList = providers.join(", ")
			vscode.window.showWarningMessage(
				t("kilocode:ghost.statusBar.tooltip.noUsableProvider", { providers: providerList }),
			)
			return
		}

		const sessionStartTime = this.formatTime(this.props.sessionStartTime)
		const now = this.formatTime(Date.now())

		const message = [
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
			.join(" | ")

		vscode.window.showInformationMessage(message)
	}
	// kilocode_change end

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
