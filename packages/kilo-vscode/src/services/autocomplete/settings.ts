import * as vscode from "vscode"
import { AUTOCOMPLETE_MODELS, DEFAULT_AUTOCOMPLETE_MODEL } from "../../shared/autocomplete-models"

const keys = new Set(["enableAutoTrigger", "enableSmartInlineTaskKeybinding", "enableChatAutocomplete", "model"])

type Message = {
  type: string
  key?: unknown
  value?: unknown
}

type Post = (msg: unknown) => void

export async function routeAutocompleteMessage(message: Message, post: Post): Promise<boolean> {
  if (message.type === "requestAutocompleteSettings") {
    post(buildAutocompleteSettingsMessage())
    return true
  }

  if (message.type === "updateAutocompleteSetting") {
    if (await update(message.key, message.value)) {
      post(buildAutocompleteSettingsMessage())
    }
    return true
  }

  return false
}

export function buildAutocompleteSettingsMessage() {
  const config = vscode.workspace.getConfiguration("kilo-code.new.autocomplete")
  return {
    type: "autocompleteSettingsLoaded" as const,
    settings: {
      enableAutoTrigger: config.get<boolean>("enableAutoTrigger", true),
      enableSmartInlineTaskKeybinding: config.get<boolean>("enableSmartInlineTaskKeybinding", false),
      enableChatAutocomplete: config.get<boolean>("enableChatAutocomplete", false),
      model: config.get<string>("model", DEFAULT_AUTOCOMPLETE_MODEL.id),
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

async function update(key: unknown, value: unknown) {
  if (typeof key !== "string") return false
  if (!keys.has(key)) return false
  if (!valid(key, value)) return false

  await vscode.workspace
    .getConfiguration("kilo-code.new.autocomplete")
    .update(key, value, vscode.ConfigurationTarget.Global)

  return true
}

function valid(key: string, value: unknown) {
  if (key === "model") {
    if (typeof value !== "string") return false
    return AUTOCOMPLETE_MODELS.some((m) => m.id === value)
  }

  return typeof value === "boolean"
}
