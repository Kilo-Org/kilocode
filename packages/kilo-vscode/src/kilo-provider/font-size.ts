import * as vscode from "vscode"
import { getWebviewDisplaySettings, getWebviewFontSize, type WebviewDisplaySettings } from "../utils"

export function watchFontSizeConfig(
  post: (
    msg:
      | { type: "fontSizeChanged"; fontSize: number }
      | { type: "displaySettingsChanged"; settings: WebviewDisplaySettings },
  ) => void,
  next?: vscode.Disposable,
) {
  const font = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("kilo-code.new.fontSize"))
      post({ type: "fontSizeChanged", fontSize: getWebviewFontSize() })

    if (
      event.affectsConfiguration("kilo-code.new.diffFontSize") ||
      event.affectsConfiguration("kilo-code.new.diffSyntaxTheme")
    )
      post({ type: "displaySettingsChanged", settings: getWebviewDisplaySettings() })
  })
  return next ? vscode.Disposable.from(font, next) : font
}
