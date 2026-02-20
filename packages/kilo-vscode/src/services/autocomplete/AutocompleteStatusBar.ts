import * as vscode from "vscode"
import { t } from "./shims/i18n"
import type { AutocompleteStatusBarStateProps } from "./types"
import { humanFormatSessionCost, formatTime } from "./statusbar-utils"

const SUPPORTED_PROVIDER_DISPLAY_NAME = "Kilo Gateway"

export class AutocompleteStatusBar {
  statusBar: vscode.StatusBarItem
  private props: AutocompleteStatusBarStateProps

  constructor(params: AutocompleteStatusBarStateProps) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
    this.props = params

    this.init()
  }

  private init() {
    this.statusBar.text = t("kilocode:autocomplete.statusBar.enabled")
    this.statusBar.tooltip = this.createMarkdownTooltip(t("kilocode:autocomplete.statusBar.tooltip.basic"))
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
    return humanFormatSessionCost(this.props.totalSessionCost)
  }

  public update(params: Partial<AutocompleteStatusBarStateProps>) {
    this.props = { ...this.props, ...params }

    this.updateVisible()
    if (this.props.enabled) {
      this.render()
    }
  }

  private formatTime(timestamp: number): string {
    return formatTime(timestamp)
  }

  private renderDefault() {
    const sessionStartTime = this.formatTime(this.props.sessionStartTime)
    const now = this.formatTime(Date.now())

    const snoozedSuffix = this.props.snoozed ? ` (${t("kilocode:autocomplete.statusBar.snoozed")})` : ""
    this.statusBar.text = `${t("kilocode:autocomplete.statusBar.enabled")} (${this.props.completionCount})${snoozedSuffix}`

    this.statusBar.tooltip = this.createMarkdownTooltip(
      [
        t("kilocode:autocomplete.statusBar.tooltip.completionSummary", {
          count: this.props.completionCount,
          startTime: sessionStartTime,
          endTime: now,
          cost: this.humanFormatSessionCost(),
        }),
        this.props.model && this.props.provider
          ? t("kilocode:autocomplete.statusBar.tooltip.providerInfo", {
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
    this.statusBar.text = t("kilocode:autocomplete.statusBar.warning")
    this.statusBar.tooltip = this.createMarkdownTooltip(t("kilocode:autocomplete.statusBar.tooltip.noCredits"))
  }

  private renderNoUsableProviderError() {
    this.statusBar.text = t("kilocode:autocomplete.statusBar.warning")
    this.statusBar.tooltip = this.createMarkdownTooltip(
      t("kilocode:autocomplete.statusBar.tooltip.noUsableProvider", { providers: SUPPORTED_PROVIDER_DISPLAY_NAME }),
    )
  }
}
