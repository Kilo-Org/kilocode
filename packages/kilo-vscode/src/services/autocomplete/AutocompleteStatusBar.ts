import * as vscode from "vscode"
import { StatusBar } from "../statusbar"
import { formatTime } from "../statusbar/utils"
import { t } from "./shims/i18n"
import { humanFormatSessionCost } from "./statusbar-utils"
import type { AutocompleteStatusBarStateProps } from "./types"

const SUPPORTED_PROVIDER_DISPLAY_NAME = "Kilo Gateway"

export class AutocompleteStatusBar {
  private readonly bar: StatusBar
  private props: AutocompleteStatusBarStateProps

  constructor(params: AutocompleteStatusBarStateProps) {
    this.bar = new StatusBar(vscode.StatusBarAlignment.Right, 100)
    this.props = params
    this.init()
  }

  private init() {
    this.bar.update(
      t("kilocode:autocomplete.statusBar.enabled"),
      this.createMarkdownTooltip(t("kilocode:autocomplete.statusBar.tooltip.basic")),
      true,
    )
  }

  private createMarkdownTooltip(text: string): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString(text)
    markdown.isTrusted = true
    return markdown
  }

  public dispose() {
    this.bar.dispose()
  }

  public update(params: Partial<AutocompleteStatusBarStateProps>) {
    this.props = { ...this.props, ...params }
    this.bar.update(this.getText(), this.createMarkdownTooltip(this.getTooltip()), this.props.enabled ?? false)
  }

  private getText(): string {
    if (this.props.hasKilocodeProfileWithNoBalance || this.props.hasNoUsableProvider) {
      return t("kilocode:autocomplete.statusBar.warning")
    }
    const snoozedSuffix = this.props.snoozed ? ` (${t("kilocode:autocomplete.statusBar.snoozed")})` : ""
    return `${t("kilocode:autocomplete.statusBar.enabled")} (${this.props.completionCount})${snoozedSuffix}`
  }

  private getTooltip(): string {
    if (this.props.hasKilocodeProfileWithNoBalance) {
      return t("kilocode:autocomplete.statusBar.tooltip.noCredits")
    }
    if (this.props.hasNoUsableProvider) {
      return t("kilocode:autocomplete.statusBar.tooltip.noUsableProvider", {
        providers: SUPPORTED_PROVIDER_DISPLAY_NAME,
      })
    }
    const sessionStartTime = formatTime(this.props.sessionStartTime)
    const now = formatTime(Date.now())
    const parts = [
      t("kilocode:autocomplete.statusBar.tooltip.completionSummary", {
        count: this.props.completionCount,
        startTime: sessionStartTime,
        endTime: now,
        cost: humanFormatSessionCost(this.props.totalSessionCost),
      }),
    ]
    if (this.props.model && this.props.provider) {
      parts.push(
        t("kilocode:autocomplete.statusBar.tooltip.providerInfo", {
          model: this.props.model,
          provider: this.props.provider,
        }),
      )
    }
    return parts.join("\n\n")
  }

}
