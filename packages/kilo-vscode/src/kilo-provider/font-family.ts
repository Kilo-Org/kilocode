import * as vscode from "vscode"
import { getFontFamilyConfig } from "../utils"

export function watchFontFamilyConfig(
  post: (msg: { type: "fontFamilyChanged"; fontFamily: string }) => void,
  next?: vscode.Disposable,
) {
  const font = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("kilo-code.new.fontFamily"))
      post({ type: "fontFamilyChanged", fontFamily: getFontFamilyConfig() })
  })
  return next ? vscode.Disposable.from(font, next) : font
}
