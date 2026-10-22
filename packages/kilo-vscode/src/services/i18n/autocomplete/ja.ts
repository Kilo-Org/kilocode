export const dict = {
  "kilocode:autocomplete.statusBar.enabled": "$(kilo-logo) オートコンプリート",
  "kilocode:autocomplete.statusBar.snoozed": "一時停止中",
  "kilocode:autocomplete.statusBar.warning": "$(warning) オートコンプリート",
  "kilocode:autocomplete.statusBar.tooltip.basic": "Kilo Code オートコンプリート",
  "kilocode:autocomplete.statusBar.tooltip.noUsableProvider":
    "**オートコンプリートモデルが設定されていません**\n\nオートコンプリートを有効にするには、次の対応プロバイダーのいずれかを含むプロファイルを追加してください: {{providers}}。\n\n[設定を開く]({{command}})",
  "kilocode:autocomplete.statusBar.tooltip.completionSummary":
    "{{startTime}} から {{endTime}} までに {{count}} 件の補完を実行し、合計コストは {{cost}} でした。",
  "kilocode:autocomplete.statusBar.tooltip.providerInfo":
    "オートコンプリートは {{provider}} 経由の {{model}} によって提供されています。",
  "kilocode:autocomplete.statusBar.cost.zero": "$0.00",
  "kilocode:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "kilocode:autocomplete.codeAction.title": "Kilo Code: 提案された編集",
  "kilocode:autocomplete.incompatibilityExtensionPopup.message":
    "Kilo Code オートコンプリートは GitHub Copilot との競合によりブロックされています。修正するには、Copilot のインライン提案を無効にする必要があります。",
  "kilocode:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Copilot を無効化",
  "kilocode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "オートコンプリートを無効化",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code オートコンプリートは一時停止されました。考えられる原因: Kilo アカウントに残りクレジットがない、または設定済みの API キー (BYOK) がクォータ上限に達しています。オートコンプリートを再開するには、Kilo クレジットを追加するか API キー設定を確認してください。",
  "kilocode:autocomplete.creditsExhausted.addCredits": "クレジットを追加",
  "kilocode:autocomplete.authError.message":
    "Kilo Code オートコンプリートは認証の問題により一時停止されました。考えられる原因: Kilo にサインインしていない、または API キー (BYOK) が無効または不足しています。再度サインインするか、プロバイダーの API キー設定を確認してください。",
}
