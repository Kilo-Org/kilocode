import * as vscode from "vscode"
import {
  getAutocompleteModel,
  validAutocompleteModel,
  validAutocompleteProvider,
} from "../../shared/autocomplete-models"

type Message = {
  type: string
}

type Post = (msg: unknown) => void

export async function routeAutocompleteMessage(message: Message, post: Post): Promise<boolean> {
  if (message.type === "requestAutocompleteSettings") {
    post(buildAutocompleteSettingsMessage())
    return true
  }

  return false
}

export function buildAutocompleteSettingsMessage() {
  const config = vscode.workspace.getConfiguration("kilo-code.new.autocomplete")
  const info = getAutocompleteModel(config.get<string>("provider"), config.get<string>("model"))
  return {
    type: "autocompleteSettingsLoaded" as const,
    settings: {
      enableAutoTrigger: config.get<boolean>("enableAutoTrigger", true),
      enableSmartInlineTaskKeybinding: config.get<boolean>("enableSmartInlineTaskKeybinding", false),
      enableChatAutocomplete: config.get<boolean>("enableChatAutocomplete", false),
      provider: info.providerID,
      model: info.modelID,
    },
  }
}

/** Push autocomplete settings to the webview whenever VS Code config changes. */
export function watchAutocompleteConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("kilo-code.new.autocomplete")) {
      post(buildAutocompleteSettingsMessage())
    }
  })
}

export function validAutocompleteSetting(key: string, value: unknown) {
  if (key === "model") {
    return validAutocompleteModel(value)
  }

  if (key === "provider") {
    return validAutocompleteProvider(value)
  }

  if (key === "enableAutoTrigger") return typeof value === "boolean"
  if (key === "enableSmartInlineTaskKeybinding") return typeof value === "boolean"
  if (key === "enableChatAutocomplete") return typeof value === "boolean"

  return false
}
