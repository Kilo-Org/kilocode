import * as vscode from "vscode"
import { getSpeechToTextModel } from "./models"

export function buildSpeechToTextSettingsMessage() {
  const config = vscode.workspace.getConfiguration("kilo-code.new.speechToText")
  return {
    type: "speechToTextSettingsLoaded" as const,
    settings: {
      enabled: config.get<boolean>("enabled", false),
      model: getSpeechToTextModel(config.get<string>("model")).id,
    },
  }
}

export function validSpeechToTextSetting(key: string, value: unknown) {
  if (key === "enabled") return typeof value === "boolean"
  if (key === "model") return typeof value === "string" && getSpeechToTextModel(value).id === value
  return false
}
