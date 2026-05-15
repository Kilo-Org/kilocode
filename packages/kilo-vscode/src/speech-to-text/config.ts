import * as vscode from "vscode"
import { buildSpeechToTextSettingsMessage } from "./settings"
import type { KiloProvider } from "../KiloProvider"

export function watchSpeechToTextConfig(provider: KiloProvider): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("kilo-code.new.speechToText")) sendSpeechToTextSettings(provider)
  })
}

export function sendSpeechToTextSettings(provider: KiloProvider): void {
  provider.postMessage(buildSpeechToTextSettingsMessage())
}
